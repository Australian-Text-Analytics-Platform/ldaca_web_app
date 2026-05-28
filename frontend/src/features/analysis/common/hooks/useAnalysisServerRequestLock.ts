import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import {
  getAnalysisTaskRequest,
  getCurrentAnalysisTask,
  type ServerLockAnalysisType,
} from '../analysisTasksApi';

export type { ServerLockAnalysisType };

/**
 * Names the query cache entry shared by hydration, lock comparison, and clear
 * flows for the active analysis task request.
 * Used by: lock, hydration, and clear helpers that share server request state because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 */
export const analysisServerRequestLockQueryKey = (
  analysisType: ServerLockAnalysisType,
  workspaceId: string | null
) => queryKeys.analysisServerRequestLock(analysisType, workspaceId);

type Args = {
  analysisType: ServerLockAnalysisType;
  workspaceId: string | null;
  getAuthHeaders: () => Record<string, string>;
};

/**
 * Fetches the backend's current task and original request payload so analysis
 * tabs can restore locks without issuing duplicate current/request calls.
 * Used by: useAnalysisLock and direct cache readers in useAnalysisFeature because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
 */
export function useAnalysisServerRequestLock({ analysisType, workspaceId, getAuthHeaders }: Args) {
  const query = useQuery({
    queryKey: analysisServerRequestLockQueryKey(analysisType, workspaceId),
    enabled: Boolean(workspaceId),
        /**
     * Called by: TanStack Query when refreshing the analysis server-request lock because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
     * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
     */
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
