import { useAnalysisStore, isPendingTaskState, isTerminalTaskState } from '@/stores/analysisStore';
import type { TaskItem } from '@/stores/analysisStore';
import { getTaskTypeCandidates } from './analysisTaskUtils';

/** Normalizes backend timestamp variants so streamed and fetched tasks sort together. */
/** Called by: useAnalysisTaskStatus in this hook module. */
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

/** Picks the freshest timestamp available on a task, including stream-only event metadata. */
/** Called by: useAnalysisTaskStatus in this hook module. */
const getTaskTimestamp = (task?: TaskItem | null) => {
  const anyTask = task;
  return (
    normalizeTimestamp(anyTask?.__event_timestamp) ||
    normalizeTimestamp(
      task?.updated_at ?? task?.finished_at ?? task?.started_at ?? task?.created_at ?? 0,
    )
  );
};

/** Breaks timestamp ties using task-stream event order when events arrive in the same millisecond. */
/** Called by: useAnalysisTaskStatus in this hook module. */
const getTaskEventSequence = (task?: TaskItem | null) => {
  const anyTask = task;
  return typeof anyTask?.__event_sequence === 'number' && Number.isFinite(anyTask.__event_sequence)
    ? anyTask.__event_sequence
    : 0;
};

export interface AnalysisTaskStatus {
  tasks: TaskItem[];
  runningTask: TaskItem | null;
  queuedTask: TaskItem | null;
  successfulTask: TaskItem | null;
  failedTask: TaskItem | null;
  cancelledTask: TaskItem | null;
  terminalTask: TaskItem | null;
  activeTaskId: string | null;
  bannerStatus: 'running' | 'queued' | null;
  bannerTaskId: string | null;
  bannerMessage?: string;
}

export interface UseAnalysisTaskStatusOptions {
  /** Backend task types classify the workflow but never identify one run. */
  taskTypes: string | readonly string[];
  /** Limits status to the workspace that owns the feature or materialization. */
  workspaceId?: string | null;
  /**
   * Explicit task ownership. An empty list means the owner has not started a
   * task; omission is reserved for non-tab flows that observe a workspace/type.
   */
  taskIds?: readonly string[];
}

/** Summarizes the latest task state for an analysis feature's banners and result panels. */
/**
 * Used by: src/features/views/common/hooks/useMaterializeLifecycle.ts, src/features/views/common/tasks/useAnalysisTaskFlow.ts.
 * Flow: normalize task-type inputs, restrict tasks to the requested workspace
 * and optional owner ids, sort by timestamp/event order, then expose active,
 * terminal, and banner task summaries.
 */
export const useAnalysisTaskStatus = ({
  taskTypes,
  workspaceId,
  taskIds,
}: UseAnalysisTaskStatusOptions): AnalysisTaskStatus => {
  const tasks = useAnalysisStore((state) => state.tasks);
  const taskTypeList: readonly string[] =
    typeof taskTypes === 'string' ? [taskTypes] : taskTypes;
  const candidateTypes = taskTypeList.flatMap((value) => getTaskTypeCandidates(value));
  const candidateSet = new Set(candidateTypes);
  const ownedTaskIds = taskIds === undefined ? null : new Set(taskIds);

  const filteredTasks = Array.isArray(tasks)
    ? tasks.filter((task) => {
        const rawType = typeof task.task_type === 'string' ? task.task_type : '';
        if (!candidateSet.has(rawType)) return false;
        if (workspaceId != null && task.workspace_id !== workspaceId) return false;
        return ownedTaskIds === null || ownedTaskIds.has(task.task_id);
      })
    : ([] as TaskItem[]);

  const sortedTasks = filteredTasks.slice().sort((a, b) => {
    const tsDelta = getTaskTimestamp(b) - getTaskTimestamp(a);
    if (tsDelta !== 0) {
      return tsDelta;
    }
    return getTaskEventSequence(b) - getTaskEventSequence(a);
  });

  const runningTask = sortedTasks.find((task) => task.state === 'running') ?? null;
  const queuedTask =
    sortedTasks.find((task) => isPendingTaskState((task.state ?? '').toLowerCase())) ?? null;
  const successfulTask = sortedTasks.find((task) => task.state === 'successful') ?? null;
  const failedTask = sortedTasks.find((task) => task.state === 'failed') ?? null;
  const cancelledTask = sortedTasks.find((task) => task.state === 'cancelled') ?? null;
  const terminalTask = sortedTasks.find((task) => isTerminalTaskState(task.state)) ?? null;

  const latestTask = sortedTasks[0] ?? null;
  const latestState = (latestTask?.state ?? '').toLowerCase();
  const activeCandidate = latestTask
    ? latestState === 'running' || isPendingTaskState(latestState)
      ? latestTask
      : null
    : null;
  const activeTaskId = activeCandidate?.task_id ?? null;
  const bannerStatus: 'running' | 'queued' | null = activeCandidate
    ? activeCandidate.state === 'running'
      ? 'running'
      : 'queued'
    : null;
  const bannerTaskId = activeCandidate?.task_id ?? null;
  const bannerMessage =
    typeof activeCandidate?.progress_message === 'string'
      ? activeCandidate.progress_message
      : typeof activeCandidate?.message === 'string'
        ? activeCandidate.message
        : undefined;

  return {
    tasks: sortedTasks,
    runningTask,
    queuedTask,
    successfulTask,
    failedTask,
    cancelledTask,
    terminalTask,
    activeTaskId,
    bannerStatus,
    bannerTaskId,
    bannerMessage,
  };
};
