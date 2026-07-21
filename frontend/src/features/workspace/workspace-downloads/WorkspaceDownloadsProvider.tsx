import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { exportWorkspaceArchive } from '@/api';
import { saveBlob } from '@/lib/download';
import {
  WorkspaceDownloadsContext,
  type PendingWorkspaceDownload,
  type WorkspaceDownloadsHandle,
} from './WorkspaceDownloadsContext';

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
 * Flow: request the canonical workspace archive, save the response, and keep
 * the pending marker in the shell provider so navigation cannot orphan an
 * in-flight download.
 */
export function WorkspaceDownloadsProvider({ children }: { children: ReactNode }) {
  const [startingWorkspaceIds, setStartingWorkspaceIds] = useState<Set<string>>(() => new Set());
  const [pendingDownloads, setPendingDownloads] = useState<PendingWorkspaceDownload[]>([]);

  /**
   * Starts the workspace-manager row's archive request and records its
   * in-flight identity before the Data Loader view can unmount.
   */
  const startDownload = async (workspaceId: string, workspaceName: string) => {
    if (startingWorkspaceIds.has(workspaceId)) return;
    setStartingWorkspaceIds((current) => new Set(current).add(workspaceId));
    setPendingDownloads((current) => [
      ...current.filter((download) => download.workspaceId !== workspaceId),
      { workspaceId, artifactName: workspaceName, status: 'pending' },
    ]);
    try {
      const { data } = await exportWorkspaceArchive({
        parseAs: 'blob',
        path: { workspace_id: workspaceId },
        throwOnError: true,
      });
      await saveBlob(data, workspaceArtifactFilename(workspaceName, workspaceId));
      toast.success(`Downloaded workspace "${workspaceName || workspaceId}".`, { duration: 3500 });
    } catch (error) {
      toast.error((error as Error).message || 'Failed to start workspace download.', {
        duration: 6000,
      });
    } finally {
      setPendingDownloads((current) =>
        current.filter((download) => download.workspaceId !== workspaceId),
      );
      setStartingWorkspaceIds((current) => {
        const next = new Set(current);
        next.delete(workspaceId);
        return next;
      });
    }
  };

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
