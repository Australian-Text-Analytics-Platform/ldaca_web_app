import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { getAnalysisTaskRequest, type ServerLockAnalysisType } from '../analysisTasksApi';

export type { ServerLockAnalysisType };

/**
 * Names the query cache entry shared by hydration, lock comparison, and clear
 * flows for the active analysis task request.
 * Used by: lock, hydration, and clear helpers that share server request state because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 */
export const analysisServerRequestLockQueryKey = (
  analysisType: ServerLockAnalysisType,
  workspaceId: string | null,
) => queryKeys.analysisServerRequestLock(analysisType, workspaceId);

type Args = {
  analysisType: ServerLockAnalysisType;
  workspaceId: string | null;
  getAuthHeaders: () => Record<string, string>;
  // Active analysis tab's task id. Every analysis feature is tab-mounted, so the
  // lock always reflects THIS tab's task rather than a workspace-global current
  // task. A freshly-created tab that has not run yet passes null/undefined and
  // stays unlocked.
  taskId?: string | null;
};

/**
 * Fetches the backend's request payload for an analysis tab's task so the tab
 * can restore locks and parameter-diffs without duplicate current/request calls.
 * Used by: useAnalysisLock and direct cache readers in useAnalysisFeature because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: read caller config, key the query on the tab's task id, fetch that
 * task's request (or treat a missing task as unlocked), then return state.
 */
export function useAnalysisServerRequestLock({
  analysisType,
  workspaceId,
  getAuthHeaders,
  taskId,
}: Args) {
  // Key on the tab's task id so each tab caches and resolves its own lock
  // independently. The 2-arg base key remains the invalidation prefix used by
  // clear/hydration helpers (TanStack matches by prefix, so a base-key
  // invalidation also clears these tab-scoped entries).
  const queryKey = [
    ...analysisServerRequestLockQueryKey(analysisType, workspaceId),
    taskId ?? 'none',
  ] as const;

  const query = useQuery({
    queryKey,
    enabled: Boolean(workspaceId),
    /**
     * Called by: TanStack Query when refreshing the analysis server-request lock because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
     * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
     */
    queryFn: async () => {
      const empty = {
        hasServerRequest: false,
        currentTaskId: null,
        serverRequest: null as Record<string, unknown> | null,
      };
      // A tab without a task is unlocked; otherwise fetch that task's request
      // directly (a cleared/missing task 404s, which we treat as unlocked).
      if (!workspaceId || !taskId) {
        return empty;
      }
      try {
        const request = await getAnalysisTaskRequest(analysisType, taskId, getAuthHeaders());
        const serverRequest =
          request && typeof request === 'object' ? (request as Record<string, unknown>) : null;
        return { hasServerRequest: Boolean(serverRequest), currentTaskId: taskId, serverRequest };
      } catch {
        return empty;
      }
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
