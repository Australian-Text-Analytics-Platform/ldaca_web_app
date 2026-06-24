import { useMemo } from 'react';
import { type QueryClient, useMutation } from '@tanstack/react-query';
import {
  detachConcordance,
  detachConcordanceDispersion,
  detachQuotation,
  getQuotation,
  materializeConcordance,
  materializeQuotation,
} from '@/api';
import type {
  ConcordanceDetachRequest,
  ConcordanceDispersionDetachRequest,
  ConcordanceMaterializeRequest,
  QuotationDetachRequest,
  QuotationMaterializeRequest,
  QuotationRequestInput,
} from '@/api';
import { invalidateWorkspaceGraphQuery } from './workspaceMutationCache';

type QuotationRequest = QuotationRequestInput;

interface WorkspaceAnalysisMutationsParams {
  authHeaders: Record<string, string>;
  currentWorkspaceId: string | null;
  queryClient: QueryClient;
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
  setOperationError: (operationId: string, error: string) => void;
}

/**
 * Owns text-analysis actions exposed through the workspace action facade.
 * Used by: useWorkspaceNodeMutations because analysis views need detached
 * result nodes, materialization, and quotation search without coupling the
 * main workspace mutation hook to each analysis endpoint.
 * Flow: build generated-SDK mutations, guard detach operations that need an
 * active workspace id, refresh graph state after detach, and return stable
 * action functions for WorkspaceProvider consumers.
 */
export const useWorkspaceAnalysisMutations = ({
  authHeaders,
  currentWorkspaceId,
  queryClient,
  startOperation,
  endOperation,
  setOperationError,
}: WorkspaceAnalysisMutationsParams) => {
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
    }) =>
      detachConcordance({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('detachConcordance');
    },
    onSuccess: (_data, variables) => {
      invalidateWorkspaceGraphQuery(queryClient, variables.workspaceId);
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
      detachConcordanceDispersion({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => ({ task_id: data.metadata?.task_id ?? undefined })),
    onMutate: () => {
      startOperation('detachConcordanceDispersion');
    },
    onSuccess: (_data, variables) => {
      invalidateWorkspaceGraphQuery(queryClient, variables.workspaceId);
      endOperation('detachConcordanceDispersion');
    },
    onError: (error: Error) => {
      setOperationError('detachConcordanceDispersion', error.message);
      endOperation('detachConcordanceDispersion');
    },
  });

  const materializeConcordanceMutation = useMutation({
    mutationFn: ({ nodeId, request }: { nodeId: string; request: ConcordanceMaterializeRequest }) =>
      materializeConcordance({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('materializeConcordance');
    },
    onSuccess: () => {
      endOperation('materializeConcordance');
    },
    onError: (error: Error) => {
      setOperationError('materializeConcordance', error.message);
      endOperation('materializeConcordance');
    },
  });

  const quotationMutation = useMutation({
    mutationFn: ({ nodeId, request }: { nodeId: string; request: QuotationRequest }) =>
      getQuotation({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('quotation');
    },
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
    }) =>
      detachQuotation({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('detachQuotation');
    },
    onSuccess: (_data, variables) => {
      invalidateWorkspaceGraphQuery(queryClient, variables.workspaceId);
      endOperation('detachQuotation');
    },
    onError: (error: Error) => {
      setOperationError('detachQuotation', error.message);
      endOperation('detachQuotation');
    },
  });

  const materializeQuotationMutation = useMutation({
    mutationFn: ({ nodeId, request }: { nodeId: string; request: QuotationMaterializeRequest }) =>
      materializeQuotation({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('materializeQuotation');
    },
    onSuccess: () => {
      endOperation('materializeQuotation');
    },
    onError: (error: Error) => {
      setOperationError('materializeQuotation', error.message);
      endOperation('materializeQuotation');
    },
  });

  const actions = useMemo(
    () => ({
      detachConcordance: (nodeId: string, request: ConcordanceDetachRequest) =>
        detachConcordanceMutation.mutateAsync({
          workspaceId: ensureWorkspaceSelected(),
          nodeId,
          request,
        }),
      detachConcordanceDispersion: (nodeId: string, request: ConcordanceDispersionDetachRequest) =>
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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation refs intentionally omitted; mutateAsync identities are stable
    [currentWorkspaceId],
  );

  return { actions } as const;
};
