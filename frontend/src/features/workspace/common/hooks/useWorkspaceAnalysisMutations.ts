import { useMemo } from 'react';
import { type QueryClient, useMutation } from '@tanstack/react-query';
import { submitTabAnalysis, submitChildAnalysis } from '@/api';
import type {
  ConcordanceDetachmentAnalysisRequest,
  ConcordanceDispersionDetachmentAnalysisRequest,
  QuotationAnalysisRequest,
  QuotationDetachmentAnalysisRequest,
  TopicModelingDetachmentAnalysisRequest,
} from '@/api';
import { invalidateWorkspaceGraphQuery } from './workspaceMutationCache';
import { createWorkspaceOperationLifecycle } from './workspaceMutationLifecycle';

interface WorkspaceAnalysisMutationsParams {
  currentWorkspaceId: string | null;
  queryClient: QueryClient;
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
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
  currentWorkspaceId,
  queryClient,
  startOperation,
  endOperation,
}: WorkspaceAnalysisMutationsParams) => {
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

  const detachConcordanceMutation = useMutation({
    mutationFn: ({
      workspaceId,
      analysisId,
      request,
    }: {
      workspaceId: string;
      analysisId: string;
      request: Omit<ConcordanceDetachmentAnalysisRequest, 'kind'>;
    }) =>
      submitChildAnalysis({
        body: { kind: 'concordance_detachment', ...request },
        path: { workspace_id: workspaceId, analysis_id: analysisId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: operationLifecycle.onMutate('detachConcordance'),
    onSuccess: operationLifecycle.onSuccess('detachConcordance', (_data, variables) => {
      invalidateWorkspaceGraphQuery(queryClient, variables.workspaceId);
    }),
    onError: operationLifecycle.onError('detachConcordance'),
  });

  const detachConcordanceDispersionMutation = useMutation({
    mutationFn: ({
      workspaceId,
      analysisId,
      request,
    }: {
      workspaceId: string;
      analysisId: string;
      request: Omit<ConcordanceDispersionDetachmentAnalysisRequest, 'kind'>;
    }) =>
      submitChildAnalysis({
        body: { kind: 'concordance_dispersion_detachment', ...request },
        path: { workspace_id: workspaceId, analysis_id: analysisId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: operationLifecycle.onMutate('detachConcordanceDispersion'),
    onSuccess: operationLifecycle.onSuccess('detachConcordanceDispersion', (_data, variables) => {
      invalidateWorkspaceGraphQuery(queryClient, variables.workspaceId);
    }),
    onError: operationLifecycle.onError('detachConcordanceDispersion'),
  });

  const quotationMutation = useMutation({
    mutationFn: ({ tabId, request }: { tabId: string; request: QuotationAnalysisRequest }) =>
      submitTabAnalysis({
        body: { kind: 'quotation', ...request },
        path: { workspace_id: ensureWorkspaceSelected(), tab_id: tabId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: operationLifecycle.onMutate('quotation'),
    onSuccess: operationLifecycle.onSuccess('quotation'),
    onError: operationLifecycle.onError('quotation'),
  });

  const detachTopicModelingMutation = useMutation({
    mutationFn: ({
      workspaceId,
      analysisId,
      request,
    }: {
      workspaceId: string;
      analysisId: string;
      request: Omit<TopicModelingDetachmentAnalysisRequest, 'kind'>;
    }) =>
      submitChildAnalysis({
        body: { kind: 'topic_modeling_detachment', ...request },
        path: { workspace_id: workspaceId, analysis_id: analysisId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: operationLifecycle.onMutate('detachTopicModeling'),
    onSuccess: operationLifecycle.onSuccess('detachTopicModeling', (_data, variables) => {
      invalidateWorkspaceGraphQuery(queryClient, variables.workspaceId);
    }),
    onError: operationLifecycle.onError('detachTopicModeling'),
  });

  const detachQuotationMutation = useMutation({
    mutationFn: ({
      workspaceId,
      analysisId,
      request,
    }: {
      workspaceId: string;
      analysisId: string;
      request: Omit<QuotationDetachmentAnalysisRequest, 'kind'>;
    }) =>
      submitChildAnalysis({
        body: { kind: 'quotation_detachment', ...request },
        path: { workspace_id: workspaceId, analysis_id: analysisId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: operationLifecycle.onMutate('detachQuotation'),
    onSuccess: operationLifecycle.onSuccess('detachQuotation', (_data, variables) => {
      invalidateWorkspaceGraphQuery(queryClient, variables.workspaceId);
    }),
    onError: operationLifecycle.onError('detachQuotation'),
  });

  const actions = useMemo(
    () => ({
      detachConcordance: (
        analysisId: string,
        request: Omit<ConcordanceDetachmentAnalysisRequest, 'kind'>,
      ) =>
        detachConcordanceMutation.mutateAsync({
          workspaceId: ensureWorkspaceSelected(),
          analysisId,
          request,
        }),
      detachConcordanceDispersion: (
        analysisId: string,
        request: Omit<ConcordanceDispersionDetachmentAnalysisRequest, 'kind'>,
      ) =>
        detachConcordanceDispersionMutation.mutateAsync({
          workspaceId: ensureWorkspaceSelected(),
          analysisId,
          request,
        }),
      quotationSearch: (tabId: string, request: QuotationAnalysisRequest) =>
        quotationMutation.mutateAsync({
          tabId,
          request,
        }),
      detachQuotation: (
        analysisId: string,
        request: Omit<QuotationDetachmentAnalysisRequest, 'kind'>,
      ) =>
        detachQuotationMutation.mutateAsync({
          workspaceId: ensureWorkspaceSelected(),
          analysisId,
          request,
        }),
      detachTopicModeling: (
        analysisId: string,
        request: Omit<TopicModelingDetachmentAnalysisRequest, 'kind'>,
      ) =>
        detachTopicModelingMutation.mutateAsync({
          workspaceId: ensureWorkspaceSelected(),
          analysisId,
          request,
        }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation refs intentionally omitted; mutateAsync identities are stable
    [currentWorkspaceId],
  );

  return { actions } as const;
};
