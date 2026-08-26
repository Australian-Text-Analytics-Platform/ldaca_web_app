import {
  listAnnotationModels,
  listFeaturedDataPortalCollections,
  queryAnalysisResult,
  searchDataPortal,
  submitDataPortalImport,
  submitTabAnalysis,
} from '@/api';
import type {
  AnnotationAnalysisRequest,
  AnnotationProviderConfigurationResource,
  AnnotationResultQueryWritable,
  AnnotationRunAllSubmissionWritable,
  AnalysisExecutionScope,
  ConcordanceAnalysisRequest,
  DataPortalImportSubmitRequest,
  DataPortalSearchRequest,
  QuotationAnalysisRequest,
  SequentialAnalysisRequest,
  SubmitTabAnalysisData,
  TokenFrequencyAnalysisRequest,
  TopicModelingAnalysisRequest,
} from '@/api';
import { useAuthStore } from '@/stores/authStore';
import {
  getBrowserAnnotationProviderCredential,
  getBrowserDataPortalCredential,
} from './providerCredentialsStore';

export type SecretFreeAnalysisSubmission =
  | ({ kind: 'token_frequency' } & TokenFrequencyAnalysisRequest)
  | ({ kind: 'topic_modeling' } & TopicModelingAnalysisRequest)
  | ({ kind: 'concordance' } & ConcordanceAnalysisRequest)
  | ({ kind: 'quotation' } & QuotationAnalysisRequest)
  | ({ kind: 'sequential' } & SequentialAnalysisRequest)
  | ({ kind: 'annotation' } & AnnotationAnalysisRequest);

const currentMultiUserId = (): string | null => {
  const session = useAuthStore.getState().session;
  if (session?.mode !== 'multi_user' || !session.authenticated || !session.user) return null;
  return session.user.id;
};

const annotationCredential = (configurationId: string): string | undefined => {
  const userId = currentMultiUserId();
  return getBrowserAnnotationProviderCredential(userId, configurationId);
};

const dataPortalCredential = (): string | undefined => {
  const userId = currentMultiUserId();
  return getBrowserDataPortalCredential(userId);
};

export const listAnnotationModelsWithProviderCredential = (
  configuration: Pick<AnnotationProviderConfigurationResource, 'id' | 'provider' | 'base_url'>,
  signal?: AbortSignal,
) => {
  const apiKey = annotationCredential(configuration.id);
  return listAnnotationModels({
    body: {
      provider_configuration_id: configuration.id,
      provider: configuration.provider,
      provider_base_url: configuration.base_url ?? null,
      ...(apiKey ? { api_key: apiKey } : {}),
    },
    signal,
    throwOnError: true,
  });
};

export const queryAnnotationPreviewWithProviderCredential = ({
  workspaceId,
  analysisId,
  providerConfigurationId,
  page,
  pageSize,
  signal,
}: {
  workspaceId: string;
  analysisId: string;
  providerConfigurationId: string;
  page: number;
  pageSize: number;
  signal?: AbortSignal;
}) => {
  const apiKey = annotationCredential(providerConfigurationId);
  const body: AnnotationResultQueryWritable & { kind: 'annotation' } = {
    kind: 'annotation',
    page,
    page_size: pageSize,
    ...(apiKey ? { api_key: apiKey } : {}),
  };
  return queryAnalysisResult({
    headers: { 'x-client-timeout-ms': '120000' },
    path: { workspace_id: workspaceId, analysis_id: analysisId },
    body,
    signal,
    throwOnError: true,
  });
};

export const submitAnnotationRunAllWithProviderCredential = ({
  workspaceId,
  tabId,
  providerConfigurationId,
  source,
  batchSize,
  processingMode,
}: {
  workspaceId: string;
  tabId: string;
  providerConfigurationId: string;
  source: AnnotationAnalysisRequest;
  batchSize: number;
  processingMode: 'reprocess_all' | 'fill_missing';
}) => {
  const apiKey = annotationCredential(providerConfigurationId);
  const body: AnnotationRunAllSubmissionWritable & { kind: 'annotation_run_all' } = {
    kind: 'annotation_run_all',
    source,
    batch_size: batchSize,
    processing_mode: processingMode,
    ...(apiKey ? { api_key: apiKey } : {}),
  };
  return submitTabAnalysis({
    headers: { 'x-client-timeout-ms': '120000' },
    path: { workspace_id: workspaceId, tab_id: tabId },
    body: {
      execution_scope: 'run_all',
      request: body,
      supersedes_analysis_ids: [],
    },
    throwOnError: true,
  });
};

export const submitTabAnalysisWithProviderCredential = ({
  workspaceId,
  tabId,
  request,
  executionScope = 'preview',
  parentAnalysisId,
  supersedesAnalysisIds = [],
}: {
  workspaceId: string;
  tabId: string;
  request: SecretFreeAnalysisSubmission;
  executionScope?: AnalysisExecutionScope;
  parentAnalysisId?: string | null;
  supersedesAnalysisIds?: string[];
}) => {
  const apiKey =
    request.kind === 'annotation'
      ? annotationCredential(request.provider_configuration_id)
      : undefined;
  const submittedRequest: SubmitTabAnalysisData['body']['request'] =
    request.kind === 'annotation' && apiKey ? { ...request, api_key: apiKey } : request;
  const body: SubmitTabAnalysisData['body'] = {
    execution_scope: executionScope,
    request: submittedRequest,
    parent_analysis_id: parentAnalysisId ?? null,
    supersedes_analysis_ids: supersedesAnalysisIds,
  };
  return submitTabAnalysis({
    body,
    path: { workspace_id: workspaceId, tab_id: tabId },
    throwOnError: true,
  });
};

export const listFeaturedDataPortalCollectionsWithProviderCredential = () => {
  const apiToken = dataPortalCredential();
  return listFeaturedDataPortalCollections({
    body: apiToken ? { api_token: apiToken } : {},
    throwOnError: true,
  });
};

export const searchDataPortalWithProviderCredential = (request: DataPortalSearchRequest) => {
  const apiToken = dataPortalCredential();
  return searchDataPortal({
    body: apiToken ? { ...request, api_token: apiToken } : request,
    throwOnError: true,
  });
};

export const submitDataPortalImportWithProviderCredential = (
  request: DataPortalImportSubmitRequest,
) => {
  const apiToken = dataPortalCredential();
  return submitDataPortalImport({
    body: apiToken ? { ...request, api_token: apiToken } : request,
    throwOnError: true,
  });
};
