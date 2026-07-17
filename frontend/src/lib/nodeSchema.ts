import type { QueryClient } from '@tanstack/react-query';

import { getNodeSchemaTable } from '@/api/tableApi';
import type { ArrowColumn } from '@/lib/arrow/arrowTable';
import { queryKeys } from '@/lib/queryKeys';

interface NodeSchemaQueryArgs {
  workspaceId: string;
  nodeId: string;
}

export const nodeSchemaQueryOptions = ({ workspaceId, nodeId }: NodeSchemaQueryArgs) => ({
  queryKey: queryKeys.nodeSchema(workspaceId, nodeId),
  staleTime: 60_000,
  queryFn: async (): Promise<ArrowColumn[]> => {
    const table = await getNodeSchemaTable({
      path: { workspace_id: workspaceId, node_id: nodeId },
    });
    return table.schema;
  },
});

export const fetchNodeSchema = async ({
  queryClient,
  workspaceId,
  nodeId,
  force = false,
}: NodeSchemaQueryArgs & { queryClient: QueryClient; force?: boolean }): Promise<ArrowColumn[]> => {
  if (force) {
    queryClient.removeQueries({ queryKey: queryKeys.nodeSchema(workspaceId, nodeId) });
  }
  return queryClient.fetchQuery(nodeSchemaQueryOptions({ workspaceId, nodeId }));
};

export const invalidateNodeSchemaQuery = (
  queryClient: QueryClient,
  workspaceId: string,
  nodeId?: string,
): void => {
  void queryClient.invalidateQueries({
    queryKey: nodeId
      ? queryKeys.nodeSchema(workspaceId, nodeId)
      : ['workspaces', workspaceId, 'nodes'],
  });
};
