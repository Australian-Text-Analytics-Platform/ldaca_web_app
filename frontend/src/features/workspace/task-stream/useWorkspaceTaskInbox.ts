import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { filesApi } from '@/api/files';
import { useAnalysisStore } from '@/stores/analysisStore';
import { queryKeys } from '@/lib/queryKeys';
import type { TaskItem } from '@/stores/analysisStore';
import {
  type TaskEventPayload,
  useWorkspaceTaskStreamClient,
  type WorkspaceTaskStreamClientState,
} from './useWorkspaceTaskStreamClient';
import { useFilesTaskStreamClient } from './useFilesTaskStreamClient';

interface TaskMergeUpdate {
  task: Partial<TaskItem> & { task_id?: string };
  resultPersistedOverride?: boolean;
}

const sortTasksByTime = (tasks: TaskItem[] = []) =>
  [...tasks].sort((a, b) => {
    const tb = b?.finished_at ?? b?.started_at ?? b?.created_at ?? 0;
    const ta = a?.finished_at ?? a?.started_at ?? a?.created_at ?? 0;
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

  updates.forEach(({ task, resultPersistedOverride }) => {
    if (!task || !task.task_id) return;

    const existing = nextMap.get(task.task_id) ?? previousMap.get(task.task_id);
    const merged: TaskItem = {
      ...existing,
      ...task,
    } as TaskItem;

    if (resultPersistedOverride !== undefined) {
      merged.result_persisted = resultPersistedOverride;
    } else if (existing?.result_persisted && !merged.result_persisted) {
      merged.result_persisted = existing.result_persisted;
    }

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
  const markTopicModelingReady = useAnalysisStore((state) => state.markTopicModelingReady);
  const resetTopicModelingReady = useAnalysisStore((state) => state.resetTopicModelingReady);
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
            const resultPersisted = payload.result_persisted ?? payload.task?.result_persisted;
            setTasks((prevTasks: TaskItem[]) =>
              mergeTaskUpdates(prevTasks, [
                {
                  task: payload.task as TaskItem,
                  resultPersistedOverride: resultPersisted,
                },
              ])
            );

            if (payload.task?.task_type === 'topic_modeling') {
              if (payload.task.state === 'running') {
                resetTopicModelingReady();
              }
              if (resultPersisted === true && payload.task?.task_id) {
                markTopicModelingReady(payload.task.task_id, payload.timestamp);
              }
            }

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
        case 'analysis_saved': {
          if (payload.task_type === 'topic_modeling' && payload.task_id) {
            markTopicModelingReady(payload.task_id, payload.timestamp);
            setTasks((prevTasks: TaskItem[]) =>
              mergeTaskUpdates(prevTasks, [
                {
                  task: {
                    task_id: payload.task_id,
                  },
                  resultPersistedOverride: true,
                },
              ])
            );
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
    [setTasks, markTopicModelingReady, resetTopicModelingReady, setTransientError, queryClient, workspaceId]
  );

  const clientState = useWorkspaceTaskStreamClient(workspaceId, {
    enabled: Boolean(workspaceId),
    getAuthHeaders,
    onEvent: handlePayload,
  });

  const filesClientState = useFilesTaskStreamClient({
    enabled: true,
    getAuthHeaders,
    onEvent: handlePayload,
  });

  const mergedStatus: WorkspaceTaskStreamClientState['status'] =
    clientState.status === 'open' || filesClientState.status === 'open'
      ? 'open'
      : clientState.status === 'connecting' || filesClientState.status === 'connecting'
        ? 'connecting'
        : clientState.status === 'error' && filesClientState.status === 'error'
          ? 'error'
          : clientState.status !== 'idle' || filesClientState.status !== 'idle'
            ? 'connecting'
            : 'idle';

  const mergedError =
    transientError ||
    (clientState.status === 'error' && filesClientState.status === 'error'
      ? [clientState.error, filesClientState.error].filter(Boolean).join(' | ')
      : null);

  const mergedReconnect = () => {
    clientState.reconnect();
    filesClientState.reconnect();
  };

  const mergedLastEventTimestamp = [
    clientState.lastEventTimestamp ?? 0,
    filesClientState.lastEventTimestamp ?? 0,
  ].reduce((acc, ts) => (ts > acc ? ts : acc), 0);

  const mergedReconnectAttempt = Math.max(
    clientState.reconnectAttempt,
    filesClientState.reconnectAttempt
  );

  useEffect(() => {
    let cancelled = false;

    const syncFilesTasks = async () => {
      try {
        const payload = await filesApi.listTasks(getAuthHeaders());
        if (cancelled || !Array.isArray(payload?.data)) return;

        setTasks((prevTasks: TaskItem[]) =>
          mergeTaskUpdates(
            prevTasks,
            payload.data.map((task) => ({
              task: task as Partial<TaskItem> & { task_id?: string },
            }))
          )
        );
      } catch {
        // Best-effort fallback; SSE remains primary signal path.
      }
    };

    syncFilesTasks();
    const timer = window.setInterval(syncFilesTasks, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [getAuthHeaders, setTasks]);

  return {
    status: mergedStatus,
    error: mergedError,
    reconnect: mergedReconnect,
    lastEventTimestamp: mergedLastEventTimestamp || null,
    reconnectAttempt: mergedReconnectAttempt,
  };
};

export default useWorkspaceTaskInbox;
