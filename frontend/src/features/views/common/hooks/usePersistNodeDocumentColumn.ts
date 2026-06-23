import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { setNodeDocumentColumn, setNodeTokenizationPreference } from '@/api';
import type { WorkspaceGraphResponse, WorkspaceNodeInfo } from '@/api';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Updates both node-info and graph caches after node preference writes so graph
 * panels and analysis selectors immediately see the persisted metadata.
 * Called by: node document-column and tokenization preference persistence hooks because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: write node-info and workspace-graph query data with the new node info, then invalidate both caches so selectors and graph panels refetch if needed.
 */
function updateWorkspaceNodeInfoCache(
  queryClient: QueryClient,
  workspaceId: string,
  nodeInfo: WorkspaceNodeInfo,
) {
  queryClient.setQueryData<WorkspaceNodeInfo>(
    queryKeys.nodeInfo(workspaceId, nodeInfo.id),
    nodeInfo,
  );
  queryClient.setQueryData<WorkspaceGraphResponse>(
    queryKeys.workspaceGraph(workspaceId),
    (previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        nodes: previous.nodes.map((node) =>
          node.id === nodeInfo.id ? { ...node, ...nodeInfo } : node,
        ),
      };
    },
  );
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(workspaceId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.nodeInfo(workspaceId, nodeInfo.id) });
}

/**
 * Returns the mutation used by node/column selectors to persist a preferred
 * document column and keep cached workspace metadata in sync.
 * Used by: analysis selectors that let users choose a document column per node because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: capture QueryClient and auth context, return a document-column mutation that trims empty values, writes the backend preference, updates caches, and shows a toast on failure.
 */
export function usePersistNodeDocumentColumn({
  workspaceId,
  getAuthHeaders,
}: {
  workspaceId: string | null | undefined;
  getAuthHeaders: () => Record<string, string>;
}) {
  const queryClient = useQueryClient();

  return useCallback(
    async (nodeId: string, column: string) => {
      if (!workspaceId) return null;
      try {
        const { data } = await setNodeDocumentColumn({
          path: { node_id: nodeId },
          body: { document_column: column.trim() || null },
          headers: getAuthHeaders(),
          throwOnError: true,
        });
        updateWorkspaceNodeInfoCache(queryClient, workspaceId, data);
        return data;
      } catch {
        toast.error('Could not save the document column for this data block.');
        return null;
      }
    },
    [getAuthHeaders, queryClient, workspaceId],
  );
}

/**
 * Returns the mutation used by tokenizer selectors to persist per-column model
 * preferences that later analyses use when choosing tokenized columns.
 * Used by: token model selectors in analysis parameter panels because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
 */
export function usePersistNodeTokenizationPreference({
  workspaceId,
  getAuthHeaders,
}: {
  workspaceId: string | null | undefined;
  getAuthHeaders: () => Record<string, string>;
}) {
  const queryClient = useQueryClient();

  return useCallback(
    async (nodeId: string, column: string, model: string, language: string | null) => {
      if (!workspaceId) return null;
      try {
        const trimmedModel = model.trim();
        const { data } = await setNodeTokenizationPreference({
          path: { node_id: nodeId },
          body: {
            source_column: column,
            model: trimmedModel || null,
            language: trimmedModel ? language : null,
          },
          headers: getAuthHeaders(),
          throwOnError: true,
        });
        updateWorkspaceNodeInfoCache(queryClient, workspaceId, data);
        return data;
      } catch {
        toast.error('Could not save the tokenizer model for this column.');
        return null;
      }
    },
    [getAuthHeaders, queryClient, workspaceId],
  );
}
