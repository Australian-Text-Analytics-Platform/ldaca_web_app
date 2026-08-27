import { type QueryClient, useMutation } from '@tanstack/react-query';
import { submitTabAnalysis } from '@/api';
import type {
  ConcordanceRunAllAnalysisRequest,
  ConcordanceDocumentDataBlockCreationAnalysisRequest,
  ConcordanceMatchDataBlockCreationAnalysisRequest,
  QuotationResultDataBlockCreationAnalysisRequest,
  QuotationRunAllAnalysisRequest,
  SequentialDataBlockCreationAnalysisRequest,
  TopicModelingDataBlockCreationAnalysisRequest,
} from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateWorkspaceGraphQuery } from './workspaceMutationCache';

interface WorkspaceAnalysisMutationsParams {
  currentWorkspaceId: string | null;
  queryClient: QueryClient;
}

type DataBlockCreationRequest =
  | ({
      kind: 'concordance_match_data_block_creation';
    } & ConcordanceMatchDataBlockCreationAnalysisRequest)
  | ({
      kind: 'concordance_document_data_block_creation';
    } & ConcordanceDocumentDataBlockCreationAnalysisRequest)
  | ({
      kind: 'quotation_result_data_block_creation';
    } & QuotationResultDataBlockCreationAnalysisRequest)
  | ({
      kind: 'sequential_data_block_creation';
    } & SequentialDataBlockCreationAnalysisRequest);

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
  const createTopicModelingDataBlocksMutation = useMutation({
    mutationKey: ['workspace', 'create-topic-modeling-data-blocks'],
    mutationFn: ({
      workspaceId,
      tabId,
      analysisId,
      request,
    }: {
      workspaceId: string;
      tabId: string;
      analysisId: string;
      request: Omit<TopicModelingDataBlockCreationAnalysisRequest, 'kind'>;
    }) =>
      submitTabAnalysis({
        body: {
          execution_scope: 'supporting',
          parent_analysis_id: analysisId,
          request: { kind: 'topic_modeling_data_block_creation', ...request },
        },
        path: { workspace_id: workspaceId, tab_id: tabId },
        throwOnError: true,
      }).then(({ data }) => data),
    onSuccess: (_data, variables) => {
      invalidateWorkspaceGraphQuery(queryClient, variables.workspaceId);
    },
  });
  const createResultDataBlocksMutation = useMutation({
    mutationKey: ['workspace', 'create-result-data-blocks'],
    mutationFn: ({
      workspaceId,
      tabId,
      analysisId,
      request,
    }: {
      workspaceId: string;
      tabId: string;
      analysisId: string;
      request: DataBlockCreationRequest;
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
      createTopicModelingDataBlocks: (
        tabId: string,
        analysisId: string,
        request: Omit<TopicModelingDataBlockCreationAnalysisRequest, 'kind'>,
      ) =>
        createTopicModelingDataBlocksMutation.mutateAsync({
          workspaceId: ensureWorkspaceSelected(),
          tabId,
          analysisId,
          request,
        }),
      createResultDataBlocks: (
        tabId: string,
        analysisId: string,
        request: DataBlockCreationRequest,
      ) =>
        createResultDataBlocksMutation.mutateAsync({
          workspaceId: ensureWorkspaceSelected(),
          tabId,
          analysisId,
          request,
        }),
    },
  } as const;
};
