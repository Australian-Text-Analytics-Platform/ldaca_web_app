import { useCallback, useEffect, useState } from 'react';
import { downloadWorkspaceArtifact, startWorkspaceDownload } from '@/api/generated/sdk.gen';
import { saveBlob } from '@/lib/download';
import { useAnalysisStore, type TaskItem } from '@/stores/analysisStore';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

type PendingDownload = {
  taskId: string;
  workspaceName: string;
};

/**
 * Removes one workspace download from the pending map without mutating the
 * previous state object. The download hook uses this after success/failure.
 * Used by: local callers in data-loader/usePendingWorkspaceDownloads module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const omitPendingDownload = (
  pendingDownloads: Record<string, PendingDownload>,
  workspaceId: string,
): Record<string, PendingDownload> => {
  if (!Object.prototype.hasOwnProperty.call(pendingDownloads, workspaceId)) return pendingDownloads;
  return Object.fromEntries(Object.entries(pendingDownloads).filter(([id]) => id !== workspaceId));
};

type UsePendingWorkspaceDownloadsOptions = {
  authHeaders: Record<string, string>;
  notify: Notify;
};

export type PendingWorkspaceDownloadsHandle = {
  startDownload: (workspaceId: string, workspaceName: string) => Promise<void>;
  isStarting: (workspaceId: string) => boolean;
  isPending: (workspaceId: string) => boolean;
};

/**
 * Tracks asynchronous workspace ZIP downloads. The workspace manager uses this
 * handle to start downloads and to disable rows while backend tasks prepare
 * artifacts.
 * Used by: WorkspaceManagerCard component, DataLoaderFeature module (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: track workspace download ids, poll progress for active entries, surface
 * completion/errors through notifications, and provide progress handles to the workspace card.
 */
export function usePendingWorkspaceDownloads({
  authHeaders,
  notify,
}: UsePendingWorkspaceDownloadsOptions): PendingWorkspaceDownloadsHandle {
  const tasks = useAnalysisStore((state) => state.tasks);
  const [startingWorkspaceId, setStartingWorkspaceId] = useState<string | null>(null);
  const [pendingDownloads, setPendingDownloads] = useState<Record<string, PendingDownload>>({});

  /**
   * Starts artifact generation for a workspace and records the returned task id
   * so the hook can complete the download when the task stream reports success.
   */
  const startDownload = useCallback(
    async (workspaceId: string, workspaceName: string) => {
      try {
        setStartingWorkspaceId(workspaceId);
        const { data: response } = await startWorkspaceDownload({
          headers: authHeaders,
          throwOnError: true,
        });
        const taskId = response?.metadata?.task_id;
        if (!taskId) throw new Error('No task ID returned');
        setPendingDownloads((prev) => ({ ...prev, [workspaceId]: { taskId, workspaceName } }));
        notify('info', 'Preparing workspace download…');
      } catch (error) {
        notify('error', (error as Error).message || 'Failed to start workspace download.');
      } finally {
        setStartingWorkspaceId(null);
      }
    },
    [authHeaders, notify],
  );

  /**
   * Clears a pending workspace entry after the download task resolves or
   * fails.
   */
  const dismissPendingDownload = useCallback((workspaceId: string) => {
    setPendingDownloads((prev) => omitPendingDownload(prev, workspaceId));
  }, []);

  /**
   * Fetches the generated ZIP artifact and saves it locally once the backend
   * task reaches `successful`.
   */
  const completePendingDownload = useCallback(
    async (workspaceId: string, taskId: string, workspaceName: string) => {
      dismissPendingDownload(workspaceId);
      try {
        const { data } = await downloadWorkspaceArtifact({
          headers: authHeaders,
          parseAs: 'blob',
          path: { task_id: taskId },
          throwOnError: true,
        });
        const blob = data as Blob;
        const filename = `${(workspaceName || workspaceId).replace(/[^a-zA-Z0-9._-]+/g, '_')}.zip`;
        await saveBlob(blob, filename);
        notify('success', `Downloaded workspace "${workspaceName || workspaceId}".`);
      } catch (err) {
        notify('error', (err as Error).message || 'Failed to download workspace ZIP.');
      }
    },
    [authHeaders, dismissPendingDownload, notify],
  );

  /**
   * Reports failed/cancelled workspace artifact tasks and removes their row
   * from the pending download map.
   */
  const failPendingDownload = useCallback(
    (workspaceId: string, message: string | undefined) => {
      dismissPendingDownload(workspaceId);
      notify('error', message || 'Workspace download failed.');
    },
    [dismissPendingDownload, notify],
  );

  useEffect(() => {
    const entries = Object.entries(pendingDownloads);
    if (!entries.length) return;

    for (const [workspaceId, { taskId, workspaceName }] of entries) {
      const task = tasks.find((t: TaskItem) => t.task_id === taskId);
      if (!task) continue;

      if (task.state === 'successful') {
        void Promise.resolve().then(() =>
          completePendingDownload(workspaceId, taskId, workspaceName),
        );
      } else if (task.state === 'failed' || task.state === 'cancelled') {
        void Promise.resolve().then(() => failPendingDownload(workspaceId, task.message));
      }
    }
  }, [tasks, pendingDownloads, completePendingDownload, failPendingDownload]);

  const isStarting = useCallback(
    /** Reports whether a given workspace row is currently starting a download. */
    (workspaceId: string) => startingWorkspaceId === workspaceId,
    [startingWorkspaceId],
  );
  const isPending = useCallback(
    /** Reports whether a given workspace row already has a pending artifact task. */
    (workspaceId: string) => Boolean(pendingDownloads[workspaceId]),
    [pendingDownloads],
  );

  return { startDownload, isStarting, isPending };
}
