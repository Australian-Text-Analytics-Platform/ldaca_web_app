import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useAnalysisStore } from '@/stores/analysisStore';
import { queryKeys } from '@/lib/queryKeys';
import type { TaskItem } from '@/stores/analysisStore';
import {
  type TaskEventPayload,
  useWorkspaceTaskStreamClient,
  type WorkspaceTaskStreamClientState,
} from './useWorkspaceTaskStreamClient';

interface TaskMergeUpdate {
  task: Partial<TaskItem> & { task_id?: string };
}

const normalizeTimestamp = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
};

const sortTasksByTime = (tasks: TaskItem[] = []) =>
  [...tasks].sort((a, b) => {
    const tb = normalizeTimestamp(b?.finished_at ?? b?.started_at ?? b?.created_at ?? 0);
    const ta = normalizeTimestamp(a?.finished_at ?? a?.started_at ?? a?.created_at ?? 0);
    return tb - ta;
  });

const buildTaskMap = (tasks: TaskItem[] = []) => {
  const map = new Map<string, TaskItem>();
  tasks.forEach((task) => {
    const taskId = task?.task_id;
    if (taskId) {
      map.set(taskId, task);
    }
  });
  return map;
};

const mergeTaskUpdates = (
  previousTasks: TaskItem[] = [],
  updates: TaskMergeUpdate[] = [],
  options: { replaceAll?: boolean } = {}
) => {
  if (!updates.length && !options.replaceAll) {
    return sortTasksByTime(previousTasks);
  }

  const previousMap = buildTaskMap(previousTasks);
  const nextMap = options.replaceAll ? new Map<string, TaskItem>() : new Map(previousMap);

  updates.forEach(({ task }) => {
    if (!task || !task.task_id) return;

    const existing = nextMap.get(task.task_id) ?? previousMap.get(task.task_id);
    const merged: TaskItem = {
      ...existing,
      ...task,
    } as TaskItem;

    nextMap.set(task.task_id, merged);
  });

  return sortTasksByTime(Array.from(nextMap.values()));
};

const TAB_ASSOCIATED_TASK_TYPES = new Set([
  'token_frequencies',
  'concordance',
  'topic_modeling',
  'quotation',
]);

const TERMINAL_TASK_STATES = new Set(['successful', 'failed', 'cancelled']);

const shouldRefreshGraphFallback = (task?: TaskItem | null) => {
  if (!task?.task_type || !task?.state) {
    return false;
  }
  if (TAB_ASSOCIATED_TASK_TYPES.has(task.task_type)) {
    return false;
  }
  return TERMINAL_TASK_STATES.has(task.state);
};

export const useWorkspaceTaskInbox = (
  workspaceId: string | null
): WorkspaceTaskStreamClientState => {
  const queryClient = useQueryClient();
  const { getAuthHeaders } = useAuth();
  const setTasks = useAnalysisStore((state) => state.setTasks);
  const [transientError, setTransientError] = useState<string | null>(null);

  const handlePayload = useCallback(
    (payload: TaskEventPayload) => {
      if (payload.type !== 'analysis_save_failed' && payload.type !== 'error') {
        setTransientError(null);
      }

      switch (payload.type) {
        case 'workspace_updated': {
          if (workspaceId) {
            
            // Invalidate graph
            queryClient.invalidateQueries({
              queryKey: queryKeys.workspaceGraph(workspaceId),
            });
            
            // Invalidate node lists
            queryClient.invalidateQueries({
              queryKey: queryKeys.workspaceNodes(workspaceId),
            });

            // Force refetch nodes data if needed
            queryClient.refetchQueries({
              queryKey: queryKeys.workspaceGraph(workspaceId),
            });
          }
          break;
        }
        case 'tasks_snapshot': {
          if (Array.isArray(payload.tasks)) {
            setTasks((prevTasks: TaskItem[]) =>
              mergeTaskUpdates(
                prevTasks,
                payload.tasks.map((task: any) => ({ task }))
              )
            );
          }
          break;
        }
        case 'task_changed': {
          if (payload.task) {
            setTasks((prevTasks: TaskItem[]) =>
              mergeTaskUpdates(prevTasks, [
                {
                  task: payload.task as TaskItem,
                },
              ])
            );

            if (payload.task?.task_type === 'ldaca_import' && payload.task.state === 'successful') {
              queryClient.invalidateQueries({ queryKey: queryKeys.files });
            }

            if (workspaceId && shouldRefreshGraphFallback(payload.task as TaskItem)) {
              queryClient.invalidateQueries({
                queryKey: queryKeys.workspaceGraph(workspaceId),
              });
              queryClient.refetchQueries({
                queryKey: queryKeys.workspaceGraph(workspaceId),
              });
            }
          }
          break;
        }
        case 'analysis_save_failed': {
          if (payload.task_type === 'topic_modeling') {
            setTransientError(payload.message || 'Analysis save failed');
          }
          break;
        }
        case 'task_update': {
          if (Array.isArray(payload.tasks)) {
            setTasks((prevTasks: TaskItem[]) =>
              mergeTaskUpdates(
                prevTasks,
                payload.tasks.map((task: any) => ({ task }))
              )
            );
          }
          break;
        }
        case 'error': {
          setTransientError(payload.message || 'Task stream error');
          break;
        }
        default: {
          // noop
          break;
        }
      }
    },
    [setTasks, setTransientError, queryClient, workspaceId]
  );

  const clientState = useWorkspaceTaskStreamClient(workspaceId, {
    enabled: true,
    getAuthHeaders,
    onEvent: handlePayload,
  });

  return transientError
    ? {
        ...clientState,
        status: 'error',
        error: transientError,
      }
    : clientState;
};

export default useWorkspaceTaskInbox;
