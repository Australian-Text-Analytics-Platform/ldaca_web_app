import { CancelledError, type QueryClient } from '@tanstack/react-query';
import { type WorkspaceGraphResponse } from '@/api';
import { type NodeSchemaResponse } from '@/features/workspace/data-view/types';
import { fetchNodeInfo } from '@/lib/nodeInfo';
import { queryKeys } from '@/lib/queryKeys';
import { normalizeSchemaFromInfo } from './useSchemaManagement';

interface RefreshWorkspaceNodeSchemaParams {
  queryClient: QueryClient;
  workspaceId: string | null;
  nodeId: string;
  authHeaders: Record<string, string>;
}

/**
 * Refreshes schema metadata for a node that still exists in the current graph.
 * Used by: useWorkspaceNodeMutations action facade for table and graph
 * consumers that need a manual schema refresh after column-level operations.
 * Flow: skip missing workspace/node graph entries, force-fetch node info,
 * normalize schema fields, and tolerate TanStack cancellation races by
 * returning null.
 */
export const refreshWorkspaceNodeSchema = async ({
  queryClient,
  workspaceId,
  nodeId,
  authHeaders,
}: RefreshWorkspaceNodeSchemaParams): Promise<NodeSchemaResponse | null> => {
  if (!workspaceId) return null;
  const graphData = queryClient.getQueryData<WorkspaceGraphResponse>(
    queryKeys.workspaceGraph(workspaceId),
  );
  const nodeExists = (graphData?.nodes ?? []).some((node) => node.id === nodeId);
  if (!nodeExists) return null;

  try {
    const info = await fetchNodeInfo({
      queryClient,
      workspaceId,
      nodeId,
      headers: authHeaders,
      force: true,
    });
    const schema = normalizeSchemaFromInfo(info);
    return {
      node_id: nodeId,
      schema,
      columns: Object.keys(schema),
      column_types: schema,
      is_text_data: false,
    };
  } catch (error) {
    // `force: true` removes the existing query first, which can cancel an
    // observer-driven request for the same key. That race means "no fresh
    // schema yet", not a user-visible operation failure.
    if (!(error instanceof CancelledError)) {
      console.error('Failed to refresh node schema:', error);
    }
    return null;
  }
};
