import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  textApi,
  type ConcordanceRequest,
  type ConcordanceDetachRequest,
  type ConcordanceMaterializeRequest,
  type QuotationRequest,
  type QuotationDetachRequest,
  type QuotationMaterializeRequest,
  type ConcordanceAnalysisRequest,
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

  const ensureWorkspaceSelected = () => {
    if (!currentWorkspaceId) {
      throw new Error('No workspace selected');
    }
    return currentWorkspaceId;
  };

  const concordanceMutation = useMutation({
    mutationFn: ({
      nodeId,
      request,
    }: {
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
    onError: (error: Error) => {
      setOperationError('concordance', error.message);
      endOperation('concordance');
    },
  });

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
    concordanceSearch: (nodeId: string, request: ConcordanceRequest) =>
      concordanceMutation.mutateAsync({
        nodeId,
        request,
      }),
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
  };
};
