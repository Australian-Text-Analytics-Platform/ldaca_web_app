import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { workspacesApi } from '../workspaces';

describe('workspacesApi.delete', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends workspace_id as query parameter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ state: 'successful', id: 'workspace-b' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await workspacesApi.delete('workspace-b', {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/workspaces/delete');
    expect(url).toContain('workspace_id=workspace-b');
    expect(options.method).toBe('DELETE');
  });

  it('refreshes workspace list and retries when loading returns 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ detail: 'Workspace not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ state: 'successful', id: 'workspace-b' }),
      });

    global.fetch = fetchMock as unknown as typeof fetch;

    await workspacesApi.current.set('workspace-b', {});

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [setAttempt1Url] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [refreshListUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    const [setAttempt2Url] = fetchMock.mock.calls[2] as [string, RequestInit];

    expect(setAttempt1Url).toContain('/api/workspaces/current?workspace_id=workspace-b');
    expect(refreshListUrl).toContain('/api/workspaces/');
    expect(setAttempt2Url).toContain('/api/workspaces/current?workspace_id=workspace-b');
  });
});
