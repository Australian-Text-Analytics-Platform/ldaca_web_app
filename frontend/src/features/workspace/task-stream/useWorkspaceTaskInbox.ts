import { useRef, useState } from 'react';
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
  eventTimestamp?: number;
  eventSequence?: number;
}

type InternalTask = TaskItem & {
  __event_timestamp?: number;
  __event_sequence?: number;
};

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
  tasks.toSorted((a, b) => {
    const tb = normalizeTimestamp(
      (b as InternalTask)?.__event_timestamp ?? b?.finished_at ?? b?.started_at ?? b?.created_at ?? 0
    );
    const ta = normalizeTimestamp(
      (a as InternalTask)?.__event_timestamp ?? a?.finished_at ?? a?.started_at ?? a?.created_at ?? 0
    );
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

const TAB_ASSOCIATED_TASK_TYPES = new Set([
  'token_frequencies',
  'concordance',
  'topic_modeling',
  'quotation',
]);

const TERMINAL_STATES = new Set(['successful', 'failed', 'cancelled']);

const normalizeState = (value: unknown): string => String(value ?? '').toLowerCase();

const getEventTimestamp = (task: TaskItem | undefined): number =>
  normalizeTimestamp((task as InternalTask | undefined)?.__event_timestamp ?? 0);

const getEventSequence = (task: TaskItem | undefined): number => {
  const value = (task as InternalTask | undefined)?.__event_sequence;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const chooseByEventOrder = (existing: TaskItem | undefined, incoming: TaskItem): TaskItem => {
  if (!existing) {
    return incoming;
  }

  const existingState = normalizeState(existing.state);
  const incomingState = normalizeState(incoming.state);
  const existingIsTerminal = TERMINAL_STATES.has(existingState);
  const incomingIsTerminal = TERMINAL_STATES.has(incomingState);

  // State machine guard: never regress a task_id from terminal back to non-terminal,
  // even if events are delivered out of order.
  if (existingIsTerminal && !incomingIsTerminal) {
    return existing;
  }
  if (incomingIsTerminal && !existingIsTerminal) {
    return incoming;
  }

  const existingTs = getEventTimestamp(existing);
  const incomingTs = getEventTimestamp(incoming);

  if (incomingTs > existingTs) {
    return incoming;
  }

  if (incomingTs < existingTs) {
    return existing;
  }

  const existingSeq = getEventSequence(existing);
  const incomingSeq = getEventSequence(incoming);
  if (incomingSeq > existingSeq) {
    return incoming;
  }
  if (incomingSeq < existingSeq) {
    return existing;
  }

  return incoming;
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

  updates.forEach(({ task, eventTimestamp, eventSequence }) => {
    if (!task || !task.task_id) return;

    const existing = nextMap.get(task.task_id) ?? previousMap.get(task.task_id);
    const merged: InternalTask = {
      ...existing,
      ...task,
      __event_timestamp:
        typeof eventTimestamp === 'number' && Number.isFinite(eventTimestamp)
          ? eventTimestamp
          : getEventTimestamp(existing),
      __event_sequence:
        typeof eventSequence === 'number' && Number.isFinite(eventSequence)
          ? eventSequence
          : getEventSequence(existing),
    } as InternalTask;

    nextMap.set(task.task_id, chooseByEventOrder(existing, merged));
  });

  return sortTasksByTime(Array.from(nextMap.values()));
};

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
  const pushMaterializedEvent = useAnalysisStore((state) => state.pushMaterializedEvent);
  const [transientError, setTransientError] = useState<string | null>(null);
  const eventSequenceRef = useRef(0);

  const nextEventSequence = () => {
    eventSequenceRef.current += 1;
    return eventSequenceRef.current;
  };

  const handlePayload = (payload: TaskEventPayload) => {
      if (payload.type !== 'analysis_save_failed' && payload.type !== 'error') {
        setTransientError(null);
      }

      switch (payload.type) {
        case 'workspace_updated': {
          if (workspaceId) {
            // invalidateQueries with the default refetchType:'active' already
            // refetches any observed query, so we do not also call refetchQueries.
            queryClient.invalidateQueries({
              queryKey: queryKeys.workspaceGraph(workspaceId),
            });
            queryClient.invalidateQueries({
              queryKey: queryKeys.workspaceNodes(workspaceId),
            });
          }
          break;
        }
        case 'tasks_snapshot': {
          const snapshotTasks = payload.tasks;
          if (Array.isArray(snapshotTasks)) {
            const seq = nextEventSequence();
            const eventTimestamp = normalizeTimestamp(payload.timestamp);
            setTasks((prevTasks: TaskItem[]) =>
              mergeTaskUpdates(
                prevTasks,
                snapshotTasks.map((task: TaskItem) => ({
                  task,
                  eventTimestamp,
                  eventSequence: seq,
                })),
                { replaceAll: true }
              )
            );
          }
          break;
        }
        case 'task_changed': {
          if (payload.task) {
            const seq = nextEventSequence();
            const eventTimestamp = normalizeTimestamp(payload.timestamp);
            setTasks((prevTasks: TaskItem[]) =>
              mergeTaskUpdates(prevTasks, [
                {
                  task: payload.task as TaskItem,
                  eventTimestamp,
                  eventSequence: seq,
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
            }
          }
          break;
        }
        case 'task_removed': {
          if (payload.task_id) {
            setTasks((prevTasks: TaskItem[]) =>
              prevTasks.filter((task) => task.task_id !== payload.task_id)
            );
          }
          break;
        }
        case 'analysis_materialized': {
          const taskType = typeof payload.task_type === 'string' ? payload.task_type : '';
          const taskId = typeof payload.task_id === 'string' ? payload.task_id : '';
          const parentTaskId = typeof payload.parent_task_id === 'string' ? payload.parent_task_id : '';
          const parentNodeId = typeof payload.parent_node_id === 'string' ? payload.parent_node_id : '';
          const materializedPath = typeof payload.materialized_path === 'string' ? payload.materialized_path : '';
          if (taskType && parentTaskId && parentNodeId && materializedPath) {
            pushMaterializedEvent({
              taskType,
              taskId,
              parentTaskId,
              parentNodeId,
              materializedPath,
              timestamp: normalizeTimestamp(payload.timestamp) ?? Date.now(),
            });
          }
          break;
        }
        case 'analysis_save_failed': {
          if (payload.task_type === 'topic_modeling') {
            setTransientError(payload.message || 'Analysis save failed');
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
    };

  const clientState = useWorkspaceTaskStreamClient({
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
