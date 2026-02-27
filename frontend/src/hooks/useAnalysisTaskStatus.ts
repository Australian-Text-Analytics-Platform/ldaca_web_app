import { useMemo } from 'react';
import { useAnalysisStore } from '../stores/analysisStore';
import type { TaskItem } from '../stores/analysisStore';
import { getTaskTypeCandidates } from './analysisTaskUtils';

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

const getTaskTimestamp = (task?: TaskItem | null) => {
  const anyTask = task as (TaskItem & { __event_timestamp?: unknown }) | undefined | null;
  return normalizeTimestamp(anyTask?.__event_timestamp) ||
    normalizeTimestamp(task?.updated_at ?? task?.finished_at ?? task?.started_at ?? task?.created_at ?? 0);
};

const getTaskEventSequence = (task?: TaskItem | null) => {
  const anyTask = task as (TaskItem & { __event_sequence?: unknown }) | undefined | null;
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

export const useAnalysisTaskStatus = (taskType: string | string[]): AnalysisTaskStatus => {
  const tasks = useAnalysisStore((state) => state.tasks);
  const candidateTypes = Array.isArray(taskType)
    ? taskType.flatMap((value) => getTaskTypeCandidates(value))
    : getTaskTypeCandidates(taskType);
  const candidateSet = new Set(candidateTypes);

  const filteredTasks = Array.isArray(tasks)
    ? tasks.filter((task) => {
        const rawType = typeof task?.task_type === 'string' ? task.task_type : '';
        return candidateSet.has(rawType);
      })
    : ([] as TaskItem[]);

  const sortedTasks = filteredTasks.slice().sort((a, b) => {
    const tsDelta = getTaskTimestamp(b) - getTaskTimestamp(a);
    if (tsDelta !== 0) {
      return tsDelta;
    }
    return getTaskEventSequence(b) - getTaskEventSequence(a);
  });

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

  const latestTask = sortedTasks[0] ?? null;
  const latestState = (latestTask?.state ?? '').toLowerCase();
  const activeCandidate = latestTask
    ? latestState === 'running' || PENDING_STATES.has(latestState)
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

  return useMemo(
    () => ({
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
    }),
    [
      sortedTasks.map((t) => `${t.task_id}:${t.state}`).join(','),
      runningTask?.task_id ?? '',
      queuedTask?.task_id ?? '',
      successfulTask?.task_id ?? '',
      failedTask?.task_id ?? '',
      cancelledTask?.task_id ?? '',
      terminalTask?.task_id ?? '',
      activeTaskId,
      bannerStatus,
      bannerTaskId,
      bannerMessage,
    ]
  );
};
