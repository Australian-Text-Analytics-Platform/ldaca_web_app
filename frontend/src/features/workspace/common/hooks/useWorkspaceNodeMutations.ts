import { useMemo } from 'react';
import { type QueryClient, useMutation, isCancelledError } from '@tanstack/react-query';
import { toast } from 'sonner';
import { workspacesApi } from '@/api/workspaces';
import {
  nodesApi,
  type FilterRequest,
  type SliceRequest,
  type ReplaceRequest,
  type PolarsExpressionRequest,
  type NodeInfoResponse,
} from '@/api/nodes';
import {
  textApi,
  type ConcordanceDetachRequest,
  type ConcordanceDispersionDetachRequest,
  type ConcordanceMaterializeRequest,
  type QuotationRequest,
  type QuotationDetachRequest,
  type QuotationMaterializeRequest,
} from '@/api/text';
import { queryKeys } from '@/lib/queryKeys';
import { type NodeSchemaResponse } from '@/types';
import { type WorkspaceGraphResponse } from '@/types/api';
import { fetchNodeInfo, invalidateNodeInfoQuery } from '@/lib/nodeInfo';
import { normalizeSchemaFromInfo } from '@/hooks/useSchemaManagement';

interface WorkspaceNodeMutationsParams {
  authHeaders: Record<string, string>;
  currentWorkspaceId: string | null;
  selectedNodeId: string | null;
  setCurrentWorkspaceId: (workspaceId: string | null) => void;
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
      // Phase 4.1: store is canonical, the server query is one-shot
      // bootstrap. We used to also `setQueryData(currentWorkspace, nextId)`
      // here to keep the query cache in step, but with the bootstrap guard
      // the reconciler ignores subsequent query updates anyway, so the
      // query cache no longer drives state.
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
    onSuccess: (data) => {
      const newWorkspaceId = (data?.id as string | undefined) ?? null;
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      if (newWorkspaceId) {
        // Backend already marks the new workspace as current; sync the
        // client store so the UI auto-loads it without an extra click.
        setCurrentWorkspaceId(newWorkspaceId);
        clearSelection();
        queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      }
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

  const updateWorkspaceDescriptionMutation = useMutation({
    mutationFn: (description: string) => {
      ensureWorkspaceSelected();
      return workspacesApi.updateDescription(description, authHeaders);
    },
    onMutate: () => startOperation('updateWorkspaceDescription'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      endOperation('updateWorkspaceDescription');
    },
    onError: (error: Error) => {
      setOperationError('updateWorkspaceDescription', error.message);
      endOperation('updateWorkspaceDescription');
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
        invalidateNodeInfoQuery(queryClient, currentWorkspaceId, variables.nodeId);
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
        invalidateNodeInfoQuery(queryClient, currentWorkspaceId, variables.nodeId);
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
    onSuccess: (response: NodeInfoResponse) => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      invalidateWorkspaceSummaries();
      const changes = response?.dtype_normalization;
      if (changes && changes.length > 0) {
        const lines = changes.map(
          (c) => `${c.column}: ${c.from_dtype} → ${c.to_dtype} (${c.reason})`,
        );
        const heading =
          changes.length === 1
            ? '1 column was normalized to the standard dtype'
            : `${changes.length} columns were normalized to standard dtypes`;
        toast.info(heading, {
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
    onMutate: () => {
      startOperation('joinNodes');
      const previousGraph = currentWorkspaceId
        ? queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId))
        : undefined;
      const previousNodeIds = (previousGraph?.nodes || []).map((node) => node.id);
      clearSelection();
      return { previousNodeIds };
    },
    onSuccess: async (createdNode: Record<string, unknown>, _vars, context) => {
      let newId = (createdNode?.node_id as string | undefined) || (createdNode?.id as string | undefined);
      if (!newId && currentWorkspaceId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        const freshGraph = queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId));
        if (freshGraph?.nodes) {
          const prevIds = context?.previousNodeIds || [];
          const diff = freshGraph.nodes.map((node) => node.id).filter((id) => !prevIds.includes(id));
          if (diff.length === 1) newId = diff[0];
        }
      }
      if (newId) {
        setSelectedNodes([newId]);
      } else {
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
    mutationFn: ({ nodeIds, newNodeName, deduplicate }: { nodeIds: string[]; newNodeName?: string; deduplicate?: boolean }) =>
      nodesApi.concat({ node_ids: nodeIds, new_node_name: newNodeName, deduplicate }, authHeaders),
    onMutate: () => {
      startOperation('concatNodes');
      const previousGraph = currentWorkspaceId
        ? queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId))
        : undefined;
      const previousNodeIds = (previousGraph?.nodes || []).map((node) => node.id);
      clearSelection();
      return { previousNodeIds };
    },
    onSuccess: async (createdNode: Record<string, unknown>, _vars, context) => {
      let newId = (createdNode?.node_id as string | undefined) || (createdNode?.id as string | undefined);
      if (!newId && currentWorkspaceId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        const freshGraph = queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId));
        if (freshGraph?.nodes) {
          const prevIds = context?.previousNodeIds || [];
          const diff = freshGraph.nodes.map((node) => node.id).filter((id) => !prevIds.includes(id));
          if (diff.length === 1) newId = diff[0];
        }
      }
      if (newId) {
        setSelectedNodes([newId]);
      } else {
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

  const replaceTextMutation = useMutation({
    mutationFn: ({ nodeId, request }: { nodeId: string; request: ReplaceRequest }) =>
      nodesApi.replaceText(nodeId, request, authHeaders),
    onMutate: () => {
      startOperation('replaceText');
    },
    onSuccess: (_response, variables) => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        if (variables?.nodeId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
        }
      }
      endOperation('replaceText');
    },
    onError: (error: Error) => {
      setOperationError('replaceText', error.message);
      endOperation('replaceText');
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
        invalidateNodeInfoQuery(queryClient, currentWorkspaceId, variables.nodeId);
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

  // ---- Text-analysis mutations (Phase 4.8: moved here from
  // useWorkspaceInternal so the mutation surface lives in one place). ----

  const detachConcordanceMutation = useMutation({
    mutationFn: ({
      nodeId,
      request,
    }: {
      workspaceId: string;
      nodeId: string;
      request: ConcordanceDetachRequest;
    }) => textApi.concordanceDetach(nodeId, request, authHeaders),
    onMutate: () => startOperation('detachConcordance'),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(variables.workspaceId) });
      endOperation('detachConcordance');
    },
    onError: (error: Error) => {
      setOperationError('detachConcordance', error.message);
      endOperation('detachConcordance');
    },
  });

  const detachConcordanceDispersionMutation = useMutation({
    mutationFn: ({
      nodeId,
      request,
    }: {
      workspaceId: string;
      nodeId: string;
      request: ConcordanceDispersionDetachRequest;
    }) =>
      textApi.concordanceDispersionDetach(nodeId, request, authHeaders),
    onMutate: () => startOperation('detachConcordanceDispersion'),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(variables.workspaceId) });
      endOperation('detachConcordanceDispersion');
    },
    onError: (error: Error) => {
      setOperationError('detachConcordanceDispersion', error.message);
      endOperation('detachConcordanceDispersion');
    },
  });

  const materializeConcordanceMutation = useMutation({
    mutationFn: ({
      nodeId,
      request,
    }: {
      nodeId: string;
      request: ConcordanceMaterializeRequest;
    }) => textApi.concordanceMaterialize(nodeId, request, authHeaders),
    onMutate: () => startOperation('materializeConcordance'),
    onSuccess: () => {
      endOperation('materializeConcordance');
    },
    onError: (error: Error) => {
      setOperationError('materializeConcordance', error.message);
      endOperation('materializeConcordance');
    },
  });

  const quotationMutation = useMutation({
    mutationFn: ({
      nodeId,
      request,
    }: {
      nodeId: string;
      request: QuotationRequest;
    }) => textApi.quotation(nodeId, request, authHeaders),
    onMutate: () => startOperation('quotation'),
    onSuccess: () => {
      endOperation('quotation');
    },
    onError: (error: Error) => {
      setOperationError('quotation', error.message);
      endOperation('quotation');
    },
  });

  const detachQuotationMutation = useMutation({
    mutationFn: ({
      nodeId,
      request,
    }: {
      workspaceId: string;
      nodeId: string;
      request: QuotationDetachRequest;
    }) => textApi.quotationDetach(nodeId, request, authHeaders),
    onMutate: () => startOperation('detachQuotation'),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(variables.workspaceId) });
      endOperation('detachQuotation');
    },
    onError: (error: Error) => {
      setOperationError('detachQuotation', error.message);
      endOperation('detachQuotation');
    },
  });

  const materializeQuotationMutation = useMutation({
    mutationFn: ({
      nodeId,
      request,
    }: {
      nodeId: string;
      request: QuotationMaterializeRequest;
    }) => textApi.quotationMaterialize(nodeId, request, authHeaders),
    onMutate: () => startOperation('materializeQuotation'),
    onSuccess: () => {
      endOperation('materializeQuotation');
    },
    onError: (error: Error) => {
      setOperationError('materializeQuotation', error.message);
      endOperation('materializeQuotation');
    },
  });

  // Memoize the action surface so consumers (the WorkspaceProvider context
  // value, every component that destructures useWorkspaceActions, every
  // mutation-fn closure that captures a specific action) keep a stable
  // identity across renders. Without this, the four-slice WorkspaceProvider
  // value churns every parent render and cascades through ~30 consumers.
  //
  // Deps explanation: TanStack's `*.mutateAsync` is referentially stable
  // across the parent's lifetime, so capturing each mutation by closure is
  // safe even though the mutation object itself is recreated. The values
  // that DO change between renders are `authHeaders`, `currentWorkspaceId`,
  // and `queryClient`; those are listed below. Listing the 20 mutation refs
  // would needlessly invalidate the memo each render without a behaviour
  // difference.
  const actions = useMemo(() => ({
    setCurrentWorkspace: (workspaceId: string | null) => setCurrentWorkspaceMutation.mutateAsync(workspaceId),
    createWorkspace: (name: string, description?: string) => createWorkspaceMutation.mutateAsync({ name, description }),
    deleteWorkspace: (workspaceId: string) => deleteWorkspaceMutation.mutateAsync(workspaceId),
    saveWorkspace: () => saveWorkspaceMutation.mutateAsync(),
    renameWorkspace: (newName: string) => updateWorkspaceNameMutation.mutateAsync(newName),
    updateWorkspaceDescription: (description: string) => updateWorkspaceDescriptionMutation.mutateAsync(description),
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
    concatNodes: (nodeIds: string[], newNodeName?: string, deduplicate?: boolean) =>
      concatNodesMutation.mutateAsync({ nodeIds, newNodeName, deduplicate }),
    concatPreview: (nodeIds: string[], page = 1, pageSize = 10, deduplicate?: boolean) =>
      nodesApi.concatPreview({ node_ids: nodeIds, deduplicate }, page, pageSize, authHeaders),
    filterNode: (nodeId: string, request: FilterRequest) =>
      filterNodeMutation.mutateAsync({ nodeId, request }),
    filterPreview: (nodeId: string, request: FilterRequest, page = 1, pageSize = 10) =>
      nodesApi.filterPreview(nodeId, request, page, pageSize, authHeaders),
    sliceNode: (nodeId: string, request: SliceRequest) =>
      sliceNodeMutation.mutateAsync({ nodeId, request }),
    slicePreview: (nodeId: string, request: SliceRequest, page = 1, pageSize = 10) =>
      nodesApi.slicePreview(nodeId, request, page, pageSize, authHeaders),
    replaceText: (nodeId: string, request: ReplaceRequest) =>
      replaceTextMutation.mutateAsync({ nodeId, request }),
    replaceTextPreview: (nodeId: string, request: ReplaceRequest, page = 1, pageSize = 10) =>
      nodesApi.replaceTextPreview(nodeId, request, page, pageSize, authHeaders),
    polarsExpressionPreview: (nodeId: string, request: PolarsExpressionRequest, page = 1, pageSize = 10) =>
      nodesApi.polarsExpressionPreview(nodeId, request, page, pageSize, authHeaders),
    polarsExpressionApply: (nodeId: string, request: PolarsExpressionRequest) =>
      nodesApi.polarsExpressionApply(nodeId, request, authHeaders),
    castColumn: (nodeId: string, column: string, targetType: string, format?: string) =>
      castNodeMutation.mutateAsync({ nodeId, column, targetType, format }),
    renameColumn: (nodeId: string, column: string, newName: string) =>
      renameColumnMutation.mutateAsync({ nodeId, column, newName }),
    deleteColumn: (nodeId: string, column: string) => deleteColumnMutation.mutateAsync({ nodeId, column }),
    detachConcordance: (nodeId: string, request: ConcordanceDetachRequest) =>
      detachConcordanceMutation.mutateAsync({
        workspaceId: ensureWorkspaceSelected(),
        nodeId,
        request,
      }),
    detachConcordanceDispersion: (
      nodeId: string,
      request: ConcordanceDispersionDetachRequest,
    ) =>
      detachConcordanceDispersionMutation.mutateAsync({
        workspaceId: ensureWorkspaceSelected(),
        nodeId,
        request,
      }),
    materializeConcordance: (nodeId: string, request: ConcordanceMaterializeRequest) =>
      materializeConcordanceMutation.mutateAsync({
        nodeId,
        request,
      }),
    quotationSearch: (nodeId: string, request: QuotationRequest) =>
      quotationMutation.mutateAsync({
        nodeId,
        request,
      }),
    detachQuotation: (nodeId: string, request: QuotationDetachRequest) =>
      detachQuotationMutation.mutateAsync({
        workspaceId: ensureWorkspaceSelected(),
        nodeId,
        request,
      }),
    materializeQuotation: (nodeId: string, request: QuotationMaterializeRequest) =>
      materializeQuotationMutation.mutateAsync({
        nodeId,
        request,
      }),
    refreshNodeSchema: async (nodeId: string): Promise<NodeSchemaResponse | null> => {
      if (!currentWorkspaceId) return null;
      const graphData = queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId));
      const existingNodes = graphData?.nodes || [];
      const nodeExists = existingNodes.some((node) => node.id === nodeId);
      if (!nodeExists) {
        return null;
      }
      try {
        const info = await fetchNodeInfo({ queryClient, workspaceId: currentWorkspaceId, nodeId, headers: authHeaders, force: true });
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
        // `force: true` in fetchNodeInfo triggers removeQueries, which cancels
        // any inflight observer-driven query for the same key. TanStack throws
        // CancelledError in that race. TanStack's CancelledError sets
        // ``error.message === "CancelledError"`` but leaves ``error.name`` at
        // ``"Error"``, so use the exported type guard rather than name-sniffing.
        if (isCancelledError(error)) {
          return null;
        } else {
          console.error('Failed to refresh node schema:', error);
        }
        return null;
      }
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above; mutation refs are intentionally omitted because their mutateAsync identities are stable.
  }), [authHeaders, currentWorkspaceId, queryClient]);

  return { actions } as const;
};
