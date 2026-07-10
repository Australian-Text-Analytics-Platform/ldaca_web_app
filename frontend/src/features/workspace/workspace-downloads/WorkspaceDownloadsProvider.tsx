import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { downloadWorkspaceArtifact, startWorkspaceDownload } from '@/api';
import { saveBlob } from '@/lib/download';
import { useAnalysisStore, type TaskItem } from '@/stores/analysisStore';
import {
  WorkspaceDownloadsContext,
  type PendingWorkspaceDownload,
  type WorkspaceDownloadsHandle,
} from './WorkspaceDownloadsContext';

/**
 * Builds the strict identity used to claim a terminal workspace artifact.
 * Used by: WorkspaceDownloadsProvider when matching provider-owned requests to
 * task-stream records, so task ids from another workspace cannot complete the
 * wrong download.
 */
function downloadKey(workspaceId: string, taskId: string): string {
  return `${workspaceId}\u0000${taskId}`;
}

/**
 * Converts a workspace label into the ZIP filename used by browser and Tauri
 * saves. Used by: WorkspaceDownloadsProvider after artifact generation
 * succeeds, keeping path separators and whitespace out of the saved name.
 */
function workspaceArtifactFilename(artifactName: string, workspaceId: string): string {
  return `${(artifactName || workspaceId).replace(/[^a-zA-Z0-9._-]+/g, '_')}.zip`;
}

/**
 * Owns workspace artifact tasks for the full authenticated workspace-shell
 * lifetime. `WorkspaceShell` mounts this provider above `ViewRouter`, while
 * Data Loader's workspace manager consumes the exposed command/view handle.
 *
 * Flow: start artifact generation through the generated client, retain the
 * returned task/workspace identity across view navigation, claim a terminal
 * task once before async download/save work, then report one terminal result.
 */
export function WorkspaceDownloadsProvider({ children }: { children: ReactNode }) {
  const tasks = useAnalysisStore((state) => state.tasks);
  const [startingWorkspaceIds, setStartingWorkspaceIds] = useState<Set<string>>(() => new Set());
  const [pendingDownloads, setPendingDownloads] = useState<PendingWorkspaceDownload[]>([]);

  // Terminal emissions can repeat before React commits the pending-state removal.
  // This ref is an identity/correctness guard, not render state: claiming must be
  // synchronous so Strict Mode and repeated SSE updates cannot save twice.
  const claimedDownloadKeys = useRef(new Set<string>());

  /**
   * Starts the workspace-manager row's artifact task and records its returned
   * identity before the Data Loader view can unmount.
   */
  const startDownload = async (workspaceId: string, workspaceName: string) => {
    setStartingWorkspaceIds((current) => new Set(current).add(workspaceId));
    try {
      const { data: response } = await startWorkspaceDownload({
        path: { workspace_id: workspaceId },
        throwOnError: true,
      });
      // The generated response declares task metadata, but guard the runtime
      // boundary because no completion can be tracked without its identity.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const taskId = response?.metadata?.task_id;
      if (!taskId) throw new Error('No task ID returned');

      setPendingDownloads((current) => [
        ...current.filter((download) => download.workspaceId !== workspaceId),
        {
          taskId,
          workspaceId,
          artifactName: workspaceName,
          status: 'pending',
        },
      ]);
      toast('Preparing workspace download…', { duration: 3500 });
    } catch (error) {
      toast.error((error as Error).message || 'Failed to start workspace download.', {
        duration: 6000,
      });
    } finally {
      setStartingWorkspaceIds((current) => {
        const next = new Set(current);
        next.delete(workspaceId);
        return next;
      });
    }
  };

  useEffect(() => {
    for (const pending of pendingDownloads) {
      const task = tasks.find(
        (candidate: TaskItem) =>
          candidate.task_id === pending.taskId && candidate.workspace_id === pending.workspaceId,
      );
      if (!task) continue;
      if (task.state !== 'successful' && task.state !== 'failed' && task.state !== 'cancelled') {
        continue;
      }

      const key = downloadKey(pending.workspaceId, pending.taskId);
      if (claimedDownloadKeys.current.has(key)) continue;
      claimedDownloadKeys.current.add(key);
      setPendingDownloads((current) =>
        current.filter((download) => downloadKey(download.workspaceId, download.taskId) !== key),
      );

      if (task.state === 'failed' || task.state === 'cancelled') {
        // Empty backend messages should use the user-facing fallback copy.
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        toast.error(task.message || 'Workspace download failed.', { duration: 6000 });
        continue;
      }

      void (async () => {
        try {
          const { data } = await downloadWorkspaceArtifact({
            parseAs: 'blob',
            path: { workspace_id: pending.workspaceId, task_id: pending.taskId },
            throwOnError: true,
          });
          await saveBlob(
            data,
            workspaceArtifactFilename(pending.artifactName, pending.workspaceId),
          );
          toast.success(`Downloaded workspace "${pending.artifactName || pending.workspaceId}".`, {
            duration: 3500,
          });
        } catch (error) {
          toast.error((error as Error).message || 'Failed to download workspace ZIP.', {
            duration: 6000,
          });
        }
      })();
    }
  }, [tasks, pendingDownloads]);

  const value: WorkspaceDownloadsHandle = {
    pendingDownloads,
    startDownload,
    isStarting: (workspaceId) => startingWorkspaceIds.has(workspaceId),
    isPending: (workspaceId) =>
      pendingDownloads.some((download) => download.workspaceId === workspaceId),
  };

  return (
    <WorkspaceDownloadsContext.Provider value={value}>
      {children}
    </WorkspaceDownloadsContext.Provider>
  );
}
