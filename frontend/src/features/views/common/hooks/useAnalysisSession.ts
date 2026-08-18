import { useQuery } from '@tanstack/react-query';
import type { Analysis } from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import { getAnalysisResource } from '../analysisApi';

interface UseAnalysisSessionOptions<TResult> {
  workspaceId: string | null;
  analysisId: string | null;
  resultQuery?: Readonly<Record<string, unknown>>;
  resultRequestKey?: number;
  resultCacheMode?: 'default' | 'no-store';
  loadResult: (
    workspaceId: string,
    analysisId: string,
    query?: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ) => Promise<TResult>;
}

/**
 * Pairs the durable Analysis lifecycle with its output-only Result while
 * keeping them as independent server resources in the query cache.
 */
export function useAnalysisSession<TResult>({
  workspaceId,
  analysisId,
  resultQuery: projectionQuery,
  resultRequestKey,
  resultCacheMode = 'default',
  loadResult,
}: UseAnalysisSessionOptions<TResult>) {
  const enabled = Boolean(workspaceId && analysisId);
  const resultScope =
    workspaceId && analysisId ? queryKeys.analysisResults(workspaceId, analysisId) : null;
  const analysisQuery = useQuery({
    queryKey:
      workspaceId && analysisId
        ? queryKeys.analysis(workspaceId, analysisId)
        : queryKeys.inactiveAnalysis,
    enabled,
    queryFn: async (): Promise<Analysis> => {
      if (!workspaceId || !analysisId) throw new Error('Analysis session is not active');
      return getAnalysisResource(workspaceId, analysisId);
    },
  });
  const noStore = resultCacheMode === 'no-store';
  // `resultRequestKey` distinguishes explicit no-store attempts in the client
  // cache only. `loadResult` receives the unchanged backend query payload.
  const resultResourceQuery = useQuery<TResult>({
    queryKey:
      workspaceId && analysisId
        ? queryKeys.analysisResult(workspaceId, analysisId, projectionQuery, resultRequestKey)
        : queryKeys.inactiveAnalysisResult(projectionQuery, resultRequestKey),
    enabled: enabled && analysisQuery.data?.state === 'succeeded',
    // A paginated observer may retain its last same-Analysis shape while the
    // feature replaces stale rows with a processing body. Never bridge this
    // placeholder across Analysis or Workspace ownership boundaries.
    placeholderData: (previousData, previousQuery) => {
      if (!projectionQuery || !resultScope || !previousQuery) return undefined;
      const previousKey = previousQuery.queryKey;
      const belongsToCurrentAnalysis = resultScope.every(
        (segment, index) => previousKey[index] === segment,
      );
      return belongsToCurrentAnalysis ? previousData : undefined;
    },
    queryFn: async ({ signal }): Promise<TResult> => {
      if (!workspaceId || !analysisId) throw new Error('Analysis session is not active');
      return loadResult(workspaceId, analysisId, projectionQuery, signal);
    },
    gcTime: noStore ? 0 : undefined,
    staleTime: noStore ? Number.POSITIVE_INFINITY : undefined,
    refetchOnWindowFocus: noStore ? false : undefined,
    refetchOnReconnect: noStore ? false : undefined,
  });

  return {
    analysis: analysisQuery.data ?? null,
    result: resultResourceQuery.data ?? null,
    isResultFetching: resultResourceQuery.isFetching,
    isResultPlaceholderData: resultResourceQuery.isPlaceholderData,
    resultError:
      resultResourceQuery.error instanceof Error ? resultResourceQuery.error.message : null,
    retryResult: () => {
      void resultResourceQuery.refetch();
    },
  };
}
