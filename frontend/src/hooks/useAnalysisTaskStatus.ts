import { useMemo } from 'react';
import { useAnalysisStore } from '../stores/analysisStore';
import type { TaskItem } from '../stores/analysisStore';

const PENDING_STATES = new Set(['pending', 'queued', 'submitted']);

const getTaskTimestamp = (task?: TaskItem | null) =>
  task?.updated_at ?? task?.finished_at ?? task?.started_at ?? task?.created_at ?? 0;

export interface AnalysisTaskStatus {
  tasks: TaskItem[];
  runningTask: TaskItem | null;
  queuedTask: TaskItem | null;
  persistedTask: TaskItem | null;
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

  const filteredTasks = useMemo(() => {
    if (!Array.isArray(tasks)) {
      return [] as TaskItem[];
    }
    return tasks.filter((task) => task?.task_type === taskType);
  }, [tasks, taskType]);

  const sortedTasks = useMemo(
    () => filteredTasks.slice().sort((a, b) => getTaskTimestamp(b) - getTaskTimestamp(a)),
    [filteredTasks]
  );

  const runningTask = sortedTasks.find((task) => task?.state === 'running') ?? null;
  const queuedTask =
    sortedTasks.find((task) => {
      const normalized = (task?.state ?? '').toLowerCase();
      return PENDING_STATES.has(normalized);
    }) ?? null;
  const persistedTask = sortedTasks.find((task) => task?.result_persisted) ?? null;
  const successfulTask = persistedTask ?? sortedTasks.find((task) => task?.state === 'successful') ?? null;
  const failedTask = sortedTasks.find((task) => task?.state === 'failed') ?? null;
  const cancelledTask = sortedTasks.find((task) => task?.state === 'cancelled') ?? null;
  const terminalTask = successfulTask ?? failedTask ?? cancelledTask ?? null;

  const activeCandidate = runningTask ?? queuedTask;
  const activeTaskId = activeCandidate?.task_id ?? null;
  const bannerStatus: 'running' | 'queued' | null = activeCandidate
    ? activeCandidate.state === 'running'
      ? 'running'
      : 'queued'
    : null;
  const bannerTaskId = activeCandidate?.task_id ?? null;
  const bannerMessage = activeCandidate?.progress_message || activeCandidate?.message;

  return {
    tasks: sortedTasks,
    runningTask,
    queuedTask,
    persistedTask,
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
