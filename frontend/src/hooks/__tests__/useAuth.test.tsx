import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { AuthInfoResponse } from '@/types';
import type { ConfigResponse } from '@/api/config';

// ---------- API mocks (hoisted so the module-load URL-token capture path
// in useAuth doesn't try to hit the real network during import) ----------

const authApiMock = vi.hoisted(() => ({
  info: vi.fn<(...args: unknown[]) => Promise<AuthInfoResponse>>(),
  googleAuth: vi.fn<(...args: unknown[]) => Promise<{ access_token: string }>>(),
  logout: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

const configApiMock = vi.hoisted(() => ({
  getConfig: vi.fn<() => Promise<ConfigResponse>>(),
}));

vi.mock('@/api/auth', () => ({ authApi: authApiMock }));
vi.mock('@/api/config', () => ({ configApi: configApiMock }));

const buildAuthInfo = (overrides: Partial<AuthInfoResponse> = {}): AuthInfoResponse => ({
  authenticated: true,
  user: { id: 'u-1', email: 'u@example.com', name: 'User' },
  available_auth_methods: ['google'],
  requires_authentication: true,
  ...overrides,
});

const buildConfig = (overrides: Partial<ConfigResponse> = {}): ConfigResponse => ({
  multi_user_mode: true,
  ...overrides,
} as ConfigResponse);

// Each test wants a clean module instance because useAuth keeps every piece of
// state in module-level globals (`globalAuthInfo`, `globalConfig`, `globalPhase`,
// `inFlight`, etc.). `vi.resetModules()` between tests gives us a fresh slate.
const importUseAuth = async () => {
  const mod = await import('../useAuth');
  return mod;
};

describe('useAuth', () => {
  beforeEach(() => {
    vi.resetModules();
    authApiMock.info.mockReset();
    authApiMock.googleAuth.mockReset();
    authApiMock.logout.mockReset();
    configApiMock.getConfig.mockReset();
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('bootstraps to "ready" with user info when autoStart is true and the API resolves', async () => {
    const info = buildAuthInfo();
    const config = buildConfig();
    authApiMock.info.mockResolvedValue(info);
    configApiMock.getConfig.mockResolvedValue(config);

    const { useAuth } = await importUseAuth();

    const { result } = renderHook(() => useAuth({ autoStart: true }));

    await waitFor(() => {
      expect(result.current.phase.status).toBe('ready');
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(info.user);
    expect(result.current.isMultiUserMode).toBe(true);
    expect(result.current.requiresAuthentication).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(authApiMock.info).toHaveBeenCalledTimes(1);
    expect(configApiMock.getConfig).toHaveBeenCalledTimes(1);
  });

  it('surfaces a bootstrap failure as phase=bootstrapping with an error message', async () => {
    authApiMock.info.mockRejectedValue(new Error('boom'));
    configApiMock.getConfig.mockResolvedValue(buildConfig());

    const { useAuth } = await importUseAuth();
    const { result } = renderHook(() => useAuth({ autoStart: true }));

    await waitFor(() => {
      expect(result.current.phase.status).toBe('bootstrapping');
      const phase = result.current.phase as { status: 'bootstrapping'; error?: string };
      expect(phase.error).toBe('boom');
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).toBe('boom');
  });

  it('does not bootstrap when autoStart=false; refreshAuth triggers it on demand', async () => {
    authApiMock.info.mockResolvedValue(buildAuthInfo());
    configApiMock.getConfig.mockResolvedValue(buildConfig());

    const { useAuth } = await importUseAuth();
    const { result } = renderHook(() => useAuth({ autoStart: false }));

    // Brief tick to let any "should not run" effects settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(authApiMock.info).not.toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);

    await act(async () => {
      await result.current.refreshAuth();
    });

    expect(authApiMock.info).toHaveBeenCalledTimes(1);
    expect(result.current.phase.status).toBe('ready');
  });

  describe('getAuthHeaders', () => {
    it('returns Authorization Bearer when a token is in localStorage and auth is required', async () => {
      window.localStorage.setItem('auth_token', 'tok-123');
      authApiMock.info.mockResolvedValue(buildAuthInfo({ requires_authentication: true }));
      configApiMock.getConfig.mockResolvedValue(buildConfig());

      const { useAuth } = await importUseAuth();
      const { result } = renderHook(() => useAuth({ autoStart: true }));

      await waitFor(() => expect(result.current.phase.status).toBe('ready'));

      expect(result.current.getAuthHeaders()).toEqual({ Authorization: 'Bearer tok-123' });
    });

    it('returns {} when no token is stored', async () => {
      authApiMock.info.mockResolvedValue(buildAuthInfo({ requires_authentication: true }));
      configApiMock.getConfig.mockResolvedValue(buildConfig());

      const { useAuth } = await importUseAuth();
      const { result } = renderHook(() => useAuth({ autoStart: true }));

      await waitFor(() => expect(result.current.phase.status).toBe('ready'));
      expect(result.current.getAuthHeaders()).toEqual({});
    });

    it('returns {} when auth is not required even if a token is stored', async () => {
      window.localStorage.setItem('auth_token', 'tok-X');
      authApiMock.info.mockResolvedValue(buildAuthInfo({ requires_authentication: false }));
      configApiMock.getConfig.mockResolvedValue(buildConfig());

      const { useAuth } = await importUseAuth();
      const { result } = renderHook(() => useAuth({ autoStart: true }));

      await waitFor(() => expect(result.current.phase.status).toBe('ready'));
      expect(result.current.getAuthHeaders()).toEqual({});
    });
  });

  describe('logout', () => {
    it('calls authApi.logout with the current bearer headers, clears the token, and refetches', async () => {
      window.localStorage.setItem('auth_token', 'tok-9');
      authApiMock.info.mockResolvedValue(buildAuthInfo());
      configApiMock.getConfig.mockResolvedValue(buildConfig({ multi_user_mode: true }));
      (authApiMock.logout as Mock).mockResolvedValue(undefined);

      const { useAuth } = await importUseAuth();
      const { result } = renderHook(() => useAuth({ autoStart: true }));
      await waitFor(() => expect(result.current.phase.status).toBe('ready'));

      // The authApi.info call after logout returns an unauthenticated payload.
      authApiMock.info.mockResolvedValueOnce(
        buildAuthInfo({ authenticated: false, user: null }),
      );

      await act(async () => {
        await result.current.logout();
      });

      expect(authApiMock.logout).toHaveBeenCalledWith({ Authorization: 'Bearer tok-9' });
      expect(window.localStorage.getItem('auth_token')).toBeNull();
      expect(authApiMock.info).toHaveBeenCalledTimes(2);
    });

    it('is a no-op in single-user mode', async () => {
      authApiMock.info.mockResolvedValue(buildAuthInfo({ requires_authentication: false }));
      configApiMock.getConfig.mockResolvedValue(buildConfig({ multi_user_mode: false }));

      const { useAuth } = await importUseAuth();
      const { result } = renderHook(() => useAuth({ autoStart: true }));
      await waitFor(() => expect(result.current.phase.status).toBe('ready'));

      await act(async () => {
        await result.current.logout();
      });

      expect(authApiMock.logout).not.toHaveBeenCalled();
    });
  });

  describe('loginWithGoogle', () => {
    it('rejects in single-user mode', async () => {
      authApiMock.info.mockResolvedValue(buildAuthInfo({ requires_authentication: false }));
      configApiMock.getConfig.mockResolvedValue(buildConfig({ multi_user_mode: false }));

      const { useAuth } = await importUseAuth();
      const { result } = renderHook(() => useAuth({ autoStart: true }));
      await waitFor(() => expect(result.current.phase.status).toBe('ready'));

      await expect(result.current.loginWithGoogle('id-token')).rejects.toThrow(
        /Google login not available/,
      );
      expect(authApiMock.googleAuth).not.toHaveBeenCalled();
    });

    it('persists the access_token and triggers a re-bootstrap on success', async () => {
      authApiMock.info.mockResolvedValue(buildAuthInfo({ authenticated: false, user: null }));
      configApiMock.getConfig.mockResolvedValue(buildConfig({ multi_user_mode: true }));
      (authApiMock.googleAuth as Mock).mockResolvedValue({ access_token: 'gtok-abc' });

      const { useAuth } = await importUseAuth();
      const { result } = renderHook(() => useAuth({ autoStart: true }));
      await waitFor(() => expect(authApiMock.info).toHaveBeenCalledTimes(1));

      // Post-login the second info call returns an authenticated payload.
      authApiMock.info.mockResolvedValueOnce(buildAuthInfo({ authenticated: true }));

      await act(async () => {
        await result.current.loginWithGoogle('google-id-token');
      });

      expect(authApiMock.googleAuth).toHaveBeenCalledWith('google-id-token');
      expect(window.localStorage.getItem('auth_token')).toBe('gtok-abc');
      expect(authApiMock.info).toHaveBeenCalledTimes(2);
    });
  });
});
