import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import {
  getAnalysisTaskRequest,
  getCurrentAnalysisTask,
  type ServerLockAnalysisType,
} from '../analysisTasksApi';

export type { ServerLockAnalysisType };

export const analysisServerRequestLockQueryKey = (
  analysisType: ServerLockAnalysisType,
  workspaceId: string | null
) => queryKeys.analysisServerRequestLock(analysisType, workspaceId);

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

      const current = await getCurrentAnalysisTask(analysisType, getAuthHeaders());
      const taskIds = (current as Record<string, unknown>)?.task_ids;
      const currentTaskId = Array.isArray(taskIds)
        ? taskIds.find((id) => typeof id === 'string' && id.length > 0) ?? null
        : null;

      const hasServerRequest = Boolean(currentTaskId);
      let serverRequest: Record<string, unknown> | null = null;

      if (currentTaskId) {
        const request = await getAnalysisTaskRequest(analysisType, currentTaskId, getAuthHeaders());
        serverRequest = request && typeof request === 'object' ? (request as Record<string, unknown>) : null;
      }

      return { hasServerRequest, currentTaskId, serverRequest };
    },
    staleTime: 30_000,
  });

  return {
    hasServerRequest: Boolean(query.data?.hasServerRequest),
    currentTaskId: query.data?.currentTaskId ?? null,
    serverRequest: query.data?.serverRequest ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
