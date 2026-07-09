import type { TaskItem } from '@/stores/analysisStore';

/** Returns the canonical task type a UI feature should watch. */
/** Used by: src/features/views/common/tasks/policies.ts, src/features/views/common/tasks/useAnalysisTaskFlow.ts, src/hooks/useAnalysisTaskStatus.ts because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
export const getTaskTypeCandidates = (taskType: string): string[] => {
  const normalized = taskType.trim();
  return normalized ? [normalized] : [];
};

/** Builds a stable key for deduping repeated task-state events from task streams. */
/** Used by: src/features/views/common/tasks/useAnalysisTaskFlow.ts because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
export const normalizeTaskDedupeKey = (
  taskId: string | null | undefined,
  state: string | null | undefined,
): string | null => {
  const normalizedTaskId = normalizeTaskId(taskId);
  const normalizedState =
    typeof state === 'string' && state.trim().length > 0 ? state.trim() : null;
  if (!normalizedTaskId || !normalizedState) {
    return null;
  }
  return `${normalizedTaskId}:${normalizedState}`;
};

/** Treats blank, missing, and non-string task ids as absent before API calls. */
/** Called by: normalizeTaskDedupeKey and task id collection in this module. */
const normalizeTaskId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Collects unique valid task ids from local state, route params, or server responses. */
/** Used by: src/features/views/common/clearAnalysis.ts, src/features/views/common/hooks/useAnalysisFeature.ts because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
export const collectTaskIds = (candidateIds: (string | null | undefined)[]): string[] => {
  const ids = candidateIds
    .map((value) => normalizeTaskId(value))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(ids));
};

interface ResolveAnalysisTaskIdOptions {
  candidateIds: (string | null | undefined)[];
  onResolved?: (taskId: string | null) => void;
}

/** Resolves the best explicit task id for cleanup/result-fetch flows. */
/**
 * Used by: src/features/views/common/hooks/useAnalysisFeature.ts because the hook needs local steps to normalize inputs before exposing stable state to consumers.
 * Flow: prefer valid local candidate ids, then notify the resolver callback.
 */
export const resolveAnalysisTaskId = ({
  candidateIds,
  onResolved,
}: ResolveAnalysisTaskIdOptions): string | null => {
  const fromCandidates = collectTaskIds(candidateIds)[0] ?? null;
  if (fromCandidates) {
    onResolved?.(fromCandidates);
    return fromCandidates;
  }

  onResolved?.(null);
  return null;
};

/** Removes completed/cleared tasks from the Zustand task list after task cleanup succeeds. */
/** Used by: src/features/views/concordance/ConcordanceFeature.tsx, src/features/views/token-frequency/TokenFrequencyFeature.tsx, src/features/views/topic-modeling/TopicModelingFeature.tsx because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
export const pruneTasksById = <T extends Pick<TaskItem, 'task_id'>>(
  tasks: T[],
  taskIds: string[],
): T[] => {
  const blocked = new Set(collectTaskIds(taskIds));
  if (blocked.size === 0) {
    return tasks;
  }
  return tasks.filter((task) => {
    const taskId = normalizeTaskId(task.task_id);
    return !taskId || !blocked.has(taskId);
  });
};
