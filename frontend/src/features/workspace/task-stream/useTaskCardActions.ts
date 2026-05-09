import { useCallback } from 'react';

import { filesApi } from '@/api/files';
import { workspacesApi } from '@/api/workspaces';
import { useAuth } from '@/hooks/useAuth';
import { useAnalysisStore } from '@/stores/analysisStore';
import type { SidebarTaskRecord } from '@/components/layout/sidebar/types';

/**
 * Action handlers for the per-task cards rendered by the sidebar Tasks
 * section: cancel a running task, clear a terminal task, or auto-fade a
 * card without touching the backend.
 *
 * The "where to clear" branching (`filesApi` for ldaca-import tasks vs
 * `workspacesApi` for everything else) lives here rather than in the
 * layout component so future task types only need to extend the map.
 */
export const useTaskCardActions = () => {
  const { getAuthHeaders } = useAuth();
  const setTasks = useAnalysisStore((state) => state.setTasks);

  const handleClearTask = useCallback(
    async (task: SidebarTaskRecord) => {
      try {
        const isFileImportTask = String(task.task_type ?? '') === 'ldaca_import';

        if (task.state === 'running') {
          // Stop the running process. The task record stays; the SSE stream
          // pushes a state update to 'cancelled' so the card transitions to
          // the clearable state without us removing it from local state here.
          await workspacesApi.cancelTask({ task_id: task.task_id }, getAuthHeaders());
          return;
        }

        // Terminal state — remove the record entirely.
        if (isFileImportTask) {
          await filesApi.clearTasks({ task_id: task.task_id }, getAuthHeaders());
        } else {
          await workspacesApi.clearTasks({ task_id: task.task_id }, getAuthHeaders());
        }
        setTasks((prev) => prev.filter((item) => item.task_id !== task.task_id));
      } catch (error) {
        console.error('Failed to clear task', error);
      }
    },
    [getAuthHeaders, setTasks],
  );

  /**
   * Auto-fade dismissal: remove from the local UI list only. Must NOT call
   * the backend clear API — the analysis task record may still be required
   * by an open feature dialog (e.g. Topic Modelling "Add to Workspace"
   * detach), which looks up the task by id when the user confirms.
   */
  const handleAutoDismissTask = useCallback(
    (task: SidebarTaskRecord) => {
      setTasks((prev) => prev.filter((item) => item.task_id !== task.task_id));
    },
    [setTasks],
  );

  return { handleClearTask, handleAutoDismissTask };
};
