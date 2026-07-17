import { useMemo } from 'react';
import { type QueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  createNode,
  deleteNode,
  reorderWorkspaceNodesById,
  previewNodeCreationTable,
  updateNode,
} from '@/api';
import type {
  JoinNodeCreateRequest,
  WorkspaceGraphResponse,
  WorkspaceNodeInfo as NodeInfoResponse,
} from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import {
  invalidateNodeWorkspaceQueries,
  invalidateWorkspaceGraphQuery,
  invalidateWorkspaceSummaries,
} from './workspaceMutationCache';
import { createWorkspaceOperationLifecycle } from './workspaceMutationLifecycle';

interface WorkspaceGraphMutationsParams {
  currentWorkspaceId: string | null;
  removeNode: (nodeId: string) => void;
  replaceSelectedNodes: (nodeIds: string[], activeNodeId?: string | null) => void;
  clearSelection: () => void;
  queryClient: QueryClient;
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
}

/** Complete identity and transport context for a cancellable stack preview. */
interface WorkspaceConcatPreviewRequest {
  workspaceId: string;
  nodeIds: string[];
  page: number;
  pageSize: number;
  deduplicate: boolean;
  signal: AbortSignal;
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
  currentWorkspaceId,
  removeNode,
  replaceSelectedNodes,
  clearSelection,
  queryClient,
  startOperation,
  endOperation,
}: WorkspaceGraphMutationsParams) => {
  const ensureWorkspaceSelected = () => {
    if (!currentWorkspaceId) {
      throw new Error('No workspace selected');
    }
    return currentWorkspaceId;
  };
  const operationLifecycle = createWorkspaceOperationLifecycle({
    startOperation,
    endOperation,
  });

  const renameNodeMutation = useMutation({
    mutationFn: ({ nodeId, newName }: { nodeId: string; newName: string }) =>
      updateNode({
        body: { name: newName },
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => {
        return data;
      }),
    onMutate: operationLifecycle.onMutate('renameNode'),
    onSuccess: operationLifecycle.onSuccess('renameNode', () => {
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
    }),
    onError: operationLifecycle.onError('renameNode'),
  });

  const copyNodeMutation = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      createNode({
        body: { kind: 'clone', source_node_id: nodeId },
        path: { workspace_id: ensureWorkspaceSelected() },
        throwOnError: true,
      }).then(({ data }) => {
        return data;
      }),
    onMutate: operationLifecycle.onMutate('copyNode'),
    onSuccess: operationLifecycle.onSuccess('copyNode', () => {
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      invalidateWorkspaceSummaries(queryClient);
    }),
    onError: operationLifecycle.onError('copyNode'),
  });

  const setNodeColorMutation = useMutation({
    mutationFn: ({ nodeId, color }: { nodeId: string; color: string }) =>
      updateNode({
        body: { color },
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => {
        return data;
      }),
    onMutate: operationLifecycle.onMutate('setNodeColor'),
    onSuccess: operationLifecycle.onSuccess('setNodeColor', (_data, { nodeId }) => {
      invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, nodeId, {
        includeNodeInfo: true,
      });
    }),
    onError: operationLifecycle.onError('setNodeColor'),
  });

  const deleteNodeMutation = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      deleteNode({
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => {
        if (data !== undefined) throw new Error('Node deletion returned a body');
        return undefined;
      }),
    onMutate: operationLifecycle.onMutate('deleteNode'),
    onSuccess: operationLifecycle.onSuccess('deleteNode', (_, { nodeId }) => {
      removeNode(nodeId);
      invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, nodeId, {
        includeData: true,
      });
      invalidateWorkspaceSummaries(queryClient);
    }),
    onError: operationLifecycle.onError('deleteNode'),
  });

  const createNodeMutation = useMutation({
    mutationFn: ({ filename, sheetName }: { filename: string; sheetName?: string }) =>
      createNode({
        path: { workspace_id: ensureWorkspaceSelected() },
        body: { kind: 'file', file_path: filename, sheet_name: sheetName },
        throwOnError: true,
      }).then(({ data }) => {
        return data;
      }),
    onMutate: operationLifecycle.onMutate('createNode'),
    onSuccess: operationLifecycle.onSuccess('createNode', (response: NodeInfoResponse) => {
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
    }),
    onError: operationLifecycle.onError('createNode'),
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
      joinType: JoinNodeCreateRequest['how'];
      leftColumns: string[];
      rightColumns: string[];
      newNodeName?: string;
    }) =>
      createNode({
        path: { workspace_id: ensureWorkspaceSelected() },
        body: {
          kind: 'join',
          left_node_id: leftNodeId,
          right_node_id: rightNodeId,
          left_on: leftColumns[0] ?? '',
          right_on: rightColumns[0] ?? '',
          how: joinType,
          name: newNodeName,
        },
        throwOnError: true,
      }).then(({ data }) => {
        return data;
      }),
    onMutate: operationLifecycle.onMutate('joinNodes', () => {
      clearSelection();
    }),
    onSuccess: operationLifecycle.onSuccess('joinNodes', (createdNode: NodeInfoResponse) => {
      replaceSelectedNodes([createdNode.id], createdNode.id);
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
    }),
    onError: operationLifecycle.onError('joinNodes'),
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
      createNode({
        body: { kind: 'concat', source_node_ids: nodeIds, name: newNodeName, deduplicate },
        path: { workspace_id: ensureWorkspaceSelected() },
        throwOnError: true,
      }).then(({ data }) => {
        return data;
      }),
    onMutate: operationLifecycle.onMutate('concatNodes', () => {
      clearSelection();
    }),
    onSuccess: operationLifecycle.onSuccess('concatNodes', (createdNode: NodeInfoResponse) => {
      replaceSelectedNodes([createdNode.id], createdNode.id);
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
    }),
    onError: operationLifecycle.onError('concatNodes'),
  });

  const reorderNodesMutation = useMutation<
    undefined,
    Error,
    { orderedIds: string[] },
    { previousGraph: WorkspaceGraphResponse | undefined }
  >({
    mutationFn: ({ orderedIds }: { orderedIds: string[] }) => {
      if (!currentWorkspaceId) {
        throw new Error('No workspace selected');
      }
      return reorderWorkspaceNodesById({
        body: { ordered_ids: orderedIds },
        path: { workspace_id: currentWorkspaceId },
        throwOnError: true,
      }).then(() => undefined);
    },
    onMutate: operationLifecycle.onMutate('reorderNodes', async ({ orderedIds }) => {
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
    }),
    onSuccess: operationLifecycle.onSuccess('reorderNodes', () => {
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
    }),
    onError: operationLifecycle.onError('reorderNodes', (_error, _vars, context) => {
      if (currentWorkspaceId && context?.previousGraph) {
        queryClient.setQueryData(
          queryKeys.workspaceGraph(currentWorkspaceId),
          context.previousGraph,
        );
      }
    }),
  });

  const actions = useMemo(
    () => ({
      renameNode: (nodeId: string, newName: string) =>
        renameNodeMutation.mutateAsync({ nodeId, newName }),
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
        joinType: JoinNodeCreateRequest['how'],
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
      concatPreview: ({
        workspaceId,
        nodeIds,
        page,
        pageSize,
        deduplicate,
        signal,
      }: WorkspaceConcatPreviewRequest) =>
        previewNodeCreationTable({
          body: { kind: 'concat', source_node_ids: nodeIds, deduplicate },
          path: { workspace_id: workspaceId },
          query: { page, page_size: pageSize },
          signal,
        }).then((data) => {
          return {
            data: data.rows,
            columns: data.columns,
            pagination: {
              page,
              page_size: pageSize,
              has_next: data.hasNext,
            },
          };
        }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation refs intentionally omitted; mutateAsync identities are stable
    [currentWorkspaceId, queryClient],
  );

  return { actions } as const;
};
