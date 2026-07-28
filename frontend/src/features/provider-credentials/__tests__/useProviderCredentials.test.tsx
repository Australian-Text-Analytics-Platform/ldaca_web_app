import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProviderCredentials } from '../useProviderCredentials';
import {
  getBrowserAnnotationProviderCredential,
  providerCredentialPresence,
  useProviderCredentialsStore,
} from '../providerCredentialsStore';

const CONFIGURATION_ID = '74a93227-c081-4db9-af2e-ad357b62278d';
const mocks = vi.hoisted(() => ({
  auth: {
    isAuthenticated: true,
    isMultiUserMode: true,
    user: { id: 'user-a' },
  },
  clearAnnotationProviderConfigurations: vi.fn(),
  createAnnotationProviderConfiguration: vi.fn(),
  deleteAnnotationProviderConfiguration: vi.fn(),
  getProviderCredentials: vi.fn(),
  renameAnnotationProviderConfiguration: vi.fn(),
  updateDataPortalCredential: vi.fn(),
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => mocks.auth,
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  clearAnnotationProviderConfigurations: mocks.clearAnnotationProviderConfigurations,
  createAnnotationProviderConfiguration: mocks.createAnnotationProviderConfiguration,
  deleteAnnotationProviderConfiguration: mocks.deleteAnnotationProviderConfiguration,
  getProviderCredentials: mocks.getProviderCredentials,
  renameAnnotationProviderConfiguration: mocks.renameAnnotationProviderConfiguration,
  updateDataPortalCredential: mocks.updateDataPortalCredential,
}));

const browserSummary = {
  storage: 'browser' as const,
  annotation_providers: null,
  data_portal: { user_configured: null, deployment_configured: true },
};

const backendSummary = {
  storage: 'backend' as const,
  annotation_providers: [],
  data_portal: { user_configured: false, deployment_configured: false },
};

const backendConfiguration = {
  id: CONFIGURATION_ID,
  name: 'OpenRouter personal',
  provider: 'openrouter' as const,
  base_url: null,
  has_api_key: true,
};

const setup = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(() => useProviderCredentials(), { wrapper }) };
};

describe('useProviderCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useProviderCredentialsStore.setState({ byUser: {} });
    Object.assign(mocks.auth, {
      isAuthenticated: true,
      isMultiUserMode: true,
      user: { id: 'user-a' },
    });
    mocks.getProviderCredentials.mockResolvedValue({ data: browserSummary });
    mocks.createAnnotationProviderConfiguration.mockResolvedValue({
      data: backendConfiguration,
    });
    mocks.renameAnnotationProviderConfiguration.mockResolvedValue({
      data: { ...backendConfiguration, name: 'Renamed' },
    });
    mocks.deleteAnnotationProviderConfiguration.mockResolvedValue({ data: undefined });
    mocks.clearAnnotationProviderConfigurations.mockResolvedValue({ data: undefined });
    mocks.updateDataPortalCredential.mockResolvedValue({ data: backendSummary });
  });

  it('uses ordered per-user browser configurations without mutation-cache secrets', async () => {
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current.storage).toBe('browser'));

    let createdId = '';
    await act(async () => {
      createdId = (
        await result.current.addAnnotationProvider({
          name: 'OpenRouter personal',
          provider: 'openrouter',
          apiKey: 'browser-secret',
        })
      ).id;
    });

    expect(getBrowserAnnotationProviderCredential('user-a', createdId)).toBe('browser-secret');
    expect(result.current.annotationProviders).toHaveLength(1);
    expect(mocks.createAnnotationProviderConfiguration).not.toHaveBeenCalled();
    expect(queryClient.getMutationCache().getAll()).toEqual([]);

    await act(() => result.current.deleteAnnotationProvider(createdId));
    expect(providerCredentialPresence('user-a').annotationProviders).toEqual([]);
  });

  it('uses generated single-user CRUD and keeps Query state secret-free', async () => {
    Object.assign(mocks.auth, {
      isAuthenticated: true,
      isMultiUserMode: false,
      user: { id: 'root' },
    });
    mocks.getProviderCredentials.mockResolvedValue({ data: backendSummary });
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current.storage).toBe('backend'));

    await act(() =>
      result.current.addAnnotationProvider({
        name: 'OpenRouter personal',
        provider: 'openrouter',
        apiKey: 'backend-secret',
      }),
    );

    expect(mocks.createAnnotationProviderConfiguration).toHaveBeenCalledWith({
      body: {
        name: 'OpenRouter personal',
        provider: 'openrouter',
        api_key: 'backend-secret',
      },
      throwOnError: true,
    });
    await waitFor(() =>
      expect(result.current.annotationProviders[0]).toMatchObject(backendConfiguration),
    );
    expect(JSON.stringify(queryClient.getQueryData(['provider-credentials']))).not.toContain(
      'backend-secret',
    );
    expect(queryClient.getMutationCache().getAll()).toEqual([]);
    expect(useProviderCredentialsStore.getState().byUser).toEqual({});

    await act(() => result.current.renameAnnotationProvider(CONFIGURATION_ID, 'Renamed'));
    await waitFor(() => expect(result.current.annotationProviders[0]?.name).toBe('Renamed'));
    await act(() => result.current.deleteAnnotationProvider(CONFIGURATION_ID));
    await waitFor(() => expect(result.current.annotationProviders).toEqual([]));
  });

  it('retains browser configurations when the facade unmounts for logout', async () => {
    const { result, unmount } = setup();
    let createdId = '';
    await act(async () => {
      createdId = (
        await result.current.addAnnotationProvider({
          name: 'Google',
          provider: 'google',
          apiKey: 'retained-secret',
        })
      ).id;
    });

    unmount();

    expect(getBrowserAnnotationProviderCredential('user-a', createdId)).toBe('retained-secret');
  });

  it('keeps Data Portal credential operations on their existing mode boundary', async () => {
    Object.assign(mocks.auth, {
      isAuthenticated: true,
      isMultiUserMode: false,
      user: { id: 'root' },
    });
    mocks.getProviderCredentials.mockResolvedValue({ data: backendSummary });
    const { result } = setup();
    await waitFor(() => expect(result.current.storage).toBe('backend'));

    await act(() => result.current.saveDataPortalCredential(' root-token '));

    expect(mocks.updateDataPortalCredential).toHaveBeenCalledWith({
      body: { data_portal_api_token: 'root-token' },
      throwOnError: true,
    });
  });
});
