import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiError } from '@/lib/apiError';
import { createClientConfig, getGeneratedApiBase } from '@/lib/backend/generatedClientConfig';
import { clearCsrfToken, setCsrfToken } from '@/lib/backend/csrfToken';

const originalFetch = global.fetch;

const requireFetch = (fetchImpl: typeof fetch | undefined): typeof fetch => {
  if (!fetchImpl) throw new Error('Expected generated client config to provide fetch');
  return fetchImpl;
};

describe('generatedClientConfig', () => {
  beforeEach(() => clearCsrfToken());
  afterEach(() => {
    global.fetch = originalFetch;
    clearCsrfToken();
  });

  it('uses credentialed cookie requests and injects the current CSRF token only for unsafe methods', async () => {
    setCsrfToken('csrf-1');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const config = createClientConfig({ baseUrl: 'http://api.test/api', fetch: fetchMock });

    await requireFetch(config.fetch)(
      new Request(`${String(config.baseUrl)}/session`, {
        method: 'GET',
        credentials: config.credentials,
      }),
    );
    await requireFetch(config.fetch)(
      new Request(`${String(config.baseUrl)}/session`, {
        method: 'DELETE',
        credentials: config.credentials,
      }),
    );

    const [getRequest, deleteRequest] = fetchMock.mock.calls.map(([request]) => request as Request);
    expect(getRequest.credentials).toBe('include');
    expect(getRequest.headers.has('X-CSRF-Token')).toBe(false);
    expect(deleteRequest.credentials).toBe('include');
    expect(deleteRequest.headers.get('X-CSRF-Token')).toBe('csrf-1');
  });

  it('normalizes generated paths that already include /api', () => {
    expect(getGeneratedApiBase('http://api.test/api')).toBe('http://api.test');
    expect(getGeneratedApiBase('/api')).toBe('');
  });

  it('strips the client-only timeout override before the request leaves the browser', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const config = createClientConfig({ baseUrl: 'http://api.test/api', fetch: fetchMock });
    await requireFetch(config.fetch)(
      new Request(`${String(config.baseUrl)}/session`, {
        headers: { 'x-client-timeout-ms': '600000' },
      }),
    );
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.has('x-client-timeout-ms')).toBe(false);
  });

  it('normalizes network failures to ApiError', async () => {
    const config = createClientConfig({
      baseUrl: 'http://api.test/api',
      fetch: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });
    await expect(
      requireFetch(config.fetch)(new Request(`${String(config.baseUrl)}/session`)),
    ).rejects.toMatchObject({ code: 'NETWORK', name: 'ApiError' } satisfies Partial<ApiError>);
  });

  it('preserves the backend stable error code on failed generated requests', async () => {
    const config = createClientConfig({
      baseUrl: 'http://api.test/api',
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ code: 'workspace_conflict', message: 'Workspace changed' }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
    });
    await expect(
      requireFetch(config.fetch)(new Request(`${String(config.baseUrl)}/session`)),
    ).rejects.toMatchObject({
      status: 409,
      code: 'workspace_conflict',
      message: 'Workspace changed',
    } satisfies Partial<ApiError>);
  });

  it('includes the backend request id in server-error messages', async () => {
    const diagnostic = `RuntimeError: ${'x'.repeat(1_000)}`;
    const config = createClientConfig({
      baseUrl: 'http://api.test/api',
      fetch: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'internal_server_error',
            message: diagnostic,
            request_id: 'request-500',
          }),
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'X-Request-ID': 'request-500',
            },
          },
        ),
      ),
    });

    await expect(
      requireFetch(config.fetch)(new Request(`${String(config.baseUrl)}/session`)),
    ).rejects.toMatchObject({
      status: 500,
      code: 'internal_server_error',
      message: `${diagnostic} (Request ID: request-500)`,
    } satisfies Partial<ApiError>);
  });

  it('prefers canonical validation details over the summary message', async () => {
    const config = createClientConfig({
      baseUrl: 'http://api.test/api',
      fetch: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'request_validation_failed',
            message: 'Request validation failed',
            details: [
              { location: ['body', 'path'], message: 'Path must be absolute' },
              { location: ['body', 'path'], message: 'Path must be writable' },
            ],
          }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    });

    await expect(
      requireFetch(config.fetch)(new Request(`${String(config.baseUrl)}/session`)),
    ).rejects.toMatchObject({
      status: 422,
      code: 'request_validation_failed',
      message: 'Path must be absolute; Path must be writable',
    } satisfies Partial<ApiError>);
  });
});
