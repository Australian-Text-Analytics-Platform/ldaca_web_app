import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { getAnalysisTaskRequest, type LastRunAnalysisType } from '../analysisTasksApi';

export type { LastRunAnalysisType };

/** Query key shared by hydration, clear, and Run/Re-run diffing for a tab's last-run request. */
export const lastRunRequestQueryKey = (
  analysisType: LastRunAnalysisType,
  workspaceId: string | null,
  taskId?: string | null,
) => {
  const base = queryKeys.analysisLastRunRequest(analysisType, workspaceId);
  return taskId === undefined ? base : ([...base, taskId ?? 'none'] as const);
};

interface Args {
  analysisType: LastRunAnalysisType;
  workspaceId: string | null;
  /** Active analysis tab's task id; null means the tab has not run yet. */
  taskId?: string | null;
}

/**
 * Fetches the backend request payload for an analysis tab's last run.
 *
 * Analysis panels use this payload to decide whether current params/inputs match
 * the last run (disabled button) or have changed (enabled Re-run). The query is
 * keyed by the tab's task id so sibling tabs can compare against independent
 * last-run requests.
 */
export function useLastRunRequest({ analysisType, workspaceId, taskId }: Args) {
  const queryKey = lastRunRequestQueryKey(analysisType, workspaceId, taskId ?? null);

  const query = useQuery({
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const empty = {
        hasLastRunRequest: false,
        taskId: null,
        serverRequest: null as Record<string, unknown> | null,
      };
      if (!workspaceId || !taskId) {
        return empty;
      }
      try {
        const request = await getAnalysisTaskRequest(
          analysisType,
          workspaceId,
          taskId,
        );
        const serverRequest =
          request && typeof request === 'object' ? (request as Record<string, unknown>) : null;
        return {
          hasLastRunRequest: Boolean(serverRequest),
          taskId,
          serverRequest,
        };
      } catch {
        return empty;
      }
    },
    staleTime: 30_000,
  });

  return {
    hasLastRunRequest: Boolean(query.data?.hasLastRunRequest),
    taskId: query.data?.taskId ?? null,
    serverRequest: query.data?.serverRequest ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
