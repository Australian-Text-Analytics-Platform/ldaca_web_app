import type { TaskItem } from '../stores/analysisStore';

export const CANONICAL_TASK_TYPE_MAP = {
  topic_modeling: 'topic_modeling',
  token_frequencies: 'token_frequencies',
  'token-frequency': 'token_frequencies',
  sequential_analysis: 'sequential_analysis',
  concordance: 'concordance',
  quotation: 'quotation',
} as const;

export type CanonicalTaskType =
  | 'topic_modeling'
  | 'token_frequencies'
  | 'sequential_analysis'
  | 'concordance'
  | 'quotation';

export const normalizeTaskTypeKey = (taskType: string): string => {
  const normalized = taskType.trim();
  return CANONICAL_TASK_TYPE_MAP[normalized as keyof typeof CANONICAL_TASK_TYPE_MAP] ?? normalized;
};

export const getTaskTypeCandidates = (taskType: string): string[] => {
  const canonical = normalizeTaskTypeKey(taskType);
  const aliases = Object.entries(CANONICAL_TASK_TYPE_MAP)
    .filter(([, value]) => value === canonical)
    .map(([key]) => key);
  return Array.from(new Set([canonical, ...aliases]));
};

export const normalizeTaskDedupeKey = (
  taskId: string | null | undefined,
  state: string | null | undefined
): string | null => {
  const normalizedTaskId = normalizeTaskId(taskId);
  const normalizedState = typeof state === 'string' && state.trim().length > 0 ? state.trim() : null;
  if (!normalizedTaskId || !normalizedState) {
    return null;
  }
  return `${normalizedTaskId}:${normalizedState}`;
};

type TaskOperation = (workspaceId: string, taskId: string) => Promise<unknown>;

const normalizeTaskId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const collectTaskIds = (candidateIds: Array<string | null | undefined>): string[] => {
  const ids = candidateIds
    .map((value) => normalizeTaskId(value))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(ids));
};

interface ResolveAnalysisTaskIdOptions {
  candidateIds: Array<string | null | undefined>;
  fetchCurrentTaskId?: () => Promise<string | null>;
  onResolved?: (taskId: string | null) => void;
}

export const resolveAnalysisTaskId = async ({
  candidateIds,
  fetchCurrentTaskId,
  onResolved,
}: ResolveAnalysisTaskIdOptions): Promise<string | null> => {
  const fromCandidates = collectTaskIds(candidateIds)[0] ?? null;
  if (fromCandidates) {
    onResolved?.(fromCandidates);
    return fromCandidates;
  }

  if (!fetchCurrentTaskId) {
    onResolved?.(null);
    return null;
  }

  try {
    const fetched = normalizeTaskId(await fetchCurrentTaskId());
    onResolved?.(fetched);
    return fetched;
  } catch {
    onResolved?.(null);
    return null;
  }
};

interface ClearAnalysisTaskResultsOptions {
  workspaceId: string;
  taskIds: string[];
  clearTask: TaskOperation;
  warnContext?: string;
}

export const clearAnalysisTaskResults = async ({
  workspaceId,
  taskIds,
  clearTask,
  warnContext,
}: ClearAnalysisTaskResultsOptions): Promise<void> => {
  const ids = collectTaskIds(taskIds);
  if (ids.length === 0) {
    return;
  }

  const settled = await Promise.allSettled(
    ids.map((taskId) => clearTask(workspaceId, taskId))
  );

  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      const label = warnContext ? `[${warnContext}]` : '[analysis]';
      console.warn(`${label} failed to clear task ${ids[index]}`, result.reason);
    }
  });
};

interface ClearAnalysisTaskArtifactsOptions {
  workspaceId: string;
  taskIds: string[];
  clearManagerTask?: TaskOperation;
  warnContext?: string;
}

const runTaskOperation = async (
  operation: TaskOperation | undefined,
  workspaceId: string,
  taskId: string,
  label: string,
  warnContext?: string
): Promise<void> => {
  if (!operation) {
    return;
  }
  try {
    await operation(workspaceId, taskId);
  } catch (error) {
    const context = warnContext ? `[${warnContext}]` : '[analysis]';
    console.warn(`${context} failed to ${label} task ${taskId}`, error);
  }
};

export const clearAnalysisTaskArtifacts = async ({
  workspaceId,
  taskIds,
  clearManagerTask,
  warnContext,
}: ClearAnalysisTaskArtifactsOptions): Promise<void> => {
  const ids = collectTaskIds(taskIds);
  if (ids.length === 0) {
    return;
  }

  await Promise.all(
    ids.map(async (taskId) => {
      await runTaskOperation(clearManagerTask, workspaceId, taskId, 'clear', warnContext);
    })
  );
};

export const pruneTasksById = <T extends Pick<TaskItem, 'task_id'>>(
  tasks: T[],
  taskIds: string[]
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
