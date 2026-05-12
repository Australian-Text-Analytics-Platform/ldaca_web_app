import { workspacesApi } from '@/api/workspaces';
import { collectTaskIds } from '@/hooks/analysisTaskUtils';
import {
  analysisServerRequestLockQueryKey,
  type ServerLockAnalysisType,
} from './hooks/useAnalysisServerRequestLock';

interface QueryClientLike {
  invalidateQueries: (params: { queryKey: readonly unknown[] }) => Promise<unknown>;
}

export interface ClearAnalysisOptions {
  analysisType: ServerLockAnalysisType;
  workspaceId: string;
  queryClient: QueryClientLike;
  taskIdSources: Array<string | null | undefined>;
  resolveTaskId?: () => Promise<string | null>;
  getAuthHeaders: () => Record<string, string>;
  onCleanup: (clearedTaskIds: string[]) => void;
}

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
        workspacesApi.clearTasks({ task_id: taskId }, headers),
      ),
    );

    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(
          `[${analysisType}] Failed to clear task ${allTaskIds[index]}`,
          result.reason,
        );
      }
    });
  } catch (error) {
    console.warn(`[${analysisType}] Failed to clear tasks:`, error);
  } finally {
    onCleanup(allTaskIds);
    void queryClient.invalidateQueries({
      queryKey: analysisServerRequestLockQueryKey(analysisType, workspaceId),
    });
  }
}
