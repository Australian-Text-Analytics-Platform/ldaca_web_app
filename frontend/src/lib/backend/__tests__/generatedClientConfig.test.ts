import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { ApiError } from '@/lib/apiError';
import { createClientConfig, getGeneratedApiBase } from '@/lib/backend/generatedClientConfig';

const originalFetch = global.fetch;

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
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const config = createClientConfig({ baseUrl: 'http://api.test/api', fetch: fetchMock });

    await requireFetch(config.fetch)(new Request(`${config.baseUrl}/config/`, { credentials: config.credentials }));

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.credentials).toBe('include');
    expect(request.headers.get('Authorization')).toBe('Bearer test-token');
  });

  it('uses a base URL compatible with generated paths that already include /api', () => {
    expect(getGeneratedApiBase('http://api.test/api')).toBe('http://api.test');
    expect(getGeneratedApiBase('/api')).toBe('');
  });

  it('normalizes fetch network failures to ApiError', async () => {
    const config = createClientConfig({
      baseUrl: 'http://api.test/api',
      fetch: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });

    await expect(requireFetch(config.fetch)(new Request(`${config.baseUrl}/config/`))).rejects.toMatchObject({
      code: 'NETWORK',
      name: 'ApiError',
    } satisfies Partial<ApiError>);
  });
});