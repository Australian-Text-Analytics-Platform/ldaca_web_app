import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { AuthInfoResponse, RuntimeConfigResponse } from '@/api';

// ---------- API mocks (hoisted so they're in place before the auth store
// imports the generated SDK; `runAuthFetch` would otherwise hit the network
// when the autoStart effect fires) ----------

const generatedApiMock = vi.hoisted(() => ({
  getAuthInfo: vi.fn<(...args: unknown[]) => Promise<{ data: AuthInfoResponse }>>(),
  getRuntimeConfig: vi.fn<() => Promise<{ data: RuntimeConfigResponse }>>(),
  googleAuth: vi.fn<(...args: unknown[]) => Promise<{ data: { access_token: string } }>>(),
  logout: vi.fn<(...args: unknown[]) => Promise<{ data: unknown }>>(),
}));

vi.mock('@/api/generated/sdk.gen', () => generatedApiMock);

/** Builds auth-info fixtures with backend defaults so each test overrides only its scenario. */
/** Used by: tests in this file. */
const buildAuthInfo = (overrides: Partial<AuthInfoResponse> = {}): AuthInfoResponse => ({
  authenticated: true,
  user: { id: 'u-1', email: 'u@example.com', name: 'User', picture: null },
  available_auth_methods: [{ name: 'google', display_name: 'Google', enabled: true }],
  requires_authentication: true,
  ...overrides,
});

/** Builds config fixtures for auth-mode tests without repeating generated response fields. */
/** Used by: tests in this file. */
const buildConfig = (overrides: Partial<RuntimeConfigResponse> = {}): RuntimeConfigResponse =>
  ({
    multi_user_mode: true,
    ...overrides,
  });

// Each test wants a clean module instance: the Zustand auth store is created
// at module load, plus a few imperative module-locals (`bootstrapAttempts`,
// `refreshFailures`, `inFlight`, `refreshIntervalId`) live alongside it.
// `vi.resetModules()` re-evaluates the store module → fresh store + fresh
// locals.
/** Imports the hook after mocks/resetModules so each test gets a fresh auth store instance. */
/** Used by: tests in this file. */
const importUseAuth = async () => {
  const mod = await import('../useAuth');
  return mod;
};

