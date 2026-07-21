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

const previewRequest: AnnotationPreviewRequest = {
  text_column: 'text',
  annotation_column: 'class',
  classes: [{ name: 'Relevant', description: '' }],
  provider: 'openai',
  model: 'model',
  instruction: 'Classify',
};

const analysisRequest: AnnotationAnalysisRequest = {
  kind: 'annotation',
  node_id: '00000000-0000-0000-0000-000000000001',
  text_column: 'text',
  annotation_column: 'class',
  classes: [{ name: 'Relevant', description: '' }],
  provider: 'openai',
  model: 'model',
  instruction: 'Classify',
  output_node_name: 'Annotated',
};

describe('provider credential request boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useProviderCredentialsStore.setState({ byUser: {} });
    Object.values(sdk).forEach((mock) => mock.mockResolvedValue({ data: {} }));
  });

  it('injects the authenticated multi-user secrets only inside provider calls', async () => {
    setSession(session('multi_user'));
    const credentials = useProviderCredentialsStore.getState();
    credentials.setCredential('user-a', 'openai', 'annotation-secret');
    credentials.setCredential('user-a', 'dataPortal', 'portal-secret');

    await listAnnotationModelsWithProviderCredential('openai');
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
      expect.objectContaining({ body: { api_key: 'annotation-secret' } }),
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
    expect(sdk.searchDataPortal).toHaveBeenCalledWith(
      expect.objectContaining({ body: { query: 'speech', api_token: 'portal-secret' } }),
    );
    expect(sdk.submitDataPortalImport).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { identifier: 'arcp://name,corpus', api_token: 'portal-secret' },
      }),
    );
    expect(previewRequest).not.toHaveProperty('api_key');
    expect(analysisRequest).not.toHaveProperty('api_key');
  });

  it('ignores browser entries in single-user mode and never creates one', async () => {
    setSession(session('single_user', 'root'));
    useProviderCredentialsStore.getState().setCredential('root', 'openai', 'must-not-send');

    await listAnnotationModelsWithProviderCredential('openai');
    await listFeaturedDataPortalCollectionsWithProviderCredential();

    expect(sdk.listAnnotationModels).toHaveBeenCalledWith(expect.objectContaining({ body: {} }));
    expect(sdk.listFeaturedDataPortalCollections).toHaveBeenCalledWith(
      expect.objectContaining({ body: {} }),
    );
    expect(Object.keys(useProviderCredentialsStore.getState().byUser)).toEqual(['root']);
  });

  it('partitions request resolution by the currently authenticated account', async () => {
    const credentials = useProviderCredentialsStore.getState();
    credentials.setCredential('user-a', 'openai', 'user-a-secret');
    credentials.setCredential('user-b', 'openai', 'user-b-secret');
    setSession(session('multi_user', 'user-b'));

    await listAnnotationModelsWithProviderCredential('openai');

    expect(sdk.listAnnotationModels).toHaveBeenCalledWith(
      expect.objectContaining({ body: { api_key: 'user-b-secret' } }),
    );
  });
});
