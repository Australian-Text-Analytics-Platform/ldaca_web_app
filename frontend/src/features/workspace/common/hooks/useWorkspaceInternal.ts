import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  textApi,
  type ConcordanceDetachRequest,
  type ConcordanceMaterializeRequest,
  type QuotationRequest,
  type QuotationDetachRequest,
  type QuotationMaterializeRequest,
} from '@/api/text';
import { queryKeys } from '@/lib/queryKeys';
import { useWorkspaceCore } from './useWorkspaceCore';
import { useWorkspaceQueries } from './useWorkspaceQueries';
import { useWorkspaceNodeMutations } from './useWorkspaceNodeMutations';

export const useWorkspaceInternal = () => {
  const core = useWorkspaceCore();
  const queryClient = useQueryClient();

  const {
    authHeaders,
    isAuthenticated,
    currentWorkspaceId,
    setCurrentWorkspaceId,
    selectedNodeId,
    selectedNodeIds,
    selectNode,
    setSelectedNodes,
    toggleNodeSelection,
    clearSelection,
    getPaginationForNode,
    handlePageChange,
    handlePageSizeChange,
    handleSortingChange,
    handleFilterChange,
    loadingOperationCount,
    operationErrorsRecord,
    startOperation,
    endOperation,
    setOperationError,
  } = core;

  const {
    workspaces,
    currentWorkspace,
    workspaceGraph,
    nodes,
    selectedNode,
    selectedNodes,
    nodeData,
    queryLoadingState,
    queryErrorState,
    currentWorkspaceIdFromQuery,
    currentWorkspaceQueryError,
  } = useWorkspaceQueries({
    authHeaders,
    isAuthenticated,
    currentWorkspaceId,
    selectedNodeId,
    selectedNodeIds,
    getPaginationForNode,
  });

  // Phase 4.1: the `current.get` server query is treated as a one-shot
  // bootstrap that hydrates the selectionStore. After the first hydration
  // (or first error after authentication), `setCurrentWorkspace` mutations
  // are the only writer — without this guard, every refetch of the
  // currentWorkspace query would otherwise revert local state back to the
  // server's stale value during the brief window before the post-mutation
  // invalidate lands.
  const hasBootstrappedRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated) {
      hasBootstrappedRef.current = false;
      if (currentWorkspaceId !== null) setCurrentWorkspaceId(null);
      return;
    }
    if (hasBootstrappedRef.current) return;

    if (currentWorkspaceIdFromQuery !== undefined) {
      hasBootstrappedRef.current = true;
      if (currentWorkspaceId !== currentWorkspaceIdFromQuery) {
        setCurrentWorkspaceId(currentWorkspaceIdFromQuery);
      }
    } else if (currentWorkspaceQueryError) {
      hasBootstrappedRef.current = true;
      if (currentWorkspaceId !== null) setCurrentWorkspaceId(null);
    }
  }, [
    currentWorkspaceId,
    currentWorkspaceIdFromQuery,
    currentWorkspaceQueryError,
    isAuthenticated,
    setCurrentWorkspaceId,
  ]);

  const { actions: nodeActions } = useWorkspaceNodeMutations({
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
  });

  const ensureWorkspaceSelected = () => {
    if (!currentWorkspaceId) {
      throw new Error('No workspace selected');
    }
    return currentWorkspaceId;
  };

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

  const selectionActions = ({
    selectNode,
    selectNodes: setSelectedNodes,
    toggleNodeSelection,
    clearSelection,
  });

  const textActions = ({
    detachConcordance: (nodeId: string, request: ConcordanceDetachRequest) =>
      detachConcordanceMutation.mutateAsync({
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
  });

  const actions = ({
    ...selectionActions,
    ...nodeActions,
    ...textActions,
  });

  const isLoading = ({
    ...queryLoadingState,
    operations: loadingOperationCount > 0,
  });

  const errors = ({
    ...queryErrorState,
    operations: Object.values(operationErrorsRecord)[0] || null,
  });

  return {
    workspaces,
    currentWorkspace,
    currentWorkspaceId,
    nodes,
    selectedNode,
    selectedNodes,
    selectedNodeId,
    selectedNodeIds,
    workspaceGraph,
    nodeData,
    isLoading,
    errors,
    actions,
    handlePageChange,
    handlePageSizeChange,
    handleSortingChange,
    handleFilterChange,
    getPaginationForNode,
  };
};
