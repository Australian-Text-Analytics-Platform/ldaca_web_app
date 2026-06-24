import type { QueryClient } from '@tanstack/react-query';
import { type WorkspaceGraphResponse } from '@/api';
import { queryKeys } from '@/lib/queryKeys';

interface ResolveCreatedNodeIdParams {
  createdNode: Record<string, unknown>;
  queryClient: QueryClient;
  workspaceId: string | null;
  previousNodeIds: string[];
}

/**
 * Reads the created-node id variants returned by graph-combining endpoints.
 * Used by: join and concat mutations because older backend routes can return
 * either `node_id` or `id` for the created workspace node.
 */
const getCreatedNodeIdFromResponse = (createdNode: Record<string, unknown>) =>
  (createdNode.node_id as string | undefined) ?? (createdNode.id as string | undefined) ?? null;

/**
 * Resolves the node that should become selected after a join/concat operation.
 * Used by: useWorkspaceNodeMutations success handlers so both combined-node
 * actions share the same response-first, graph-diff fallback.
 * Flow: prefer the id returned by the backend, otherwise revalidate the graph
 * and select the single node id absent from the pre-mutation snapshot.
 */
export const resolveCreatedNodeId = async ({
  createdNode,
  queryClient,
  workspaceId,
  previousNodeIds,
}: ResolveCreatedNodeIdParams) => {
  const responseNodeId = getCreatedNodeIdFromResponse(createdNode);
  if (responseNodeId || !workspaceId) return responseNodeId;

  await queryClient.invalidateQueries({
    queryKey: queryKeys.workspaceGraph(workspaceId),
  });
  const freshGraph = queryClient.getQueryData<WorkspaceGraphResponse>(
    queryKeys.workspaceGraph(workspaceId),
  );
  const newNodeIds = (freshGraph?.nodes ?? [])
    .map((node) => node.id)
    .filter((id) => !previousNodeIds.includes(id));

  return newNodeIds.length === 1 ? newNodeIds[0] : null;
};
