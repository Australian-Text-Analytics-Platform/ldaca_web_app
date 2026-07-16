import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBackendHealth } from '../useBackendHealth';

describe('useBackendHealth', () => {
  afterEach(() => {
    delete window.__BACKEND_URL__;
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
});
