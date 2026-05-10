import { useCallback, useEffect, useState } from 'react';
import { workspacesApi } from '@/api/workspaces';
import { saveBlob } from '@/lib/download';
import { useAnalysisStore, type TaskItem } from '@/stores/analysisStore';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

type PendingDownload = {
  taskId: string;
  workspaceName: string;
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

export function usePendingWorkspaceDownloads({
  authHeaders,
  notify,
}: UsePendingWorkspaceDownloadsOptions): PendingWorkspaceDownloadsHandle {
  const tasks = useAnalysisStore((state) => state.tasks);
  const [startingWorkspaceId, setStartingWorkspaceId] = useState<string | null>(null);
  const [pendingDownloads, setPendingDownloads] = useState<Record<string, PendingDownload>>({});

  const startDownload = useCallback(
    async (workspaceId: string, workspaceName: string) => {
      try {
        setStartingWorkspaceId(workspaceId);
        const response = await workspacesApi.startDownloadTask(authHeaders);
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

  useEffect(() => {
    const entries = Object.entries(pendingDownloads);
    if (!entries.length) return;

    for (const [workspaceId, { taskId, workspaceName }] of entries) {
      const task = tasks.find((t: TaskItem) => t.task_id === taskId);
      if (!task) continue;

      if (task.state === 'successful') {
        // Remove from pending immediately to prevent double-trigger.
        setPendingDownloads((prev) => {
          const { [workspaceId]: _, ...next } = prev;
          return next;
        });
        // Fetch the artifact and trigger browser download.
        (async () => {
          try {
            const blob = await workspacesApi.downloadTaskArtifact(taskId, authHeaders);
            const filename = `${(workspaceName || workspaceId).replace(/[^a-zA-Z0-9._-]+/g, '_')}.zip`;
            await saveBlob(blob, filename);
            notify('success', `Downloaded workspace "${workspaceName || workspaceId}".`);
          } catch (err) {
            notify('error', (err as Error).message || 'Failed to download workspace ZIP.');
          }
        })();
      } else if (task.state === 'failed' || task.state === 'cancelled') {
        setPendingDownloads((prev) => {
          const { [workspaceId]: _, ...next } = prev;
          return next;
        });
        notify('error', task.message || 'Workspace download failed.');
      }
    }
  }, [tasks, pendingDownloads, authHeaders, notify]);

  const isStarting = useCallback(
    (workspaceId: string) => startingWorkspaceId === workspaceId,
    [startingWorkspaceId],
  );
  const isPending = useCallback(
    (workspaceId: string) => Boolean(pendingDownloads[workspaceId]),
    [pendingDownloads],
  );

  return { startDownload, isStarting, isPending };
}
