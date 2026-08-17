import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

import { useBackendHealth } from '../useBackendHealth';

describe('useBackendHealth', () => {
  afterEach(() => {
    delete window.__BACKEND_URL__;
    delete window.__WORDFLOW_CONFIG__;
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    mocks.invoke.mockReset();
    vi.unstubAllGlobals();
  });

  it('polls the Tauri-injected backend /health route before the app starts', async () => {
    window.__BACKEND_URL__ = 'http://127.0.0.1:8007';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ready' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useBackendHealth());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8007/health', {
      cache: 'no-store',
    });
  });

  it('rejects legacy health vocabulary and waits for the canonical ready state', async () => {
    window.__BACKEND_URL__ = 'http://127.0.0.1:8007';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'operational' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ready' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useBackendHealth());

    await waitFor(() => {
      expect(result.current.error).toBe('HTTP 200');
    });
    expect(result.current.ready).toBe(false);
    await waitFor(
      () => {
        expect(result.current.ready).toBe(true);
      },
      { timeout: 1_500 },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries Tauri URL discovery instead of polling the packaged asset server', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    mocks.invoke
      .mockRejectedValueOnce(new Error('backend_unavailable'))
      .mockResolvedValueOnce('http://127.0.0.1:49123');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ready' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useBackendHealth());

    await waitFor(() => {
      expect(result.current.error).toBe('backend_unavailable');
    });
    await waitFor(
      () => {
        expect(result.current.ready).toBe(true);
      },
      { timeout: 1_500 },
    );

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:49123/health', {
      cache: 'no-store',
    });
  });
});
