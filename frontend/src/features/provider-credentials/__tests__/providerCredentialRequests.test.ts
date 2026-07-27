import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnnotationAnalysisRequest, SessionResponse } from '@/api';
import { useAuthStore } from '@/stores/authStore';
import {
  listAnnotationModelsWithProviderCredential,
  listFeaturedDataPortalCollectionsWithProviderCredential,
  queryAnnotationPreviewWithProviderCredential,
  searchDataPortalWithProviderCredential,
  submitAnnotationRunAllWithProviderCredential,
  submitDataPortalImportWithProviderCredential,
  submitTabAnalysisWithProviderCredential,
} from '../providerCredentialRequests';
import { useProviderCredentialsStore } from '../providerCredentialsStore';

const sdk = vi.hoisted(() => ({
  listAnnotationModels: vi.fn(),
  listFeaturedDataPortalCollections: vi.fn(),
  queryAnalysisResult: vi.fn(),
  searchDataPortal: vi.fn(),
  submitDataPortalImport: vi.fn(),
  submitTabAnalysis: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  ...sdk,
}));

const session = (mode: SessionResponse['mode'], userId = 'user-a'): SessionResponse => ({
  mode,
  authenticated: true,
  user: {
    id: userId,
    email: `${userId}@example.test`,
    name: userId,
    picture: null,
  },
  providers: [],
  csrf_token: 'csrf',
});

const setSession = (value: SessionResponse) => {
  useAuthStore.setState({ session: value, phase: { status: 'ready', info: value } });
};

describe('provider credential request boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useProviderCredentialsStore.setState({ byUser: {} });
    Object.values(sdk).forEach((mock) => mock.mockResolvedValue({ data: {} }));
  });

  it('injects the selected configuration secret only inside multi-user provider calls', async () => {
    setSession(session('multi_user'));
    const credentials = useProviderCredentialsStore.getState();
    const configuration = credentials.addAnnotationProvider('user-a', {
      name: 'OpenAI personal',
      provider: 'openai',
      apiKey: 'annotation-secret',
    });
    credentials.setDataPortalCredential('user-a', 'portal-secret');
    const analysisRequest: AnnotationAnalysisRequest = {
      kind: 'annotation',
      node_id: '00000000-0000-0000-0000-000000000001',
      text_column: 'text',
      annotation_column: 'class',
      class_node_id: '00000000-0000-0000-0000-000000000002',
      class_column: 'class',
      description_column: 'description',
      classes: [{ name: 'Relevant', description: '' }],
      provider_configuration_id: configuration.id,
      provider: configuration.provider,
      provider_base_url: configuration.base_url,
      model: 'model',
      instruction: 'Classify',
    };
    await listAnnotationModelsWithProviderCredential(configuration);
    await queryAnnotationPreviewWithProviderCredential({
      workspaceId: 'workspace-1',
      analysisId: 'analysis-1',
      providerConfigurationId: configuration.id,
      page: 1,
      pageSize: 20,
    });
    await submitTabAnalysisWithProviderCredential({
      workspaceId: 'workspace-1',
      tabId: 'tab-1',
      request: analysisRequest,
    });
    await submitAnnotationRunAllWithProviderCredential({
      workspaceId: 'workspace-1',
      tabId: 'tab-1',
      providerConfigurationId: configuration.id,
      source: analysisRequest,
      batchSize: 20,
      processingMode: 'reprocess_all',
    });
    await listFeaturedDataPortalCollectionsWithProviderCredential();
    await searchDataPortalWithProviderCredential({ query: 'speech' });
    await submitDataPortalImportWithProviderCredential({ identifier: 'arcp://name,corpus' });

    expect(sdk.listAnnotationModels).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          provider_configuration_id: configuration.id,
          provider: 'openai',
          provider_base_url: null,
          api_key: 'annotation-secret',
        },
      }),
    );
    expect(sdk.queryAnalysisResult).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          kind: 'annotation',
          page: 1,
          page_size: 20,
          api_key: 'annotation-secret',
        },
      }),
    );
    expect(sdk.submitTabAnalysis).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        body: {
          execution_scope: 'preview',
          request: { ...analysisRequest, api_key: 'annotation-secret' },
          parent_analysis_id: null,
          supersedes_analysis_ids: [],
        },
      }),
    );
    expect(sdk.submitTabAnalysis).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: {
          execution_scope: 'run_all',
          request: {
            kind: 'annotation_run_all',
            source: analysisRequest,
            batch_size: 20,
            processing_mode: 'reprocess_all',
            api_key: 'annotation-secret',
          },
          supersedes_analysis_ids: [],
        },
      }),
    );
    expect(sdk.listFeaturedDataPortalCollections).toHaveBeenCalledWith(
      expect.objectContaining({ body: { api_token: 'portal-secret' } }),
    );
    expect(analysisRequest).not.toHaveProperty('api_key');
  });

  it('sends safe configuration metadata but ignores browser secrets in single-user mode', async () => {
    setSession(session('single_user', 'root'));
    const browserConfiguration = useProviderCredentialsStore
      .getState()
      .addAnnotationProvider('root', {
        name: 'Must not send',
        provider: 'openai',
        apiKey: 'must-not-send',
      });

    await listAnnotationModelsWithProviderCredential(browserConfiguration);
    await listFeaturedDataPortalCollectionsWithProviderCredential();

    expect(sdk.listAnnotationModels).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          provider_configuration_id: browserConfiguration.id,
          provider: 'openai',
          provider_base_url: null,
        },
      }),
    );
    expect(sdk.listFeaturedDataPortalCollections).toHaveBeenCalledWith(
      expect.objectContaining({ body: {} }),
    );
  });

  it('resolves duplicate provider types by configuration UUID and current account', async () => {
    const credentials = useProviderCredentialsStore.getState();
    credentials.addAnnotationProvider('user-a', {
      name: 'OpenRouter A',
      provider: 'openrouter',
      apiKey: 'user-a-secret',
    });
    const selected = credentials.addAnnotationProvider('user-b', {
      name: 'OpenRouter B',
      provider: 'openrouter',
      apiKey: 'user-b-secret',
    });
    setSession(session('multi_user', 'user-b'));

    await listAnnotationModelsWithProviderCredential(selected);

    expect(sdk.listAnnotationModels).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ api_key: 'user-b-secret' }) }),
    );
  });
});
