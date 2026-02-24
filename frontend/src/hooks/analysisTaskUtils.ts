import type { TaskItem } from '../stores/analysisStore';

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
  clearAnalysisTask: TaskOperation;
  warnContext?: string;
}

export const clearAnalysisTaskResults = async ({
  workspaceId,
  taskIds,
  clearAnalysisTask,
  warnContext,
}: ClearAnalysisTaskResultsOptions): Promise<void> => {
  const ids = collectTaskIds(taskIds);
  if (ids.length === 0) {
    return;
  }

  const settled = await Promise.allSettled(
    ids.map((taskId) => clearAnalysisTask(workspaceId, taskId))
  );

  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      const label = warnContext ? `[${warnContext}]` : '[analysis]';
      console.warn(`${label} failed to clear analysis task ${ids[index]}`, result.reason);
    }
  });
};

interface ClearAnalysisTaskArtifactsOptions {
  workspaceId: string;
  taskIds: string[];
  cancelTask?: TaskOperation;
  clearManagerTask?: TaskOperation;
  clearAnalysisTask?: TaskOperation;
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
  cancelTask,
  clearManagerTask,
  clearAnalysisTask,
  warnContext,
}: ClearAnalysisTaskArtifactsOptions): Promise<void> => {
  const ids = collectTaskIds(taskIds);
  if (ids.length === 0) {
    return;
  }

  await Promise.all(
    ids.map(async (taskId) => {
      await runTaskOperation(cancelTask, workspaceId, taskId, 'cancel', warnContext);
      await runTaskOperation(clearManagerTask, workspaceId, taskId, 'clear manager', warnContext);
      if (!clearManagerTask) {
        await runTaskOperation(clearAnalysisTask, workspaceId, taskId, 'clear analysis', warnContext);
      }
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
