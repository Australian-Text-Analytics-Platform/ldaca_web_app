import { useMemo } from 'react';
import { type QueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  addNodeToWorkspace,
  cloneNode,
  concatNodes,
  concatNodesPreview,
  deleteNode,
  joinNodes,
  redoNodeOperation,
  reorderWorkspaceNodes,
  setNodeColor as setNodeColorRequest,
  undoNodeOperation,
  updateNodeName,
} from '@/api';
import { type WorkspaceGraphResponse, type WorkspaceNodeInfo as NodeInfoResponse } from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import { resolveCreatedNodeId } from './workspaceCreatedNodeSelection';
import {
  invalidateNodeWorkspaceQueries,
  invalidateWorkspaceGraphQuery,
  invalidateWorkspaceSummaries,
  readWorkspaceGraphNodeIds,
} from './workspaceMutationCache';

interface WorkspaceGraphMutationsParams {
  authHeaders: Record<string, string>;
  currentWorkspaceId: string | null;
  selectedNodeId: string | null;
  setSelectedNodes: (nodeIds: string[]) => void;
  clearSelection: () => void;
  queryClient: QueryClient;
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
  setOperationError: (operationId: string, error: string) => void;
}

/**
 * Owns node and graph mutations exposed through WorkspaceProvider actions.
 * Used by: useWorkspaceNodeMutations because graph operations share selection
 * updates, workspace-graph invalidation, summary refreshes, and created-node
 * inference that should not be mixed with workspace CRUD or table transforms.
 * Flow: build generated-SDK mutations, update operation state, refresh graph
 * caches, select newly-created join/concat nodes, and return stable actions
 * for graph, data loader, and node-history consumers.
 */
