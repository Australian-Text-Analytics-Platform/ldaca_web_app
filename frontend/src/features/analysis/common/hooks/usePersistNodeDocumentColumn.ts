import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { setNodeDocumentColumn } from '@/api/generated/sdk.gen';
import type { WorkspaceGraphResponse, WorkspaceNodeInfo } from '@/api/generated/types.gen';
import { queryKeys } from '@/lib/queryKeys';

export function updateWorkspaceNodeInfoCache(
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