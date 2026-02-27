import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { textApi } from '../../../../api/text';

export type ServerLockAnalysisType =
  | 'token_frequencies'
  | 'quotation_analysis'
  | 'concordance_analysis'
  | 'topic_modeling'
  | 'sequential_analysis';

const ANALYSIS_REQUEST_FN: Record<ServerLockAnalysisType, (taskId: string, headers: Record<string, string>) => Promise<unknown>> = {
  token_frequencies: textApi.getTokenFrequenciesTaskRequest,
  quotation_analysis: textApi.getQuotationTaskRequest,
  concordance_analysis: textApi.getConcordanceTaskRequest,
  topic_modeling: textApi.getTopicModelingTaskRequest,
  sequential_analysis: textApi.getSequentialAnalysisTaskRequest,
};

export const analysisServerRequestLockQueryKey = (
  analysisType: ServerLockAnalysisType,
  workspaceId: string | null
) => ['analysis', analysisType, 'server-request-lock', workspaceId] as const;

type Args = {
  analysisType: ServerLockAnalysisType;
  workspaceId: string | null;
  getAuthHeaders: () => Record<string, string>;
};

export function useAnalysisServerRequestLock({ analysisType, workspaceId, getAuthHeaders }: Args) {
  const query = useQuery({
    queryKey: analysisServerRequestLockQueryKey(analysisType, workspaceId),
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      if (!workspaceId) {
        return {
          hasServerRequest: false,
          currentTaskId: null,
          serverRequest: null as Record<string, unknown> | null,
        };
      }

      const current = await textApi.getAnalysisCurrent(analysisType, getAuthHeaders());
      const taskIds = (current as any)?.task_ids;
      const currentTaskId = Array.isArray(taskIds)
        ? taskIds.find((id) => typeof id === 'string' && id.length > 0) ?? null
        : null;

      const hasServerRequest = Boolean(currentTaskId);
      let serverRequest: Record<string, unknown> | null = null;

      if (currentTaskId) {
        const request = await ANALYSIS_REQUEST_FN[analysisType](currentTaskId, getAuthHeaders());
        serverRequest = request && typeof request === 'object' ? (request as Record<string, unknown>) : null;
      }

      return { hasServerRequest, currentTaskId, serverRequest };
    },
    staleTime: 30_000,
  });

  return React.useMemo(
    () => ({
      hasServerRequest: Boolean(query.data?.hasServerRequest),
      currentTaskId: query.data?.currentTaskId ?? null,
      serverRequest: query.data?.serverRequest ?? null,
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      refetch: query.refetch,
    }),
    [
      query.data?.hasServerRequest,
      query.data?.currentTaskId,
      query.data?.serverRequest,
      query.isLoading,
      query.isFetching,
      query.refetch,
    ]
  );
}
