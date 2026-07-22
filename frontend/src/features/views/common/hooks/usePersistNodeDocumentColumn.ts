import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { updateNode } from '@/api';
import type { WorkspaceGraphNode, WorkspaceGraphResponse, WorkspaceNodeInfo } from '@/api';
import { invalidateNodeInfoQuery } from '@/lib/nodeInfo';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Projects the full node-info response into the graph endpoint's lightweight
 * summary shape.
 * Called by: updateWorkspaceNodeInfoCache because graph caches should not be
 * repopulated with schema, shape, tokenizer, or dtype metadata after a
 * preference write.
 */
function toGraphNodeSummary(
  nodeInfo: WorkspaceNodeInfo,
): Pick<WorkspaceGraphNode, 'id' | 'name' | 'parent_ids' | 'child_ids' | 'document' | 'color'> {
  return {
    id: nodeInfo.id,
    name: nodeInfo.name,
    parent_ids: nodeInfo.parent_ids,
    child_ids: nodeInfo.child_ids,
    document: nodeInfo.document,
    color: nodeInfo.color,
  };
}

/**
 * Updates graph-summary caches after node preference writes so graph panels see
 * the persisted metadata immediately, then invalidates every batched node-info
 * query that contains the edited Data Block.
 */
function updateWorkspaceNodeInfoCache(
  queryClient: QueryClient,
  workspaceId: string,
  nodeInfo: WorkspaceNodeInfo,
) {
  queryClient.setQueryData<WorkspaceGraphResponse>(
    queryKeys.workspaceGraph(workspaceId),
    (previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        nodes: previous.nodes.map((node) =>
          node.id === nodeInfo.id ? { ...node, ...toGraphNodeSummary(nodeInfo) } : node,
        ),
      };
    },
  );
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(workspaceId) });
  invalidateNodeInfoQuery(queryClient, workspaceId, nodeInfo.id);
}

/**
 * Returns the mutation used by node/column selectors to persist a preferred
 * document column and keep cached workspace metadata in sync.
 * Used by: analysis selectors that let users choose a document column per node.
 * Flow: capture QueryClient and workspace identity, return a document-column mutation that trims empty values, writes the backend preference, updates caches, and shows a toast on failure.
 */
export function usePersistNodeDocumentColumn({
  workspaceId,
}: {
  workspaceId: string | null | undefined;
}) {
  const queryClient = useQueryClient();

  return useCallback(
    async (nodeId: string, column: string) => {
      if (!workspaceId) return null;
      try {
        const { data } = await updateNode({
          path: { workspace_id: workspaceId, node_id: nodeId },
          body: { document: column.trim() || null },
          throwOnError: true,
        });
        updateWorkspaceNodeInfoCache(queryClient, workspaceId, data);
        return data;
      } catch {
        toast.error('Could not save the document column for this data block.');
        return null;
      }
    },
    [queryClient, workspaceId],
  );
}
