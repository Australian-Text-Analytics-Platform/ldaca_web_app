import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { workspacesApi } from '../workspaces';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const requestAt = (fetchMock: ReturnType<typeof vi.fn>, index = 0): Request =>
  fetchMock.mock.calls[index]![0] as Request;

describe('workspacesApi.delete', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends workspace_id as query parameter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ state: 'successful', id: 'workspace-b' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await workspacesApi.delete('workspace-b', {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requestAt(fetchMock);
    expect(request.url).toContain('/api/workspaces/delete');
    expect(request.url).toContain('workspace_id=workspace-b');
    expect(request.method).toBe('DELETE');
  });

  it('refreshes workspace list and retries when loading returns 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: 'Workspace not found' }, 404))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ state: 'successful', id: 'workspace-b' }));

    global.fetch = fetchMock as unknown as typeof fetch;

    await workspacesApi.current.set('workspace-b', {});

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const setAttempt1Url = requestAt(fetchMock, 0).url;
    const refreshListUrl = requestAt(fetchMock, 1).url;
    const setAttempt2Url = requestAt(fetchMock, 2).url;

    expect(setAttempt1Url).toContain('/api/workspaces/current?workspace_id=workspace-b');
    expect(refreshListUrl).toContain('/api/workspaces/');
    expect(setAttempt2Url).toContain('/api/workspaces/current?workspace_id=workspace-b');
  });
});