describe('useAuth', () => {
  beforeEach(() => {
    vi.resetModules();
    generatedApiMock.getAuthInfo.mockReset();
    generatedApiMock.getRuntimeConfig.mockReset();
    generatedApiMock.googleAuth.mockReset();
    generatedApiMock.logout.mockReset();
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('bootstraps to "ready" with user info when autoStart is true and the API resolves', async () => {
    const info = buildAuthInfo();
    const config = buildConfig();
    generatedApiMock.getAuthInfo.mockResolvedValue({ data: info });
    generatedApiMock.getRuntimeConfig.mockResolvedValue({ data: config });

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
    expect(generatedApiMock.getAuthInfo).toHaveBeenCalledTimes(1);
    expect(generatedApiMock.getRuntimeConfig).toHaveBeenCalledTimes(1);
  });

  it('surfaces a bootstrap failure as phase=bootstrapping with an error message', async () => {
    generatedApiMock.getAuthInfo.mockRejectedValue(new Error('boom'));
    generatedApiMock.getRuntimeConfig.mockResolvedValue({ data: buildConfig() });

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
    generatedApiMock.getAuthInfo.mockResolvedValue({ data: buildAuthInfo() });
    generatedApiMock.getRuntimeConfig.mockResolvedValue({ data: buildConfig() });

    const { useAuth } = await importUseAuth();
    const { result } = renderHook(() => useAuth({ autoStart: false }));

    // Brief tick to let any "should not run" effects settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(generatedApiMock.getAuthInfo).not.toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);

    await act(async () => {
      await result.current.refreshAuth();
    });

    expect(generatedApiMock.getAuthInfo).toHaveBeenCalledTimes(1);
    expect(result.current.phase.status).toBe('ready');
  });

  describe('getAuthHeaders', () => {
    it('returns Authorization Bearer when a token is in localStorage and auth is required', async () => {
      window.localStorage.setItem('auth_token', 'tok-123');
      generatedApiMock.getAuthInfo.mockResolvedValue({
        data: buildAuthInfo({ requires_authentication: true }),
      });
      generatedApiMock.getRuntimeConfig.mockResolvedValue({ data: buildConfig() });

      const { useAuth } = await importUseAuth();
      const { result } = renderHook(() => useAuth({ autoStart: true }));

      await waitFor(() => {
        expect(result.current.phase.status).toBe('ready');
      });

      expect(result.current.getAuthHeaders()).toEqual({ Authorization: 'Bearer tok-123' });
    });

    it('returns {} when no token is stored', async () => {
      generatedApiMock.getAuthInfo.mockResolvedValue({
        data: buildAuthInfo({ requires_authentication: true }),
      });
      generatedApiMock.getRuntimeConfig.mockResolvedValue({ data: buildConfig() });

      const { useAuth } = await importUseAuth();
      const { result } = renderHook(() => useAuth({ autoStart: true }));

      await waitFor(() => {
        expect(result.current.phase.status).toBe('ready');
      });
      expect(result.current.getAuthHeaders()).toEqual({});
    });

    it('returns {} when auth is not required even if a token is stored', async () => {
      window.localStorage.setItem('auth_token', 'tok-X');
      generatedApiMock.getAuthInfo.mockResolvedValue({
        data: buildAuthInfo({ requires_authentication: false }),
      });
      generatedApiMock.getRuntimeConfig.mockResolvedValue({ data: buildConfig() });

      const { useAuth } = await importUseAuth();
      const { result } = renderHook(() => useAuth({ autoStart: true }));

      await waitFor(() => {
        expect(result.current.phase.status).toBe('ready');
      });
      expect(result.current.getAuthHeaders()).toEqual({});
    });
  });

  describe('logout', () => {
    it('calls generated logout with the current bearer headers, clears the token, and refetches', async () => {
      window.localStorage.setItem('auth_token', 'tok-9');
      generatedApiMock.getAuthInfo.mockResolvedValue({ data: buildAuthInfo() });
      generatedApiMock.getRuntimeConfig.mockResolvedValue({
        data: buildConfig({ multi_user_mode: true }),
      });
      (generatedApiMock.logout as Mock).mockResolvedValue({ data: undefined });

      const { useAuth } = await importUseAuth();
      const { result } = renderHook(() => useAuth({ autoStart: true }));
      await waitFor(() => {
        expect(result.current.phase.status).toBe('ready');
      });

      // The getAuthInfo call after logout returns an unauthenticated payload.
      generatedApiMock.getAuthInfo.mockResolvedValueOnce({
        data: buildAuthInfo({ authenticated: false, user: null }),
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(generatedApiMock.logout).toHaveBeenCalledWith({
        headers: { Authorization: 'Bearer tok-9' },
        throwOnError: true,
      });
      expect(window.localStorage.getItem('auth_token')).toBeNull();
      expect(generatedApiMock.getAuthInfo).toHaveBeenCalledTimes(2);
    });

    it('is a no-op in single-user mode', async () => {
      generatedApiMock.getAuthInfo.mockResolvedValue({
        data: buildAuthInfo({ requires_authentication: false }),
      });
      generatedApiMock.getRuntimeConfig.mockResolvedValue({
        data: buildConfig({ multi_user_mode: false }),
      });

      const { useAuth } = await importUseAuth();
      const { result } = renderHook(() => useAuth({ autoStart: true }));
      await waitFor(() => {
        expect(result.current.phase.status).toBe('ready');
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(generatedApiMock.logout).not.toHaveBeenCalled();
    });
  });

  describe('loginWithGoogle', () => {
    it('rejects in single-user mode', async () => {
      generatedApiMock.getAuthInfo.mockResolvedValue({
        data: buildAuthInfo({ requires_authentication: false }),
      });
      generatedApiMock.getRuntimeConfig.mockResolvedValue({
        data: buildConfig({ multi_user_mode: false }),
      });

      const { useAuth } = await importUseAuth();
      const { result } = renderHook(() => useAuth({ autoStart: true }));
      await waitFor(() => {
        expect(result.current.phase.status).toBe('ready');
      });

      await expect(result.current.loginWithGoogle('id-token')).rejects.toThrow(
        /Google login not available/,
      );
      expect(generatedApiMock.googleAuth).not.toHaveBeenCalled();
    });

    it('persists the access_token and triggers a re-bootstrap on success', async () => {
      generatedApiMock.getAuthInfo.mockResolvedValue({
        data: buildAuthInfo({ authenticated: false, user: null }),
      });
      generatedApiMock.getRuntimeConfig.mockResolvedValue({
        data: buildConfig({ multi_user_mode: true }),
      });
      (generatedApiMock.googleAuth as Mock).mockResolvedValue({
        data: { access_token: 'gtok-abc' },
      });

      const { useAuth } = await importUseAuth();
      const { result } = renderHook(() => useAuth({ autoStart: true }));
      await waitFor(() => {
        expect(generatedApiMock.getAuthInfo).toHaveBeenCalledTimes(1);
      });

      // Post-login the second info call returns an authenticated payload.
      generatedApiMock.getAuthInfo.mockResolvedValueOnce({
        data: buildAuthInfo({ authenticated: true }),
      });

      await act(async () => {
        await result.current.loginWithGoogle('google-id-token');
      });

      expect(generatedApiMock.googleAuth).toHaveBeenCalledWith({
        body: { id_token: 'google-id-token' },
        throwOnError: true,
      });
      expect(window.localStorage.getItem('auth_token')).toBe('gtok-abc');
      expect(generatedApiMock.getAuthInfo).toHaveBeenCalledTimes(2);
    });
  });
});
