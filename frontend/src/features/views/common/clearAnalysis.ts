import { clearTabAnalysis } from '@/api';
import { collectTaskIds } from '@/features/views/common/analysisTaskUtils';
import { lastRunRequestQueryKey, type LastRunAnalysisType } from './hooks/useLastRunRequest';

interface QueryClientLike {
  invalidateQueries: (params: { queryKey: readonly unknown[] }) => Promise<unknown>;
}

/**
 * Describes the clear workflow shared by Analysis features that mirror backend
 * lifecycle state in the local UI.
 */
export interface ClearAnalysisOptions {
  analysisType: LastRunAnalysisType;
  workspaceId: string;
  tabId: string;
  queryClient: QueryClientLike;
  taskIdSources: (string | null | undefined)[];
  resolveTaskId?: () => Promise<string | null>;
  onCleanup: (clearedTaskIds: string[]) => void;
}

/**
 * Clears the Tab's attached backend Analysis, then cleans local state and
 * invalidates the last-run request cache. Backend clear is the commit boundary:
 * if it fails, the error propagates and local state remains unchanged.
 */
export async function clearAnalysis({
  analysisType,
  workspaceId,
  tabId,
  queryClient,
  taskIdSources,
  resolveTaskId,
  onCleanup,
}: ClearAnalysisOptions): Promise<void> {
  const initialIds = collectTaskIds(taskIdSources);
  let allTaskIds = initialIds;

  if (resolveTaskId) {
    const resolvedId = await resolveTaskId();
    allTaskIds = collectTaskIds([...initialIds, resolvedId]);
  }
  await clearTabAnalysis({
    path: { workspace_id: workspaceId, tab_id: tabId },
    throwOnError: true,
  });
  onCleanup(allTaskIds);
  void queryClient.invalidateQueries({
    queryKey: lastRunRequestQueryKey(analysisType, workspaceId),
  });
}
