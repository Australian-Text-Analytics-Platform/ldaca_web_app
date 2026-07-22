import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnnotationAnalysisRequest, AnnotationPreviewRequest, SessionResponse } from '@/api';
import { useAuthStore } from '@/stores/authStore';
import {
  listAnnotationModelsWithProviderCredential,
  listFeaturedDataPortalCollectionsWithProviderCredential,
  previewAnnotationWithProviderCredential,
  searchDataPortalWithProviderCredential,
  submitDataPortalImportWithProviderCredential,
  submitTabAnalysisWithProviderCredential,
} from '../providerCredentialRequests';
import { useProviderCredentialsStore } from '../providerCredentialsStore';

const sdk = vi.hoisted(() => ({
  listAnnotationModels: vi.fn(),
  listFeaturedDataPortalCollections: vi.fn(),
  previewAnnotation: vi.fn(),
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
    const previewRequest: AnnotationPreviewRequest = {
      text_column: 'text',
      annotation_column: 'class',
      classes: [{ name: 'Relevant', description: '' }],
      provider_configuration_id: configuration.id,
      provider: configuration.provider,
      provider_base_url: configuration.base_url,
      model: 'model',
      instruction: 'Classify',
    };
    const analysisRequest: AnnotationAnalysisRequest = {
      kind: 'annotation',
      node_id: '00000000-0000-0000-0000-000000000001',
      ...previewRequest,
      output_node_name: 'Annotated',
    };

    await listAnnotationModelsWithProviderCredential(configuration);
    await previewAnnotationWithProviderCredential({
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      request: previewRequest,
    });
    await submitTabAnalysisWithProviderCredential({
      workspaceId: 'workspace-1',
      tabId: 'tab-1',
      request: analysisRequest,
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
    expect(sdk.previewAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ body: { ...previewRequest, api_key: 'annotation-secret' } }),
    );
    expect(sdk.submitTabAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ body: { ...analysisRequest, api_key: 'annotation-secret' } }),
    );
    expect(sdk.listFeaturedDataPortalCollections).toHaveBeenCalledWith(
      expect.objectContaining({ body: { api_token: 'portal-secret' } }),
    );
    expect(previewRequest).not.toHaveProperty('api_key');
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
