import { infiniteQueryOptions } from '@tanstack/react-query';
import { listAnalyses, type AnalysisPage } from '@/api';
import { queryKeys } from '@/lib/queryKeys';

const WORKSPACE_ANALYSES_PAGE_SIZE = 500;

/**
 * Defines the sole cache shape for a Workspace's paginated Analysis collection.
 * Every observer sharing workspaceAnalyses must consume InfiniteData<AnalysisPage>.
 */
export const workspaceAnalysesQueryOptions = (workspaceId: string | null) =>
  infiniteQueryOptions({
    queryKey: workspaceId
      ? queryKeys.workspaceAnalyses(workspaceId)
      : queryKeys.inactiveWorkspaceAnalyses,
    queryFn: async ({ pageParam }): Promise<AnalysisPage> => {
      if (!workspaceId) throw new Error('Missing workspace ID');
      const { data } = await listAnalyses({
        path: { workspace_id: workspaceId },
        query: { page: pageParam, page_size: WORKSPACE_ANALYSES_PAGE_SIZE },
        throwOnError: true,
      });
      return data;
    },
    initialPageParam: 1,
    getNextPageParam: (page) => (page.page < page.total_pages ? page.page + 1 : undefined),
    enabled: Boolean(workspaceId),
  });
