import type { QueryClient } from '@tanstack/react-query';
import type { WorkspaceNodeInfo } from '@/api';
import type { ArrowColumn } from '@/lib/arrow/arrowTable';
import { fetchNodeSchema } from '@/lib/nodeSchema';
import { queryKeys } from '@/lib/queryKeys';

interface RefreshWorkspaceNodeSchemaParams {
  queryClient: QueryClient;
  workspaceId: string | null;
  nodeId: string;
}

/**
 * Refreshes schema metadata for a node that still exists in the current graph.
 * Used by: useWorkspaceNodeMutations action facade for table and graph
 * consumers that need a manual schema refresh after column-level operations.
 * Flow: skip missing workspace/node graph entries, then force-fetch Arrow schema.
 */
export const refreshWorkspaceNodeSchema = async ({
  queryClient,
  workspaceId,
  nodeId,
}: RefreshWorkspaceNodeSchemaParams): Promise<ArrowColumn[] | null> => {
  if (!workspaceId) return null;
  const graphData = queryClient.getQueryData<{ nodes: WorkspaceNodeInfo[] }>(
    queryKeys.workspaceGraph(workspaceId),
  );
  const nodeExists = (graphData?.nodes ?? []).some((node) => node.id === nodeId);
  if (!nodeExists) return null;

  return fetchNodeSchema({ queryClient, workspaceId, nodeId, force: true });
};