export const useWorkspaceGraphMutations = ({
  authHeaders,
  currentWorkspaceId,
  selectedNodeId,
  setSelectedNodes,
  clearSelection,
  queryClient,
  startOperation,
  endOperation,
  setOperationError,
}: WorkspaceGraphMutationsParams) => {
  const renameNodeMutation = useMutation({
    mutationFn: ({ nodeId, newName }: { nodeId: string; newName: string }) =>
      updateNodeName({
        headers: authHeaders,
        path: { node_id: nodeId },
        query: { new_name: newName },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('renameNode');
    },
    onSuccess: () => {
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      endOperation('renameNode');
    },
    onError: (error: Error) => {
      setOperationError('renameNode', error.message);
      endOperation('renameNode');
    },
  });

  const copyNodeMutation = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      cloneNode({
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('copyNode');
    },
    onSuccess: () => {
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      invalidateWorkspaceSummaries(queryClient);
      endOperation('copyNode');
    },
    onError: (error: Error) => {
      setOperationError('copyNode', error.message);
      endOperation('copyNode');
    },
  });

  const setNodeColorMutation = useMutation({
    mutationFn: ({ nodeId, color }: { nodeId: string; color: string }) =>
      setNodeColorRequest({
        body: { color },
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('setNodeColor');
    },
    onSuccess: (_data, { nodeId }) => {
      invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, nodeId, {
        includeNodeInfo: true,
      });
      endOperation('setNodeColor');
    },
    onError: (error: Error) => {
      setOperationError('setNodeColor', error.message);
      endOperation('setNodeColor');
    },
  });

  const deleteNodeMutation = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      deleteNode({
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('deleteNode');
    },
    onSuccess: (_, { nodeId }) => {
      if (selectedNodeId === nodeId) {
        clearSelection();
      }
      invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, nodeId, {
        includeData: true,
      });
      invalidateWorkspaceSummaries(queryClient);
      endOperation('deleteNode');
    },
    onError: (error: Error) => {
      setOperationError('deleteNode', error.message);
      endOperation('deleteNode');
    },
  });

  const undoNodeMutation = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      undoNodeOperation({
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('undoNode');
    },
    onSuccess: (_data, variables) => {
      invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, variables.nodeId, {
        includeNodeInfo: true,
        includeData: true,
        includeSchema: true,
      });
      endOperation('undoNode');
    },
    onError: (error: Error) => {
      setOperationError('undoNode', error.message);
      endOperation('undoNode');
    },
  });

  const redoNodeMutation = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      redoNodeOperation({
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('redoNode');
    },
    onSuccess: (_data, variables) => {
      invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, variables.nodeId, {
        includeNodeInfo: true,
        includeData: true,
        includeSchema: true,
      });
      endOperation('redoNode');
    },
    onError: (error: Error) => {
      setOperationError('redoNode', error.message);
      endOperation('redoNode');
    },
  });

  const createNodeMutation = useMutation({
    mutationFn: ({ filename, sheetName }: { filename: string; sheetName?: string }) =>
      addNodeToWorkspace({
        headers: authHeaders,
        query: {
          filename,
          mode: 'LazyFrame',
          ...(sheetName ? { sheet_name: sheetName } : {}),
        },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('createNode');
    },
    onSuccess: (response: NodeInfoResponse) => {
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      invalidateWorkspaceSummaries(queryClient);
      const changes = response.dtype_normalization;
      if (changes && changes.length > 0) {
        const lines = changes.map(
          (c) => `${c.column}: ${c.from_dtype} → ${c.to_dtype} (${c.reason})`,
        );
        const heading =
          changes.length === 1
            ? '1 column was normalized to the standard dtype'
            : `${String(changes.length)} columns were normalized to standard dtypes`;
        void toast.info(heading, {
          description: lines.join('\n'),
          duration: 10000,
        });
      }
      endOperation('createNode');
    },
    onError: (error: Error) => {
      setOperationError('createNode', error.message);
      endOperation('createNode');
    },
  });

  const joinNodesMutation = useMutation({
    mutationFn: ({
      leftNodeId,
      rightNodeId,
      joinType,
      leftColumns,
      rightColumns,
      newNodeName,
    }: {
      leftNodeId: string;
      rightNodeId: string;
      joinType: string;
      leftColumns: string[];
      rightColumns: string[];
      newNodeName?: string;
    }) =>
      joinNodes({
        headers: authHeaders,
        query: {
          left_node_id: leftNodeId,
          right_node_id: rightNodeId,
          left_on: leftColumns[0] ?? '',
          right_on: rightColumns[0] ?? '',
          how: joinType,
          new_node_name: newNodeName,
        },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('joinNodes');
      const previousNodeIds = readWorkspaceGraphNodeIds(queryClient, currentWorkspaceId);
      clearSelection();
      return { previousNodeIds };
    },
    onSuccess: async (createdNode: Record<string, unknown>, _vars, context) => {
      const newId = await resolveCreatedNodeId({
        createdNode,
        queryClient,
        workspaceId: currentWorkspaceId,
        previousNodeIds: context.previousNodeIds,
      });
      if (newId) {
        setSelectedNodes([newId]);
      } else {
        clearSelection();
      }
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      endOperation('joinNodes');
    },
    onError: (error: Error) => {
      setOperationError('joinNodes', error.message);
      endOperation('joinNodes');
    },
  });

  const concatNodesMutation = useMutation({
    mutationFn: ({
      nodeIds,
      newNodeName,
      deduplicate,
    }: {
      nodeIds: string[];
      newNodeName?: string;
      deduplicate?: boolean;
    }) =>
      concatNodes({
        body: { node_ids: nodeIds, new_node_name: newNodeName, deduplicate },
        headers: authHeaders,
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('concatNodes');
      const previousNodeIds = readWorkspaceGraphNodeIds(queryClient, currentWorkspaceId);
      clearSelection();
      return { previousNodeIds };
    },
    onSuccess: async (createdNode: Record<string, unknown>, _vars, context) => {
      const newId = await resolveCreatedNodeId({
        createdNode,
        queryClient,
        workspaceId: currentWorkspaceId,
        previousNodeIds: context.previousNodeIds,
      });
      if (newId) {
        setSelectedNodes([newId]);
      } else {
        clearSelection();
      }
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      endOperation('concatNodes');
    },
    onError: (error: Error) => {
      setOperationError('concatNodes', error.message);
      endOperation('concatNodes');
    },
  });

  const reorderNodesMutation = useMutation<
    WorkspaceGraphResponse | undefined,
    Error,
    { orderedIds: string[] },
    { previousGraph: WorkspaceGraphResponse | undefined }
  >({
    mutationFn: ({ orderedIds }: { orderedIds: string[] }) =>
      reorderWorkspaceNodes({
        body: { ordered_ids: orderedIds },
        headers: authHeaders,
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: async ({ orderedIds }) => {
      startOperation('reorderNodes');
      if (!currentWorkspaceId) {
        return { previousGraph: undefined };
      }
      const graphKey = queryKeys.workspaceGraph(currentWorkspaceId);
      await queryClient.cancelQueries({ queryKey: graphKey });
      const previousGraph = queryClient.getQueryData<WorkspaceGraphResponse>(graphKey);
      if (previousGraph?.nodes) {
        const rankById = new Map(orderedIds.map((id, index) => [id, index]));
        const reordered = [...previousGraph.nodes].sort((a, b) => {
          const aRank = rankById.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const bRank = rankById.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          return aRank - bRank;
        });
        queryClient.setQueryData<WorkspaceGraphResponse>(graphKey, {
          ...previousGraph,
          nodes: reordered,
        });
      }
      return { previousGraph };
    },
    onSuccess: () => {
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      endOperation('reorderNodes');
    },
    onError: (error: Error, _vars, context) => {
      if (currentWorkspaceId && context?.previousGraph) {
        queryClient.setQueryData(
          queryKeys.workspaceGraph(currentWorkspaceId),
          context.previousGraph,
        );
      }
      setOperationError('reorderNodes', error.message);
      endOperation('reorderNodes');
    },
  });

  const actions = useMemo(
    () => ({
      renameNode: (nodeId: string, newName: string) =>
        renameNodeMutation.mutateAsync({ nodeId, newName }),
      undoNode: (nodeId: string) => undoNodeMutation.mutateAsync({ nodeId }),
      redoNode: (nodeId: string) => redoNodeMutation.mutateAsync({ nodeId }),
      copyNode: (nodeId: string) => copyNodeMutation.mutateAsync({ nodeId }),
      setNodeColor: (nodeId: string, color: string) =>
        setNodeColorMutation.mutateAsync({ nodeId, color }),
      deleteNode: (nodeId: string) => deleteNodeMutation.mutateAsync({ nodeId }),
      reorderNodes: (orderedIds: string[]) => reorderNodesMutation.mutateAsync({ orderedIds }),
      createNodeFromFile: (filename: string, sheetName?: string) =>
        createNodeMutation.mutateAsync({
          filename,
          sheetName,
        }),
      joinNodes: (
        leftNodeId: string,
        rightNodeId: string,
        joinType: string,
        leftColumns: string[],
        rightColumns: string[],
        newNodeName?: string,
      ) =>
        joinNodesMutation.mutateAsync({
          leftNodeId,
          rightNodeId,
          joinType,
          leftColumns,
          rightColumns,
          newNodeName,
        }),
      concatNodes: (nodeIds: string[], newNodeName?: string, deduplicate?: boolean) =>
        concatNodesMutation.mutateAsync({ nodeIds, newNodeName, deduplicate }),
      concatPreview: (nodeIds: string[], page = 1, pageSize = 10, deduplicate?: boolean) =>
        concatNodesPreview({
          body: { node_ids: nodeIds, deduplicate },
          headers: authHeaders,
          query: { page, page_size: pageSize },
          throwOnError: true,
        }).then(({ data }) => data),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation refs intentionally omitted; mutateAsync identities are stable
    [authHeaders, currentWorkspaceId, queryClient],
  );

  return { actions } as const;
};
