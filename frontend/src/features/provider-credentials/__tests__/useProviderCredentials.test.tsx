import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProviderCredentials } from '../useProviderCredentials';
import {
  getBrowserProviderCredential,
  useProviderCredentialsStore,
} from '../providerCredentialsStore';

const mocks = vi.hoisted(() => ({
  auth: {
    isAuthenticated: true,
    isMultiUserMode: true,
    user: { id: 'user-a' },
  },
  getProviderCredentials: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => mocks.auth,
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getProviderCredentials: mocks.getProviderCredentials,
  updateProviderCredentials: mocks.updateProviderCredentials,
}));

const browserSummary = {
  storage: 'browser' as const,
  annotation: null,
  data_portal: { user_configured: null, deployment_configured: true },
};

const backendSummary = {
  storage: 'backend' as const,
  annotation: { openai: false, openrouter: false, anthropic: false, google: false },
  data_portal: { user_configured: false, deployment_configured: false },
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
    mocks.updateProviderCredentials.mockResolvedValue({ data: backendSummary });
  });

  it('uses per-user browser storage in multi-user mode without mutation-cache secrets', async () => {
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current.storage).toBe('browser'));

    await act(() => result.current.saveAnnotationCredential('openai', ' browser-secret '));
    expect(getBrowserProviderCredential('user-a', 'openai')).toBe('browser-secret');
    expect(result.current.annotation.openai).toBe(true);
    expect(mocks.updateProviderCredentials).not.toHaveBeenCalled();
    expect(queryClient.getMutationCache().getAll()).toEqual([]);

    await act(() => result.current.clearAnnotationCredential('openai'));
    expect(getBrowserProviderCredential('user-a', 'openai')).toBeUndefined();
  });

  it('uses backend write-only mutations in single-user mode and creates no browser entry', async () => {
    Object.assign(mocks.auth, {
      isAuthenticated: true,
      isMultiUserMode: false,
      user: { id: 'root' },
    });
    mocks.getProviderCredentials.mockResolvedValue({ data: backendSummary });
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current.storage).toBe('backend'));

    await act(() => result.current.saveDataPortalCredential(' root-token '));

    expect(mocks.updateProviderCredentials).toHaveBeenCalledWith({
      body: { data_portal_api_token: 'root-token' },
      throwOnError: true,
    });
    expect(useProviderCredentialsStore.getState().byUser).toEqual({});
    expect(queryClient.getMutationCache().getAll()).toEqual([]);
  });

  it('retains a multi-user credential when the facade unmounts for logout', async () => {
    const { result, unmount } = setup();
    await act(() => result.current.saveAnnotationCredential('google', 'retained-secret'));

    unmount();

    expect(getBrowserProviderCredential('user-a', 'google')).toBe('retained-secret');
  });
});
