import { useAnalysisStore } from '../stores/analysisStore';
import type { TaskItem } from '../stores/analysisStore';

const PENDING_STATES = new Set(['pending', 'queued', 'submitted']);

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

const getTaskTimestamp = (task?: TaskItem | null) =>
  normalizeTimestamp(task?.updated_at ?? task?.finished_at ?? task?.started_at ?? task?.created_at ?? 0);

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

export const useAnalysisTaskStatus = (taskType: string): AnalysisTaskStatus => {
  const tasks = useAnalysisStore((state) => state.tasks);

  const filteredTasks = Array.isArray(tasks)
    ? tasks.filter((task) => task?.task_type === taskType)
    : ([] as TaskItem[]);

  const sortedTasks = filteredTasks.slice().sort((a, b) => getTaskTimestamp(b) - getTaskTimestamp(a));

  const runningTask = sortedTasks.find((task) => task?.state === 'running') ?? null;
  const queuedTask =
    sortedTasks.find((task) => {
      const normalized = (task?.state ?? '').toLowerCase();
      return PENDING_STATES.has(normalized);
    }) ?? null;
  const successfulTask = sortedTasks.find((task) => task?.state === 'successful') ?? null;
  const failedTask = sortedTasks.find((task) => task?.state === 'failed') ?? null;
  const cancelledTask = sortedTasks.find((task) => task?.state === 'cancelled') ?? null;
  const terminalTask =
    sortedTasks.find(
      (task) =>
        task?.state === 'successful' ||
        task?.state === 'failed' ||
        task?.state === 'cancelled'
    ) ?? null;

  const activeCandidate = runningTask ?? queuedTask;
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
