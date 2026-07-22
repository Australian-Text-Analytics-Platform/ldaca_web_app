import { useMemo } from 'react';
import { type QueryClient, useMutation } from '@tanstack/react-query';
import { submitChildAnalysis } from '@/api';
import type {
  ConcordanceDetachmentAnalysisRequest,
  ConcordanceDispersionDetachmentAnalysisRequest,
  QuotationDetachmentAnalysisRequest,
  TopicModelingDetachmentAnalysisRequest,
} from '@/api';
import { invalidateWorkspaceGraphQuery } from './workspaceMutationCache';

interface WorkspaceAnalysisMutationsParams {
  currentWorkspaceId: string | null;
  queryClient: QueryClient;
}

/**
 * Owns text-analysis actions exposed through the workspace action facade.
 * Used by: useWorkspaceNodeMutations because analysis views need detached
 * result nodes without coupling the
 * main workspace mutation hook to each analysis endpoint.
 * Flow: build generated-SDK mutations, guard detach operations that need an
 * active workspace id, refresh graph state after detach, and return stable
 * action functions for WorkspaceProvider consumers.
 */
export const useWorkspaceAnalysisMutations = ({
  currentWorkspaceId,
  queryClient,
}: WorkspaceAnalysisMutationsParams) => {
  const ensureWorkspaceSelected = () => {
    if (!currentWorkspaceId) {
      throw new Error('No workspace selected');
    }
    return currentWorkspaceId;
  };
  const detachConcordanceMutation = useMutation({
    mutationKey: ['workspace', 'detach-concordance'],
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
    onSuccess: (_data, variables) => {
      invalidateWorkspaceGraphQuery(queryClient, variables.workspaceId);
    },
  });

  const detachConcordanceDispersionMutation = useMutation({
    mutationKey: ['workspace', 'detach-concordance-dispersion'],
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
    onSuccess: (_data, variables) => {
      invalidateWorkspaceGraphQuery(queryClient, variables.workspaceId);
    },
  });

  const detachTopicModelingMutation = useMutation({
    mutationKey: ['workspace', 'detach-topic-modeling'],
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
    onSuccess: (_data, variables) => {
      invalidateWorkspaceGraphQuery(queryClient, variables.workspaceId);
    },
  });

  const detachQuotationMutation = useMutation({
    mutationKey: ['workspace', 'detach-quotation'],
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
    onSuccess: (_data, variables) => {
      invalidateWorkspaceGraphQuery(queryClient, variables.workspaceId);
    },
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
