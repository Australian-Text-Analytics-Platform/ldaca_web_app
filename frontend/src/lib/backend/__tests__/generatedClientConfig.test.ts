import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { ApiError } from '@/lib/apiError';
import { createClientConfig, getGeneratedApiBase } from '@/lib/backend/generatedClientConfig';

const originalFetch = global.fetch;

/** Narrows optional generated fetch config before exercising the wrapped SDK request path. */
/** Used by: tests in this file because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
const requireFetch = (fetchImpl: typeof fetch | undefined): typeof fetch => {
  if (!fetchImpl) throw new Error('Expected generated client config to provide fetch');
  return fetchImpl;
};

describe('generatedClientConfig', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('adds credentials and the current auth header to generated client requests', async () => {
    window.localStorage.setItem('auth_token', 'test-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const config = createClientConfig({ baseUrl: 'http://api.test/api', fetch: fetchMock });

    await requireFetch(config.fetch)(
      new Request(`${String(config.baseUrl)}/runtime-config`, { credentials: config.credentials }),
    );

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.credentials).toBe('include');
    expect(request.headers.get('Authorization')).toBe('Bearer test-token');
  });

  it('uses a base URL compatible with generated paths that already include /api', () => {
    expect(getGeneratedApiBase('http://api.test/api')).toBe('http://api.test');
    expect(getGeneratedApiBase('/api')).toBe('');
  });

  it('strips the x-client-timeout-ms override header before the request leaves the browser', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const config = createClientConfig({ baseUrl: 'http://api.test/api', fetch: fetchMock });

    await requireFetch(config.fetch)(
      new Request(`${String(config.baseUrl)}/runtime-config`, {
        headers: { 'x-client-timeout-ms': '600000' },
      }),
    );

    // The opt-in override is a client-only hint; it must never reach the server.
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.has('x-client-timeout-ms')).toBe(false);
  });

  it('normalizes fetch network failures to ApiError', async () => {
    const config = createClientConfig({
      baseUrl: 'http://api.test/api',
      fetch: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });

    await expect(
      requireFetch(config.fetch)(new Request(`${String(config.baseUrl)}/runtime-config`)),
    ).rejects.toMatchObject({
      code: 'NETWORK',
      name: 'ApiError',
    } satisfies Partial<ApiError>);
  });
});
