import { useEffect, useMemo, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  textApi,
  ConcordanceRequest,
  ConcordanceDetachRequest,
  QuotationRequest,
  QuotationDetachRequest,
  ConcordanceAnalysisRequest,
} from '../api/text';
import { queryKeys } from '../lib/queryKeys';
import { useWorkspaceCore } from './workspace/useWorkspaceCore';
import { useWorkspaceQueries } from './workspace/useWorkspaceQueries';
import { useWorkspaceNodeMutations } from './workspace/useWorkspaceNodeMutations';

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

  useEffect(() => {
    if (!isAuthenticated) {
      setCurrentWorkspaceId((prev) => (prev === null ? prev : null));
      return;
    }

    if (currentWorkspaceIdFromQuery !== undefined) {
      setCurrentWorkspaceId((prev) =>
        prev === currentWorkspaceIdFromQuery ? prev : currentWorkspaceIdFromQuery
      );
    } else if (currentWorkspaceQueryError) {
      setCurrentWorkspaceId((prev) => (prev === null ? prev : null));
    }
  }, [currentWorkspaceIdFromQuery, currentWorkspaceQueryError, isAuthenticated, setCurrentWorkspaceId]);

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

  const ensureWorkspaceSelected = useCallback(() => {
    if (!currentWorkspaceId) {
      throw new Error('No workspace selected');
    }
    return currentWorkspaceId;
  }, [currentWorkspaceId]);

  const concordanceMutation = useMutation({
    mutationFn: ({
      workspaceId,
      nodeId,
      request,
    }: {
      workspaceId: string;
      nodeId: string;
      request: ConcordanceRequest;
    }) => {
      const unifiedRequest: ConcordanceAnalysisRequest = {
        node_ids: [nodeId],
        node_columns: { [nodeId]: request.column },
        search_word: request.search_word,
        num_left_tokens: request.num_left_tokens,
        num_right_tokens: request.num_right_tokens,
        regex: request.regex,
        case_sensitive: request.case_sensitive,
        combined: false,
      };

      if (request.sort_by) {
        unifiedRequest.sort_by = request.sort_by;
      }

      return textApi.concordance(unifiedRequest, authHeaders);
    },
    onMutate: () => startOperation('concordance'),
    onSuccess: () => {
      endOperation('concordance');
    },
    onError: (error: any) => {
      setOperationError('concordance', error.message);
      endOperation('concordance');
    },
  });

  const detachConcordanceMutation = useMutation({
    mutationFn: ({
      workspaceId,
      nodeId,
      request,
    }: {
      workspaceId: string;
      nodeId: string;
      request: ConcordanceDetachRequest;
    }) => textApi.concordanceDetach(nodeId, request as any, authHeaders),
    onMutate: () => startOperation('detachConcordance'),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(variables.workspaceId) });
      endOperation('detachConcordance');
    },
    onError: (error: any) => {
      setOperationError('detachConcordance', error.message);
      endOperation('detachConcordance');
    },
  });

  const quotationMutation = useMutation({
    mutationFn: ({
      workspaceId,
      nodeId,
      request,
    }: {
      workspaceId: string;
      nodeId: string;
      request: QuotationRequest;
    }) => textApi.quotation(nodeId, request as any, authHeaders),
    onMutate: () => startOperation('quotation'),
    onSuccess: () => {
      endOperation('quotation');
    },
    onError: (error: any) => {
      setOperationError('quotation', error.message);
      endOperation('quotation');
    },
  });

  const detachQuotationMutation = useMutation({
    mutationFn: ({
      workspaceId,
      nodeId,
      request,
    }: {
      workspaceId: string;
      nodeId: string;
      request: QuotationDetachRequest;
    }) => textApi.quotationDetach(nodeId, request as any, authHeaders),
    onMutate: () => startOperation('detachQuotation'),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(variables.workspaceId) });
      endOperation('detachQuotation');
    },
    onError: (error: any) => {
      setOperationError('detachQuotation', error.message);
      endOperation('detachQuotation');
    },
  });

  const selectionActions = useMemo(() => ({
    selectNode,
    selectNodes: setSelectedNodes,
    toggleNodeSelection,
    clearSelection,
  }), [selectNode, setSelectedNodes, toggleNodeSelection, clearSelection]);

  const textActions = useMemo(() => ({
    concordanceSearch: (nodeId: string, request: ConcordanceRequest) =>
      concordanceMutation.mutateAsync({
        workspaceId: ensureWorkspaceSelected(),
        nodeId,
        request,
      }),
    detachConcordance: (nodeId: string, request: ConcordanceDetachRequest) =>
      detachConcordanceMutation.mutateAsync({
        workspaceId: ensureWorkspaceSelected(),
        nodeId,
        request,
      }),
    quotationSearch: (nodeId: string, request: QuotationRequest) =>
      quotationMutation.mutateAsync({
        workspaceId: ensureWorkspaceSelected(),
        nodeId,
        request,
      }),
    detachQuotation: (nodeId: string, request: QuotationDetachRequest) =>
      detachQuotationMutation.mutateAsync({
        workspaceId: ensureWorkspaceSelected(),
        nodeId,
        request,
      }),
  }), [concordanceMutation, detachConcordanceMutation, quotationMutation, detachQuotationMutation, ensureWorkspaceSelected]);

  const actions = useMemo(() => ({
    ...selectionActions,
    ...nodeActions,
    ...textActions,
  }), [selectionActions, nodeActions, textActions]);

  const isLoading = useMemo(() => ({
    ...queryLoadingState,
    operations: loadingOperationCount > 0,
  }), [queryLoadingState, loadingOperationCount]);

  const errors = useMemo(() => ({
    ...queryErrorState,
    operations: Object.values(operationErrorsRecord)[0] || null,
  }), [queryErrorState, operationErrorsRecord]);

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
  };
};
