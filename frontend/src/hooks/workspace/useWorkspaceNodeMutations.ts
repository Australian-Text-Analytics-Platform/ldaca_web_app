import { type Dispatch, type SetStateAction } from 'react';
import { type QueryClient, useMutation } from '@tanstack/react-query';
import { workspacesApi } from '../../api/workspaces';
import {
  nodesApi,
  type FilterRequest,
  type SliceRequest,
  type ExpressionTransformRequest,
} from '../../api/nodes';
import { queryKeys } from '../../lib/queryKeys';
import { type NodeSchemaResponse } from '../../types';
import { type WorkspaceGraphResponse } from '../../types/api';
import { getNodeInfo, invalidateNodeInfo } from '../../lib/nodeInfoCache';
import { normalizeSchemaFromInfo } from '../useSchemaManagement';

interface WorkspaceNodeMutationsParams {
  authHeaders: Record<string, string>;
  currentWorkspaceId: string | null;
  selectedNodeId: string | null;
  setCurrentWorkspaceId: Dispatch<SetStateAction<string | null>>;
  setSelectedNodes: (nodeIds: string[]) => void;
  clearSelection: () => void;
  queryClient: QueryClient;
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
  setOperationError: (operationId: string, error: string) => void;
}

export const useWorkspaceNodeMutations = ({
  authHeaders,
  currentWorkspaceId,
  selectedNodeId,
  setCurrentWorkspaceId,
  setSelectedNodes,
  clearSelection,
  queryClient,
  startOperation,
  endOperation,
  setOperationError,
}: WorkspaceNodeMutationsParams) => {
  const ensureWorkspaceSelected = () => {
    if (!currentWorkspaceId) {
      throw new Error('No workspace selected');
    }
    return currentWorkspaceId;
  };

  const invalidateWorkspaceSummaries = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
  };

  const setCurrentWorkspaceMutation = useMutation<Record<string, unknown>, Error, string | null, { previousId: string | null }>({
    mutationFn: (workspaceId: string | null) => workspacesApi.current.set(workspaceId, authHeaders),
    onMutate: async (workspaceId: string | null) => {
      startOperation('setCurrentWorkspace');
      const previousId = currentWorkspaceId;
      if (!workspaceId && previousId) {
        await queryClient.cancelQueries({
          predicate: ({ queryKey }) =>
            Array.isArray(queryKey) &&
            queryKey[0] === 'workspaces' &&
            queryKey[1] === previousId &&
            queryKey.length > 1,
        });
      }
      return { previousId };
    },
    onSuccess: (_data, workspaceId, context) => {
      const previousId = context?.previousId ?? null;
      const nextId = workspaceId ?? null;
      queryClient.setQueryData(queryKeys.currentWorkspace, nextId);
      setCurrentWorkspaceId(nextId);
      clearSelection();

      if (nextId) {
        queryClient.invalidateQueries({
          predicate: ({ queryKey }) =>
            Array.isArray(queryKey) &&
            queryKey[0] === 'workspaces' &&
            queryKey[1] === nextId &&
            queryKey.length > 1,
        });
      } else if (previousId) {
        queryClient.removeQueries({
          predicate: ({ queryKey }) =>
            Array.isArray(queryKey) &&
            queryKey[0] === 'workspaces' &&
            queryKey[1] === previousId &&
            queryKey.length > 1,
        });
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      endOperation('setCurrentWorkspace');
    },
    onError: (error: Error) => {
      setOperationError('setCurrentWorkspace', error.message);
      endOperation('setCurrentWorkspace');
    },
  });

  const createWorkspaceMutation = useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      workspacesApi.create(name, description || '', authHeaders),
    onMutate: () => {
      startOperation('createWorkspace');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      endOperation('createWorkspace');
    },
    onError: (error: Error) => {
      setOperationError('createWorkspace', error.message);
      endOperation('createWorkspace');
    },
  });

  const deleteWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string) => {
      if (!workspaceId?.trim()) {
        throw new Error('workspaceId is required');
      }
      return workspacesApi.delete(workspaceId, authHeaders);
    },
    onMutate: () => {
      startOperation('deleteWorkspace');
    },
    onSuccess: (data: Record<string, unknown>, workspaceId) => {
      const deletedWorkspaceId = (data?.id as string | undefined) ?? workspaceId;
      if (currentWorkspaceId && deletedWorkspaceId === currentWorkspaceId) {
        setCurrentWorkspaceId(null);
        clearSelection();
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      endOperation('deleteWorkspace');
    },
    onError: (error: Error) => {
      setOperationError('deleteWorkspace', error.message);
      endOperation('deleteWorkspace');
    },
  });

  const saveWorkspaceMutation = useMutation({
    mutationFn: () => {
      ensureWorkspaceSelected();
      return workspacesApi.save(authHeaders);
    },
    onMutate: () => startOperation('saveWorkspace'),
    onSuccess: () => {
      endOperation('saveWorkspace');
    },
    onError: (error: Error) => {
      setOperationError('saveWorkspace', error.message);
      endOperation('saveWorkspace');
    },
  });

  const updateWorkspaceNameMutation = useMutation({
    mutationFn: (newName: string) => {
      ensureWorkspaceSelected();
      return workspacesApi.updateName(newName, authHeaders);
    },
    onMutate: () => startOperation('updateWorkspaceName'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      endOperation('updateWorkspaceName');
    },
    onError: (error: Error) => {
      setOperationError('updateWorkspaceName', error.message);
      endOperation('updateWorkspaceName');
    },
  });

  const renameNodeMutation = useMutation({
    mutationFn: ({ nodeId, newName }: { nodeId: string; newName: string }) =>
      nodesApi.rename(nodeId, newName, authHeaders),
    onMutate: () => {
      startOperation('renameNode');
    },
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('renameNode');
    },
    onError: (error: Error) => {
      setOperationError('renameNode', error.message);
      endOperation('renameNode');
    },
  });

  const copyNodeMutation = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      nodesApi.clone(nodeId, authHeaders),
    onMutate: () => {
      startOperation('copyNode');
    },
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      invalidateWorkspaceSummaries();
      endOperation('copyNode');
    },
    onError: (error: Error) => {
      setOperationError('copyNode', error.message);
      endOperation('copyNode');
    },
  });

  const deleteNodeMutation = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      nodesApi.delete(nodeId, authHeaders),
    onMutate: () => {
      startOperation('deleteNode');
    },
    onSuccess: (_, { nodeId }) => {
      if (selectedNodeId === nodeId) {
        clearSelection();
      }
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, nodeId) });
      }
      invalidateWorkspaceSummaries();
      endOperation('deleteNode');
    },
    onError: (error: Error) => {
      setOperationError('deleteNode', error.message);
      endOperation('deleteNode');
    },
  });

  const undoNodeMutation = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) => nodesApi.undo(nodeId, authHeaders),
    onMutate: () => {
      startOperation('undoNode');
    },
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId) {
        invalidateNodeInfo(currentWorkspaceId, variables.nodeId);
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
      }
      endOperation('undoNode');
    },
    onError: (error: Error) => {
      setOperationError('undoNode', error.message);
      endOperation('undoNode');
    },
  });

  const redoNodeMutation = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) => nodesApi.redo(nodeId, authHeaders),
    onMutate: () => {
      startOperation('redoNode');
    },
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId) {
        invalidateNodeInfo(currentWorkspaceId, variables.nodeId);
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
      }
      endOperation('redoNode');
    },
    onError: (error: Error) => {
      setOperationError('redoNode', error.message);
      endOperation('redoNode');
    },
  });

  const createNodeMutation = useMutation({
    mutationFn: ({
      filename,
      sheetName,
    }: {
      filename: string;
      sheetName?: string;
    }) =>
      nodesApi.createFromFile(filename, undefined, authHeaders, sheetName),
    onMutate: () => {
      startOperation('createNode');
    },
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      invalidateWorkspaceSummaries();
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
    }) => {
      const request = {
        left_node_id: leftNodeId,
        right_node_id: rightNodeId,
        left_on: leftColumns[0] || '',
        right_on: rightColumns[0] || '',
        how: joinType as 'inner' | 'left' | 'right' | 'full' | 'semi' | 'anti' | 'cross',
        new_node_name: newNodeName,
      };
      return nodesApi.join(request, authHeaders);
    },
    onMutate: async () => {
      startOperation('joinNodes');
      let previousNodeIds: string[] = [];
      try {
        if (currentWorkspaceId) {
          const previousGraph = queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId));
          previousNodeIds = (previousGraph?.nodes || []).map((node) => node.id);
        }
      } catch {
        // ignore snapshot errors
      }
      clearSelection();
      return { previousNodeIds };
    },
    onSuccess: async (createdNode: Record<string, unknown>, _vars, context) => {
      try {
        let newId = (createdNode?.node_id as string | undefined) || (createdNode?.id as string | undefined);
        if (!newId && currentWorkspaceId) {
          await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
          const freshGraph = queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId));
          if (freshGraph?.nodes) {
            const prevIds: string[] = context?.previousNodeIds || [];
            const diff = freshGraph.nodes.map((node) => node.id).filter((id: string) => !prevIds.includes(id));
            if (diff.length === 1) newId = diff[0];
          }
        }
        if (newId) {
          setSelectedNodes([newId]);
        } else {
          clearSelection();
        }
      } catch {
        clearSelection();
      }
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('joinNodes');
    },
    onError: (error: Error) => {
      setOperationError('joinNodes', error.message);
      endOperation('joinNodes');
    },
  });

  const concatNodesMutation = useMutation({
    mutationFn: ({ nodeIds, newNodeName }: { nodeIds: string[]; newNodeName?: string }) =>
      nodesApi.concat({ node_ids: nodeIds, new_node_name: newNodeName }, authHeaders),
    onMutate: async () => {
      startOperation('concatNodes');
      let previousNodeIds: string[] = [];
      try {
        if (currentWorkspaceId) {
          const previousGraph = queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId));
          previousNodeIds = (previousGraph?.nodes || []).map((node) => node.id);
        }
      } catch {
        // ignore snapshot errors
      }
      clearSelection();
      return { previousNodeIds };
    },
    onSuccess: async (createdNode: Record<string, unknown>, _vars, context) => {
      try {
        let newId = (createdNode?.node_id as string | undefined) || (createdNode?.id as string | undefined);
        if (!newId && currentWorkspaceId) {
          await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
          const freshGraph = queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId));
          if (freshGraph?.nodes) {
            const prevIds: string[] = context?.previousNodeIds || [];
            const diff = freshGraph.nodes.map((node) => node.id).filter((id: string) => !prevIds.includes(id));
            if (diff.length === 1) newId = diff[0];
          }
        }
        if (newId) {
          setSelectedNodes([newId]);
        } else {
          clearSelection();
        }
      } catch {
        clearSelection();
      }
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('concatNodes');
    },
    onError: (error: Error) => {
      setOperationError('concatNodes', error.message);
      endOperation('concatNodes');
    },
  });

  const filterNodeMutation = useMutation({
    mutationFn: ({ nodeId, request }: { nodeId: string; request: FilterRequest }) =>
      nodesApi.filter(nodeId, request, authHeaders),
    onMutate: () => {
      startOperation('filterNode');
    },
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('filterNode');
    },
    onError: (error: Error) => {
      setOperationError('filterNode', error.message);
      endOperation('filterNode');
    },
  });

  const computeColumnMutation = useMutation({
    mutationFn: ({ nodeId, request }: { nodeId: string; request: ExpressionTransformRequest }) =>
      nodesApi.computeColumn(nodeId, request, authHeaders),
    onMutate: () => {
      startOperation('computeColumn');
    },
    onSuccess: (_response, variables) => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        if (variables?.nodeId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
        }
      }
      endOperation('computeColumn');
    },
    onError: (error: Error) => {
      setOperationError('computeColumn', error.message);
      endOperation('computeColumn');
    },
  });

  const sliceNodeMutation = useMutation({
    mutationFn: ({ nodeId, request }: { nodeId: string; request: SliceRequest }) =>
      nodesApi.slice(nodeId, request, authHeaders),
    onMutate: () => {
      startOperation('sliceNode');
    },
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('sliceNode');
    },
    onError: (error: Error) => {
      setOperationError('sliceNode', error.message);
      endOperation('sliceNode');
    },
  });

  const castNodeMutation = useMutation({
    mutationFn: ({ nodeId, column, targetType, format }: { nodeId: string; column: string; targetType: string; format?: string }) =>
      nodesApi.cast(nodeId, { column, target_type: targetType, format }, authHeaders),
    onMutate: () => {
      startOperation('castNode');
    },
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId && variables?.nodeId) {
        invalidateNodeInfo(currentWorkspaceId, variables.nodeId);
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
      }
      endOperation('castNode');
    },
    onError: (error: Error) => {
      setOperationError('castNode', error.message);
      endOperation('castNode');
    },
  });

  const renameColumnMutation = useMutation({
    mutationFn: ({ nodeId, column, newName }: { nodeId: string; column: string; newName: string }) =>
      nodesApi.renameColumn(nodeId, column, newName, authHeaders),
    onMutate: () => {
      startOperation('renameColumn');
    },
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        if (variables?.nodeId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
        }
      }
      endOperation('renameColumn');
    },
    onError: (error: Error) => {
      setOperationError('renameColumn', error.message);
      endOperation('renameColumn');
    },
  });

  const deleteColumnMutation = useMutation({
    mutationFn: ({ nodeId, column }: { nodeId: string; column: string }) =>
      nodesApi.deleteColumn(nodeId, column, authHeaders),
    onMutate: () => {
      startOperation('deleteColumn');
    },
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        if (variables?.nodeId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
        }
      }
      endOperation('deleteColumn');
    },
    onError: (error: Error) => {
      setOperationError('deleteColumn', error.message);
      endOperation('deleteColumn');
    },
  });

  const actions = {
    setCurrentWorkspace: (workspaceId: string | null) => setCurrentWorkspaceMutation.mutateAsync(workspaceId),
    createWorkspace: (name: string, description?: string) => createWorkspaceMutation.mutateAsync({ name, description }),
    deleteWorkspace: (workspaceId: string) => deleteWorkspaceMutation.mutateAsync(workspaceId),
    saveWorkspace: () => saveWorkspaceMutation.mutateAsync(),
    renameWorkspace: (newName: string) => updateWorkspaceNameMutation.mutateAsync(newName),
    renameNode: (nodeId: string, newName: string) =>
      renameNodeMutation.mutateAsync({ nodeId, newName }),
    undoNode: (nodeId: string) =>
      undoNodeMutation.mutateAsync({ nodeId }),
    redoNode: (nodeId: string) =>
      redoNodeMutation.mutateAsync({ nodeId }),
    copyNode: (nodeId: string) =>
      copyNodeMutation.mutateAsync({ nodeId }),
    deleteNode: (nodeId: string) =>
      deleteNodeMutation.mutateAsync({ nodeId }),
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
      newNodeName?: string
    ) =>
      joinNodesMutation.mutateAsync({
        leftNodeId,
        rightNodeId,
        joinType,
        leftColumns,
        rightColumns,
        newNodeName,
      }),
    concatNodes: (nodeIds: string[], newNodeName?: string) =>
      concatNodesMutation.mutateAsync({ nodeIds, newNodeName }),
    concatPreview: (nodeIds: string[], page = 1, pageSize = 10) =>
      nodesApi.concatPreview({ node_ids: nodeIds }, page, pageSize, authHeaders),
    filterNode: (nodeId: string, request: FilterRequest) =>
      filterNodeMutation.mutateAsync({ nodeId, request }),
    filterPreview: (nodeId: string, request: FilterRequest, page = 1, pageSize = 10) =>
      nodesApi.filterPreview(nodeId, request, page, pageSize, authHeaders),
    sliceNode: (nodeId: string, request: SliceRequest) =>
      sliceNodeMutation.mutateAsync({ nodeId, request }),
    slicePreview: (nodeId: string, request: SliceRequest, page = 1, pageSize = 10) =>
      nodesApi.slicePreview(nodeId, request, page, pageSize, authHeaders),
    computeColumn: (nodeId: string, request: ExpressionTransformRequest) =>
      computeColumnMutation.mutateAsync({ nodeId, request }),
    computeColumnPreview: (nodeId: string, request: ExpressionTransformRequest) =>
      nodesApi.computeColumnPreview(nodeId, request, authHeaders),
    castColumn: (nodeId: string, column: string, targetType: string, format?: string) =>
      castNodeMutation.mutateAsync({ nodeId, column, targetType, format }),
    renameColumn: (nodeId: string, column: string, newName: string) =>
      renameColumnMutation.mutateAsync({ nodeId, column, newName }),
    deleteColumn: (nodeId: string, column: string) => deleteColumnMutation.mutateAsync({ nodeId, column }),
    refreshNodeSchema: async (nodeId: string): Promise<NodeSchemaResponse | null> => {
      if (!currentWorkspaceId) return null;
      const graphData = queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId));
      const existingNodes = graphData?.nodes || [];
      const nodeExists = existingNodes.some((node) => node.id === nodeId);
      if (!nodeExists) {
        if (typeof window !== 'undefined' && localStorage.getItem('debugGraph') === '1') {
          console.debug(`Node ${nodeId} no longer exists, skipping schema refresh`);
        }
        return null;
      }
      try {
        const info = await getNodeInfo({ workspaceId: currentWorkspaceId, nodeId, headers: authHeaders, force: true });
        const schemaMap = normalizeSchemaFromInfo(info);
        const schema = schemaMap;
        return {
          node_id: nodeId,
          schema,
          columns: Object.keys(schema),
          column_types: schema,
          is_text_data: false,
        };
      } catch (error) {
        console.error('Failed to refresh node schema:', error);
        return null;
      }
    },
  } as const;

  return { actions } as const;
};
