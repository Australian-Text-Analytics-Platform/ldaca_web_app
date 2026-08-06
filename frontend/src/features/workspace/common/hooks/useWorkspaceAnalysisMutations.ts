import { type QueryClient, useMutation } from '@tanstack/react-query';
import { submitTabAnalysis } from '@/api';
import type {
  ConcordanceRunAllAnalysisRequest,
  ConcordanceDocumentPublicationAnalysisRequest,
  ConcordanceMatchPublicationAnalysisRequest,
  QuotationResultPublicationAnalysisRequest,
  QuotationRunAllAnalysisRequest,
  TopicModelingDetachmentAnalysisRequest,
} from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateWorkspaceGraphQuery } from './workspaceMutationCache';

interface WorkspaceAnalysisMutationsParams {
  currentWorkspaceId: string | null;
  queryClient: QueryClient;
}

type ResultPublicationRequest =
  | ({ kind: 'concordance_match_publication' } & ConcordanceMatchPublicationAnalysisRequest)
  | ({ kind: 'concordance_document_publication' } & ConcordanceDocumentPublicationAnalysisRequest)
  | ({ kind: 'quotation_result_publication' } & QuotationResultPublicationAnalysisRequest);

/** Owns supporting and Run All Analysis commands exposed by Workspace actions. */
export const useWorkspaceAnalysisMutations = ({
  currentWorkspaceId,
  queryClient,
}: WorkspaceAnalysisMutationsParams) => {
  const ensureWorkspaceSelected = () => {
    if (!currentWorkspaceId) throw new Error('No workspace selected');
    return currentWorkspaceId;
  };
  const runConcordanceAllMutation = useMutation({
    mutationKey: ['workspace', 'concordance-run-all'],
    mutationFn: ({
      workspaceId,
      tabId,
      request,
      supersedesAnalysisIds,
    }: {
      workspaceId: string;
      tabId: string;
      request: Omit<ConcordanceRunAllAnalysisRequest, 'kind'>;
      supersedesAnalysisIds: string[];
    }) =>
      submitTabAnalysis({
        body: {
          execution_scope: 'run_all',
          request: { kind: 'concordance_run_all', ...request },
          supersedes_analysis_ids: supersedesAnalysisIds,
        },
        path: { workspace_id: workspaceId, tab_id: tabId },
        throwOnError: true,
      }).then(({ data }) => data),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceAnalyses(variables.workspaceId),
      });
    },
  });
  const runQuotationAllMutation = useMutation({
    mutationKey: ['workspace', 'quotation-run-all'],
    mutationFn: ({
      workspaceId,
      tabId,
      request,
      supersedesAnalysisIds,
    }: {
      workspaceId: string;
      tabId: string;
      request: Omit<QuotationRunAllAnalysisRequest, 'kind'>;
      supersedesAnalysisIds: string[];
    }) =>
      submitTabAnalysis({
        body: {
          execution_scope: 'run_all',
          request: { kind: 'quotation_run_all', ...request },
          supersedes_analysis_ids: supersedesAnalysisIds,
        },
        path: { workspace_id: workspaceId, tab_id: tabId },
        throwOnError: true,
      }).then(({ data }) => data),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceAnalyses(variables.workspaceId),
      });
    },
  });
  const detachTopicModelingMutation = useMutation({
    mutationKey: ['workspace', 'detach-topic-modeling'],
    mutationFn: ({
      workspaceId,
      tabId,
      analysisId,
      request,
    }: {
      workspaceId: string;
      tabId: string;
      analysisId: string;
      request: Omit<TopicModelingDetachmentAnalysisRequest, 'kind'>;
    }) =>
      submitTabAnalysis({
        body: {
          execution_scope: 'supporting',
          parent_analysis_id: analysisId,
          request: { kind: 'topic_modeling_detachment', ...request },
        },
        path: { workspace_id: workspaceId, tab_id: tabId },
        throwOnError: true,
      }).then(({ data }) => data),
    onSuccess: (_data, variables) => {
      invalidateWorkspaceGraphQuery(queryClient, variables.workspaceId);
    },
  });
  const publishResultMutation = useMutation({
    mutationKey: ['workspace', 'publish-analysis-result'],
    mutationFn: ({
      workspaceId,
      tabId,
      analysisId,
      request,
    }: {
      workspaceId: string;
      tabId: string;
      analysisId: string;
      request: ResultPublicationRequest;
    }) =>
      submitTabAnalysis({
        body: {
          execution_scope: 'supporting',
          parent_analysis_id: analysisId,
          request,
        },
        path: { workspace_id: workspaceId, tab_id: tabId },
        throwOnError: true,
      }).then(({ data }) => data),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceAnalyses(variables.workspaceId),
      });
    },
  });

  return {
    actions: {
      runConcordanceAll: (
        tabId: string,
        request: Omit<ConcordanceRunAllAnalysisRequest, 'kind'>,
        supersedesAnalysisIds: string[] = [],
      ) =>
        runConcordanceAllMutation.mutateAsync({
          workspaceId: ensureWorkspaceSelected(),
          tabId,
          request,
          supersedesAnalysisIds,
        }),
      runQuotationAll: (
        tabId: string,
        request: Omit<QuotationRunAllAnalysisRequest, 'kind'>,
        supersedesAnalysisIds: string[] = [],
      ) =>
        runQuotationAllMutation.mutateAsync({
          workspaceId: ensureWorkspaceSelected(),
          tabId,
          request,
          supersedesAnalysisIds,
        }),
      detachTopicModeling: (
        tabId: string,
        analysisId: string,
        request: Omit<TopicModelingDetachmentAnalysisRequest, 'kind'>,
      ) =>
        detachTopicModelingMutation.mutateAsync({
          workspaceId: ensureWorkspaceSelected(),
          tabId,
          analysisId,
          request,
        }),
      publishAnalysisResult: (
        tabId: string,
        analysisId: string,
        request: ResultPublicationRequest,
      ) =>
        publishResultMutation.mutateAsync({
          workspaceId: ensureWorkspaceSelected(),
          tabId,
          analysisId,
          request,
        }),
    },
  } as const;
};
