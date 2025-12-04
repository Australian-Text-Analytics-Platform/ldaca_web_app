import { Dispatch, SetStateAction, useCallback, useMemo } from 'react';
import { QueryClient, useMutation } from '@tanstack/react-query';
import { workspacesApi } from '../../api/workspaces';
import {
  nodesApi,
  FilterRequest,
  SliceRequest,
  ExpressionTransformRequest,
} from '../../api/nodes';
import { queryKeys } from '../../lib/queryKeys';
import { NodeSchemaResponse } from '../../types';
import { getNodeInfo } from '../../lib/nodeInfoCache';
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
  const ensureWorkspaceSelected = useCallback(() => {
    if (!currentWorkspaceId) {
      throw new Error('No workspace selected');
    }
    return currentWorkspaceId;
  }, [currentWorkspaceId]);

  const setCurrentWorkspaceMutation = useMutation<any, unknown, string | null, { previousId: string | null }>({
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
    onError: (error: any) => {
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
    onError: (error: any) => {
      setOperationError('createWorkspace', error.message);
      endOperation('createWorkspace');
    },
  });

  const deleteWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string) => workspacesApi.delete(workspaceId, authHeaders),
    onMutate: () => {
      startOperation('deleteWorkspace');
    },
    onSuccess: (_data, workspaceId) => {
      if (currentWorkspaceId && workspaceId === currentWorkspaceId) {
        setCurrentWorkspaceId(null);
        clearSelection();
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      endOperation('deleteWorkspace');
    },
    onError: (error: any) => {
      setOperationError('deleteWorkspace', error.message);
      endOperation('deleteWorkspace');
    },
  });

  const saveWorkspaceMutation = useMutation({
    mutationFn: () => workspacesApi.save(ensureWorkspaceSelected(), authHeaders),
    onMutate: () => startOperation('saveWorkspace'),
    onSuccess: () => {
      endOperation('saveWorkspace');
    },
    onError: (error: any) => {
      setOperationError('saveWorkspace', error.message);
      endOperation('saveWorkspace');
    },
  });

  const saveWorkspaceAsMutation = useMutation({
    mutationFn: (filename: string) => workspacesApi.saveAs(ensureWorkspaceSelected(), filename, authHeaders),
    onMutate: () => startOperation('saveWorkspaceAs'),
    onSuccess: (data: any) => {
      const newWorkspace = data?.new_workspace;
      if (newWorkspace) {
        queryClient.setQueryData(queryKeys.workspaces, (old: any) => {
          if (!old) return [newWorkspace];
          const exists = old.some((workspace: any) => workspace.workspace_id === newWorkspace.workspace_id);
          return exists ? old : [...old, newWorkspace];
        });
      } else {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      }
      endOperation('saveWorkspaceAs');
    },
    onError: (error: any) => {
      setOperationError('saveWorkspaceAs', error.message);
      endOperation('saveWorkspaceAs');
    },
  });

  const updateWorkspaceNameMutation = useMutation({
    mutationFn: (newName: string) => workspacesApi.updateName(ensureWorkspaceSelected(), newName, authHeaders),
    onMutate: () => startOperation('updateWorkspaceName'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      endOperation('updateWorkspaceName');
    },
    onError: (error: any) => {
      setOperationError('updateWorkspaceName', error.message);
      endOperation('updateWorkspaceName');
    },
  });

  const renameNodeMutation = useMutation({
    mutationFn: ({ workspaceId, nodeId, newName }: { workspaceId: string; nodeId: string; newName: string }) =>
      nodesApi.rename(workspaceId, nodeId, newName, authHeaders),
    onMutate: () => {
      startOperation('renameNode');
    },
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('renameNode');
    },
    onError: (error: any) => {
      setOperationError('renameNode', error.message);
      endOperation('renameNode');
    },
  });

  const deleteNodeMutation = useMutation({
    mutationFn: ({ workspaceId, nodeId }: { workspaceId: string; nodeId: string }) =>
      nodesApi.delete(workspaceId, nodeId, authHeaders),
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
      endOperation('deleteNode');
    },
    onError: (error: any) => {
      setOperationError('deleteNode', error.message);
      endOperation('deleteNode');
    },
  });

  const createNodeMutation = useMutation({
    mutationFn: ({
      workspaceId,
      filename,
      mode,
      documentColumn,
    }: {
      workspaceId: string;
      filename: string;
      mode?: 'DocLazyFrame' | 'LazyFrame' | 'DocDataFrame' | 'DataFrame';
      documentColumn?: string | null;
    }) =>
      nodesApi.createFromFile(
        workspaceId,
        filename,
        undefined,
        authHeaders,
        { mode, document_column: documentColumn ?? undefined }
      ),
    onMutate: () => {
      startOperation('createNode');
    },
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('createNode');
    },
    onError: (error: any) => {
      setOperationError('createNode', error.message);
      endOperation('createNode');
    },
  });

  const joinNodesMutation = useMutation({
    mutationFn: ({
      workspaceId,
      leftNodeId,
      rightNodeId,
      joinType,
      leftColumns,
      rightColumns,
      newNodeName,
    }: {
      workspaceId: string;
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
      return nodesApi.join(workspaceId, request as any, authHeaders);
    },
    onMutate: async () => {
      startOperation('joinNodes');
      let previousNodeIds: string[] = [];
      try {
        if (currentWorkspaceId) {
          const previousGraph: any = queryClient.getQueryData(queryKeys.workspaceGraph(currentWorkspaceId));
          previousNodeIds = (previousGraph?.nodes || []).map((node: any) => node.id);
        }
      } catch {
        // ignore snapshot errors
      }
      clearSelection();
      return { previousNodeIds };
    },
    onSuccess: async (createdNode: any, _vars, context: any) => {
      try {
        let newId = createdNode?.node_id || createdNode?.id;
        if (!newId && currentWorkspaceId) {
          await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
          const freshGraph: any = queryClient.getQueryData(queryKeys.workspaceGraph(currentWorkspaceId));
          if (freshGraph?.nodes) {
            const prevIds: string[] = context?.previousNodeIds || [];
            const diff = freshGraph.nodes.map((node: any) => node.id).filter((id: string) => !prevIds.includes(id));
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
    onError: (error: any) => {
      setOperationError('joinNodes', error.message);
      endOperation('joinNodes');
    },
  });

  const concatNodesMutation = useMutation({
    mutationFn: ({ workspaceId, nodeIds, newNodeName }: { workspaceId: string; nodeIds: string[]; newNodeName?: string }) =>
      nodesApi.concat(workspaceId, { node_ids: nodeIds, new_node_name: newNodeName }, authHeaders),
    onMutate: async () => {
      startOperation('concatNodes');
      let previousNodeIds: string[] = [];
      try {
        if (currentWorkspaceId) {
          const previousGraph: any = queryClient.getQueryData(queryKeys.workspaceGraph(currentWorkspaceId));
          previousNodeIds = (previousGraph?.nodes || []).map((node: any) => node.id);
        }
      } catch {
        // ignore snapshot errors
      }
      clearSelection();
      return { previousNodeIds };
    },
    onSuccess: async (createdNode: any, _vars, context: any) => {
      try {
        let newId = createdNode?.node_id || createdNode?.id;
        if (!newId && currentWorkspaceId) {
          await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
          const freshGraph: any = queryClient.getQueryData(queryKeys.workspaceGraph(currentWorkspaceId));
          if (freshGraph?.nodes) {
            const prevIds: string[] = context?.previousNodeIds || [];
            const diff = freshGraph.nodes.map((node: any) => node.id).filter((id: string) => !prevIds.includes(id));
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
    onError: (error: any) => {
      setOperationError('concatNodes', error.message);
      endOperation('concatNodes');
    },
  });

  const filterNodeMutation = useMutation({
    mutationFn: ({ workspaceId, nodeId, request }: { workspaceId: string; nodeId: string; request: FilterRequest }) =>
      nodesApi.filter(workspaceId, nodeId, request, authHeaders),
    onMutate: () => {
      startOperation('filterNode');
    },
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('filterNode');
    },
    onError: (error: any) => {
      setOperationError('filterNode', error.message);
      endOperation('filterNode');
    },
  });

  const computeColumnMutation = useMutation({
    mutationFn: ({ workspaceId, nodeId, request }: { workspaceId: string; nodeId: string; request: ExpressionTransformRequest }) =>
      nodesApi.computeColumn(workspaceId, nodeId, request, authHeaders),
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
    onError: (error: any) => {
      setOperationError('computeColumn', error.message);
      endOperation('computeColumn');
    },
  });

  const sliceNodeMutation = useMutation({
    mutationFn: ({ workspaceId, nodeId, request }: { workspaceId: string; nodeId: string; request: SliceRequest }) =>
      nodesApi.slice(workspaceId, nodeId, request, authHeaders),
    onMutate: () => {
      startOperation('sliceNode');
    },
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('sliceNode');
    },
    onError: (error: any) => {
      setOperationError('sliceNode', error.message);
      endOperation('sliceNode');
    },
  });

  const castNodeMutation = useMutation({
    mutationFn: ({ nodeId, column, targetType, format }: { nodeId: string; column: string; targetType: string; format?: string }) =>
      nodesApi.cast(ensureWorkspaceSelected(), nodeId, { column, target_type: targetType, format }, authHeaders),
    onMutate: () => {
      startOperation('castNode');
    },
    onSuccess: () => {
      if (currentWorkspaceId && selectedNodeId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, selectedNodeId) });
      }
      endOperation('castNode');
    },
    onError: (error: any) => {
      setOperationError('castNode', error.message);
      endOperation('castNode');
    },
  });

  const renameColumnMutation = useMutation({
    mutationFn: ({ nodeId, column, newName }: { nodeId: string; column: string; newName: string }) =>
      nodesApi.renameColumn(ensureWorkspaceSelected(), nodeId, column, newName, authHeaders),
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
    onError: (error: any) => {
      setOperationError('renameColumn', error.message);
      endOperation('renameColumn');
    },
  });

  const deleteColumnMutation = useMutation({
    mutationFn: ({ nodeId, column }: { nodeId: string; column: string }) =>
      nodesApi.deleteColumn(ensureWorkspaceSelected(), nodeId, column, authHeaders),
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
    onError: (error: any) => {
      setOperationError('deleteColumn', error.message);
      endOperation('deleteColumn');
    },
  });

  const convertToDocDataFrameMutation = useMutation({
    mutationFn: ({ nodeId, documentColumn }: { nodeId: string; documentColumn: string }) =>
      nodesApi.convert(ensureWorkspaceSelected(), nodeId, 'docdataframe', documentColumn, authHeaders),
    onMutate: () => startOperation('convertToDocDataFrame'),
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId && variables?.nodeId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
      }
      endOperation('convertToDocDataFrame');
    },
    onError: (error: any) => {
      setOperationError('convertToDocDataFrame', error.message);
      endOperation('convertToDocDataFrame');
    },
  });

  const convertToDataFrameMutation = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      nodesApi.convert(ensureWorkspaceSelected(), nodeId, 'dataframe', undefined, authHeaders),
    onMutate: () => startOperation('convertToDataFrame'),
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId && variables?.nodeId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
      }
      endOperation('convertToDataFrame');
    },
    onError: (error: any) => {
      setOperationError('convertToDataFrame', error.message);
      endOperation('convertToDataFrame');
    },
  });

  const convertToDocLazyFrameMutation = useMutation({
    mutationFn: ({ nodeId, documentColumn }: { nodeId: string; documentColumn: string }) =>
      nodesApi.convert(ensureWorkspaceSelected(), nodeId, 'doclazyframe', documentColumn, authHeaders),
    onMutate: () => startOperation('convertToDocLazyFrame'),
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId && variables?.nodeId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
      }
      endOperation('convertToDocLazyFrame');
    },
    onError: (error: any) => {
      setOperationError('convertToDocLazyFrame', error.message);
      endOperation('convertToDocLazyFrame');
    },
  });

  const convertToLazyFrameMutation = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      nodesApi.convert(ensureWorkspaceSelected(), nodeId, 'lazyframe', undefined, authHeaders),
    onMutate: () => startOperation('convertToLazyFrame'),
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId && variables?.nodeId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
      }
      endOperation('convertToLazyFrame');
    },
    onError: (error: any) => {
      setOperationError('convertToLazyFrame', error.message);
      endOperation('convertToLazyFrame');
    },
  });

  const resetDocumentColumnMutation = useMutation({
    mutationFn: ({ nodeId, documentColumn }: { nodeId: string; documentColumn?: string }) =>
      nodesApi.resetDocument(ensureWorkspaceSelected(), nodeId, documentColumn, authHeaders),
    onMutate: async ({ nodeId, documentColumn }) => {
      startOperation('resetDocumentColumn');
      if (!currentWorkspaceId) return;
      await queryClient.cancelQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      const previous = queryClient.getQueryData(queryKeys.workspaceGraph(currentWorkspaceId));
      queryClient.setQueryData(queryKeys.workspaceGraph(currentWorkspaceId), (old: any) => {
        if (!old?.nodes) return old;
        return {
          ...old,
          nodes: old.nodes.map((node: any) =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, documentColumn: documentColumn || node.data?.documentColumn } }
              : node
          ),
        };
      });
      return { previous };
    },
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId && variables?.nodeId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
      }
      endOperation('resetDocumentColumn');
    },
    onError: (error: any, _vars, context: any) => {
      setOperationError('resetDocumentColumn', error.message);
      if (context?.previous && currentWorkspaceId) {
        queryClient.setQueryData(queryKeys.workspaceGraph(currentWorkspaceId), context.previous);
      }
      endOperation('resetDocumentColumn');
    },
  });

  const actions = useMemo(() => ({
    setCurrentWorkspace: (workspaceId: string | null) => setCurrentWorkspaceMutation.mutate(workspaceId),
    createWorkspace: (name: string, description?: string) => createWorkspaceMutation.mutateAsync({ name, description }),
    deleteWorkspace: (workspaceId: string) => deleteWorkspaceMutation.mutateAsync(workspaceId),
    saveWorkspace: () => saveWorkspaceMutation.mutateAsync(),
    saveWorkspaceAs: (filename: string) => saveWorkspaceAsMutation.mutateAsync(filename),
    renameWorkspace: (newName: string) => updateWorkspaceNameMutation.mutateAsync(newName),
    renameNode: (nodeId: string, newName: string) =>
      renameNodeMutation.mutateAsync({ workspaceId: ensureWorkspaceSelected(), nodeId, newName }),
    deleteNode: (nodeId: string) =>
      deleteNodeMutation.mutateAsync({ workspaceId: ensureWorkspaceSelected(), nodeId }),
    createNodeFromFile: (
      filename: string,
      opts?: { mode?: 'DocLazyFrame' | 'LazyFrame' | 'DocDataFrame' | 'DataFrame'; documentColumn?: string | null }
    ) =>
      createNodeMutation.mutateAsync({
        workspaceId: ensureWorkspaceSelected(),
        filename,
        mode: opts?.mode,
        documentColumn: opts?.documentColumn,
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
        workspaceId: ensureWorkspaceSelected(),
        leftNodeId,
        rightNodeId,
        joinType,
        leftColumns,
        rightColumns,
        newNodeName,
      }),
    concatNodes: (nodeIds: string[], newNodeName?: string) =>
      concatNodesMutation.mutateAsync({ workspaceId: ensureWorkspaceSelected(), nodeIds, newNodeName }),
    concatPreview: (nodeIds: string[], page = 1, pageSize = 10) =>
      nodesApi.concatPreview(ensureWorkspaceSelected(), { node_ids: nodeIds }, page, pageSize, authHeaders),
    filterNode: (nodeId: string, request: FilterRequest) =>
      filterNodeMutation.mutateAsync({ workspaceId: ensureWorkspaceSelected(), nodeId, request }),
    filterPreview: (nodeId: string, request: FilterRequest, page = 1, pageSize = 10) =>
      nodesApi.filterPreview(ensureWorkspaceSelected(), nodeId, request, page, pageSize, authHeaders),
    sliceNode: (nodeId: string, request: SliceRequest) =>
      sliceNodeMutation.mutateAsync({ workspaceId: ensureWorkspaceSelected(), nodeId, request }),
    slicePreview: (nodeId: string, request: SliceRequest, page = 1, pageSize = 10) =>
      nodesApi.slicePreview(ensureWorkspaceSelected(), nodeId, request, page, pageSize, authHeaders),
    computeColumn: (nodeId: string, request: ExpressionTransformRequest) =>
      computeColumnMutation.mutateAsync({ workspaceId: ensureWorkspaceSelected(), nodeId, request }),
    computeColumnPreview: (nodeId: string, request: ExpressionTransformRequest) =>
      nodesApi.computeColumnPreview(ensureWorkspaceSelected(), nodeId, request, authHeaders),
    castColumn: (nodeId: string, column: string, targetType: string, format?: string) =>
      castNodeMutation.mutateAsync({ nodeId, column, targetType, format }),
    renameColumn: (nodeId: string, column: string, newName: string) =>
      renameColumnMutation.mutateAsync({ nodeId, column, newName }),
    deleteColumn: (nodeId: string, column: string) => deleteColumnMutation.mutateAsync({ nodeId, column }),
    convertToDocDataFrame: (nodeId: string, documentColumn: string) =>
      convertToDocDataFrameMutation.mutateAsync({ nodeId, documentColumn }),
    convertToDataFrame: (nodeId: string) => convertToDataFrameMutation.mutateAsync({ nodeId }),
    convertToDocLazyFrame: (nodeId: string, documentColumn: string) =>
      convertToDocLazyFrameMutation.mutateAsync({ nodeId, documentColumn }),
    convertToLazyFrame: (nodeId: string) => convertToLazyFrameMutation.mutateAsync({ nodeId }),
    resetDocumentColumn: (nodeId: string, documentColumn?: string) =>
      resetDocumentColumnMutation.mutateAsync({ nodeId, documentColumn }),
    refreshNodeSchema: async (nodeId: string): Promise<NodeSchemaResponse | null> => {
      if (!currentWorkspaceId) return null;
      const graphData = queryClient.getQueryData(queryKeys.workspaceGraph(currentWorkspaceId)) as any;
      const existingNodes = graphData?.nodes || [];
      const nodeExists = existingNodes.some((node: any) => node.id === nodeId);
      if (!nodeExists) {
        if (typeof window !== 'undefined' && localStorage.getItem('debugGraph') === '1') {
          console.log(`Node ${nodeId} no longer exists, skipping schema refresh`);
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
  }), [
    authHeaders,
    castNodeMutation,
    concatNodesMutation,
    convertToDataFrameMutation,
    convertToDocDataFrameMutation,
    convertToDocLazyFrameMutation,
    convertToLazyFrameMutation,
    createNodeMutation,
    createWorkspaceMutation,
    currentWorkspaceId,
    deleteColumnMutation,
    deleteNodeMutation,
    deleteWorkspaceMutation,
    filterNodeMutation,
    joinNodesMutation,
    queryClient,
    renameColumnMutation,
    renameNodeMutation,
    resetDocumentColumnMutation,
    saveWorkspaceAsMutation,
    saveWorkspaceMutation,
    setCurrentWorkspaceMutation,
    sliceNodeMutation,
    updateWorkspaceNameMutation,
    computeColumnMutation,
    ensureWorkspaceSelected,
  ]);

  return { actions } as const;
};
