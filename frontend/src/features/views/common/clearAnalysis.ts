import { clearTask } from '@/api';
import { collectTaskIds } from '@/features/views/common/analysisTaskUtils';
import { lastRunRequestQueryKey, type LastRunAnalysisType } from './hooks/useLastRunRequest';

interface QueryClientLike {
  invalidateQueries: (params: { queryKey: readonly unknown[] }) => Promise<unknown>;
}

/**
 * Describes the clear workflow shared by analysis features that mirror task
 * state in both the backend task cache and local UI state.
 */
export interface ClearAnalysisOptions {
  analysisType: LastRunAnalysisType;
  workspaceId: string;
  queryClient: QueryClientLike;
  taskIdSources: (string | null | undefined)[];
  resolveTaskId?: () => Promise<string | null>;
  getAuthHeaders: () => Record<string, string>;
  onCleanup: (clearedTaskIds: string[]) => void;
}

/**
 * Clears backend task records, local task state, and the last-run request cache so
 * analysis feature hooks can reset without leaving stale running-task metadata.
 * Used by: useAnalysisFeature clear/cleanup flows because every task-backed tab must delete known task ids, invalidate task caches, and release local state together.
 * Flow: normalize inputs, apply the analysis-specific branch, then return the derived value consumed by the caller.
 */
export async function clearAnalysis({
  analysisType,
  workspaceId,
  queryClient,
  taskIdSources,
  resolveTaskId,
  getAuthHeaders,
  onCleanup,
}: ClearAnalysisOptions): Promise<void> {
  const initialIds = collectTaskIds(taskIdSources);
  let allTaskIds = initialIds;

  try {
    const headers = getAuthHeaders();

    if (resolveTaskId) {
      const resolvedId = await resolveTaskId();
      allTaskIds = collectTaskIds([...initialIds, resolvedId]);
    }

    const settled = await Promise.allSettled(
      allTaskIds.map((taskId) =>
        clearTask({ headers, path: { task_id: taskId }, throwOnError: true }),
      ),
    );

    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(
          `[${analysisType}] Failed to clear task ${String(allTaskIds[index])}`,
          result.reason,
        );
      }
    });
  } catch (error) {
    console.warn(`[${analysisType}] Failed to clear tasks:`, error);
  } finally {
    onCleanup(allTaskIds);
    void queryClient.invalidateQueries({
      queryKey: lastRunRequestQueryKey(analysisType, workspaceId),
    });
  }
}
