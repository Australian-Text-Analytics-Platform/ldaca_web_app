import {
  listAnnotationModels,
  listFeaturedDataPortalCollections,
  previewAnnotation,
  searchDataPortal,
  submitDataPortalImport,
  submitTabAnalysis,
} from '@/api';
import type {
  AnnotationAnalysisRequest,
  AnnotationProviderConfigurationResource,
  AnnotationPreviewRequest,
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

export type SecretFreeRootAnalysisSubmission =
  | TokenFrequencyAnalysisRequest
  | TopicModelingAnalysisRequest
  | ConcordanceAnalysisRequest
  | QuotationAnalysisRequest
  | SequentialAnalysisRequest
  | AnnotationAnalysisRequest;

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
  configuration: AnnotationProviderConfigurationResource,
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

export const previewAnnotationWithProviderCredential = ({
  workspaceId,
  nodeId,
  request,
  signal,
}: {
  workspaceId: string;
  nodeId: string;
  request: AnnotationPreviewRequest;
  signal?: AbortSignal;
}) => {
  const apiKey = annotationCredential(request.provider_configuration_id);
  return previewAnnotation({
    headers: { 'x-client-timeout-ms': '120000' },
    path: { workspace_id: workspaceId, node_id: nodeId },
    body: apiKey ? { ...request, api_key: apiKey } : request,
    signal,
    throwOnError: true,
  });
};

export const submitTabAnalysisWithProviderCredential = ({
  workspaceId,
  tabId,
  request,
}: {
  workspaceId: string;
  tabId: string;
  request: SecretFreeRootAnalysisSubmission;
}) => {
  const apiKey =
    request.kind === 'annotation'
      ? annotationCredential(request.provider_configuration_id)
      : undefined;
  const body = request.kind === 'annotation' && apiKey ? { ...request, api_key: apiKey } : request;
  return submitTabAnalysis({
    body: body as SubmitTabAnalysisData['body'],
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
