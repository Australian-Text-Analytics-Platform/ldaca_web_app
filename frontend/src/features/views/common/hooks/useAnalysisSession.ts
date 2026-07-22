import { useQuery } from '@tanstack/react-query';
import type { Analysis } from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import { getAnalysisOutputResource, getAnalysisResource } from '../analysisApi';

export const analysisSessionKeys = {
  analysis: queryKeys.analysis,
  results: queryKeys.analysisResult,
};

interface UseAnalysisSessionOptions<TResult> {
  workspaceId: string | null;
  analysisId: string | null;
  resultQuery?: Readonly<Record<string, unknown>>;
  loadResult?: (
    workspaceId: string,
    analysisId: string,
    query?: Readonly<Record<string, unknown>>,
  ) => Promise<TResult>;
}

export interface HydrationState {
  status: 'idle' | 'loading' | 'error';
  error?: string;
}

/**
 * Pairs the durable Analysis lifecycle with its output-only Result while
 * keeping them as independent server resources in the query cache.
 */
export function useAnalysisSession<TResult>({
  workspaceId,
  analysisId,
  resultQuery: projectionQuery,
  loadResult,
}: UseAnalysisSessionOptions<TResult>) {
  const enabled = Boolean(workspaceId && analysisId);
  const analysisQuery = useQuery({
    queryKey:
      workspaceId && analysisId
        ? analysisSessionKeys.analysis(workspaceId, analysisId)
        : ['analysis-session', '__inactive__', 'analysis'],
    enabled,
    queryFn: async (): Promise<Analysis> => {
      if (!workspaceId || !analysisId) throw new Error('Analysis session is not active');
      return getAnalysisResource(workspaceId, analysisId);
    },
  });
  const resultResourceQuery = useQuery<TResult>({
    queryKey:
      workspaceId && analysisId
        ? queryKeys.analysisResult(workspaceId, analysisId, projectionQuery)
        : ['analysis-session', '__inactive__', 'result'],
    enabled: enabled && analysisQuery.data?.state === 'succeeded',
    queryFn: async (): Promise<TResult> => {
      if (!workspaceId || !analysisId) throw new Error('Analysis session is not active');
      if (loadResult) return loadResult(workspaceId, analysisId, projectionQuery);
      return (await getAnalysisOutputResource(workspaceId, analysisId)) as TResult;
    },
  });

  return {
    analysis: analysisQuery.data ?? null,
    request: analysisQuery.data?.request ?? null,
    result: resultResourceQuery.data ?? null,
    lifecycleError: analysisQuery.data?.error?.message ?? null,
    resultError: resultResourceQuery.error,
    isAnalysisLoading: analysisQuery.isLoading,
    isResultLoading: resultResourceQuery.isLoading,
    isLoading: analysisQuery.isLoading || resultResourceQuery.isLoading,
  };
}
