import { queryOptions, useQuery } from '@tanstack/react-query';
import { listTabs } from '@/api';
import { queryKeys } from '@/lib/queryKeys';

/** One authoritative Tab collection shared by every analysis view and desktop quick access. */
const workspaceTabsQueryOptions = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.workspaceTabs(workspaceId),
    staleTime: 15_000,
    queryFn: async () => {
      const { data } = await listTabs({
        path: { workspace_id: workspaceId },
        throwOnError: true,
      });
      return data;
    },
  });

export function useWorkspaceTabResources(workspaceId: string | null | undefined) {
  return useQuery({
    ...workspaceTabsQueryOptions(workspaceId ?? '__none__'),
    enabled: Boolean(workspaceId),
  });
}
