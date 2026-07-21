import { act, render, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionResponse } from '@/api';

const generatedApiMock = vi.hoisted(() => ({
  getSession: vi.fn<(...args: unknown[]) => Promise<{ data: SessionResponse }>>(),
  deleteSession: vi.fn<(...args: unknown[]) => Promise<{ data: undefined }>>(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  ...generatedApiMock,
}));

const buildSession = (overrides: Partial<SessionResponse> = {}): SessionResponse => ({
  authenticated: true,
  csrf_token: 'csrf-1',
  mode: 'multi_user',
  providers: [],
  user: { id: 'u-1', email: 'u@example.com', name: 'User', picture: null },
  ...overrides,
});

const importUseAuth = async () => import('../useAuth');

const renderBootstrappedAuth = async () => {
  const { AuthBootstrap, useAuth } = await importUseAuth();
  const { result } = renderHook(() => useAuth());
  render(<AuthBootstrap />);
  return { result };
};

describe('useAuth', () => {
  beforeEach(() => {
    vi.resetModules();
    generatedApiMock.getSession.mockReset();
    generatedApiMock.deleteSession.mockReset();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('keeps subscriptions pure and bootstraps once from the lifecycle owner', async () => {
    generatedApiMock.getSession.mockResolvedValue({ data: buildSession() });
    const { AuthBootstrap, useAuth } = await importUseAuth();
    renderHook(() => useAuth());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(generatedApiMock.getSession).not.toHaveBeenCalled();

    render(
      <StrictMode>
        <AuthBootstrap />
      </StrictMode>,
    );
    await waitFor(() => expect(generatedApiMock.getSession).toHaveBeenCalledTimes(1));
  });

  it('bootstraps the authenticated session and exposes its deployment mode', async () => {
    const session = buildSession();
    generatedApiMock.getSession.mockResolvedValue({ data: session });
    const { result } = await renderBootstrappedAuth();

    await waitFor(() => expect(result.current.phase.status).toBe('ready'));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(session.user);
    expect(result.current.isMultiUserMode).toBe(true);
    expect(result.current.requiresAuthentication).toBe(true);
  });

  it('surfaces bootstrap failures without exposing a bearer-token fallback', async () => {
    generatedApiMock.getSession.mockRejectedValue(new Error('boom'));
    const { useAuth } = await importUseAuth();
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await expect(result.current.refreshAuth()).rejects.toThrow('boom');
    });
    expect(result.current.phase.status).toBe('fatal');
    expect(result.current.error).toBe('boom');
  });

  it('does not bootstrap from a subscription; refreshAuth triggers it on demand', async () => {
    generatedApiMock.getSession.mockResolvedValue({ data: buildSession() });
    const { useAuth } = await importUseAuth();
    const { result } = renderHook(() => useAuth());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(generatedApiMock.getSession).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.refreshAuth();
    });
    expect(generatedApiMock.getSession).toHaveBeenCalledTimes(1);
    expect(result.current.phase.status).toBe('ready');
  });

  it('revokes exactly the current cookie session and then refreshes bootstrap state', async () => {
    generatedApiMock.getSession
      .mockResolvedValueOnce({ data: buildSession() })
      .mockResolvedValueOnce({
        data: buildSession({ authenticated: false, csrf_token: null, user: null }),
      });
    generatedApiMock.deleteSession.mockResolvedValue({ data: undefined });
    const { result } = await renderBootstrappedAuth();
    await waitFor(() => expect(result.current.phase.status).toBe('ready'));

    await act(async () => {
      await result.current.logout();
    });
    expect(generatedApiMock.deleteSession).toHaveBeenCalledWith({ throwOnError: true });
    expect(generatedApiMock.getSession).toHaveBeenCalledTimes(2);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('uses the same cookie session contract in single-user mode', async () => {
    generatedApiMock.getSession.mockResolvedValue({
      data: buildSession({ authenticated: true, mode: 'single_user' }),
    });
    generatedApiMock.deleteSession.mockResolvedValue({ data: undefined });
    const { result } = await renderBootstrappedAuth();
    await waitFor(() => expect(result.current.phase.status).toBe('ready'));

    expect(result.current.requiresAuthentication).toBe(false);
    await act(async () => {
      await result.current.logout();
    });
    expect(generatedApiMock.deleteSession).toHaveBeenCalledTimes(1);
  });

  it('keeps unauthenticated sessions on the server-owned cookie contract', async () => {
    generatedApiMock.getSession.mockResolvedValue({
      data: buildSession({ authenticated: false, user: null }),
    });
    const { result } = await renderBootstrappedAuth();
    await waitFor(() => expect(result.current.phase.status).toBe('ready'));

    expect(result.current.isAuthenticated).toBe(false);
  });
});
