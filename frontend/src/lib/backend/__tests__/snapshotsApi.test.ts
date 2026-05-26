import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshotsApi } from '../snapshots';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function blobResponse(bytes: Uint8Array, status = 200): Response {
  return new Response(new Blob([bytes as BlobPart]), {
    status,
    headers: { 'content-type': 'application/zip' },
  });
}

function textResponse(text: string, contentType: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { 'content-type': contentType },
  });
}

const requestAt = (fetchMock: ReturnType<typeof vi.fn>, index = 0): Request =>
  fetchMock.mock.calls[index]![0] as Request;

describe('snapshotsApi', () => {
  const originalFetch = global.fetch;

  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('list with no tool filter hits /users/me/snapshots without ?tool=', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await snapshotsApi.list(undefined);

    const request = requestAt(fetchMock);
    expect(request.url).toContain('/api/users/me/snapshots');
    expect(request.url).not.toContain('tool=');
  });

  it('list with tool filter passes ?tool= query', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await snapshotsApi.list('concordance');

    expect(requestAt(fetchMock).url).toContain('tool=concordance');
  });

  it('upload sends multipart body with file + filename form fields', async () => {
    const appendSpy = vi.spyOn(FormData.prototype, 'append');
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        filename: 'concordance-x.ldaca-snapshot',
        manifest: { tool: 'concordance' },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const bundle = new File([new Uint8Array([1, 2, 3]) as BlobPart], 'concordance-x.ldaca-snapshot');
    await snapshotsApi.upload(bundle, 'concordance-x.ldaca-snapshot');

    const request = requestAt(fetchMock);
    expect(request.url).toContain('/api/users/me/snapshots');
    expect(request.method).toBe('POST');
    expect(appendSpy).toHaveBeenCalledWith('filename', 'concordance-x.ldaca-snapshot');
    expect(appendSpy).toHaveBeenCalledWith('file', bundle);
  });

  it('download GETs the bundle and returns a Blob', async () => {
    const bytes = new Uint8Array([0xff, 0x00, 0xab]);
    const fetchMock = vi.fn().mockResolvedValue(blobResponse(bytes));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await snapshotsApi.download('concordance-x.ldaca-snapshot');

    expect(result).toBeInstanceOf(Blob);
    const request = requestAt(fetchMock);
    expect(request.url).toContain('/api/users/me/snapshots/concordance-x.ldaca-snapshot');
    expect(request.method).toBe('GET');
  });

  it('getDescription returns the .md text', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(textResponse('# Hello\n', 'text/markdown'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await snapshotsApi.getDescription('concordance-x.ldaca-snapshot');
    expect(result).toBe('# Hello\n');
    expect(requestAt(fetchMock).url).toContain(
      '/api/users/me/snapshots/concordance-x.ldaca-snapshot/description',
    );
  });

  it('deleteOne sends DELETE for a specific filename', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ deleted: ['concordance-x.ldaca-snapshot'] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await snapshotsApi.deleteOne('concordance-x.ldaca-snapshot');

    const request = requestAt(fetchMock);
    expect(request.url).toContain('/api/users/me/snapshots/concordance-x.ldaca-snapshot');
    expect(request.method).toBe('DELETE');
  });

  it('deleteBatch without incompatibleWith sends only ?tool=', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ deleted: [] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await snapshotsApi.deleteBatch('concordance', undefined);

    const request = requestAt(fetchMock);
    expect(request.method).toBe('DELETE');
    expect(request.url).toContain('tool=concordance');
    expect(request.url).not.toContain('incompatible_with');
  });

  it('deleteBatch with incompatibleWith passes the version', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ deleted: [] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await snapshotsApi.deleteBatch('concordance', 'v0.4.4');

    const request = requestAt(fetchMock);
    expect(request.url).toContain('tool=concordance');
    expect(request.url).toContain('incompatible_with=v0.4.4');
  });

  it('encodes filenames with special chars in the URL path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deleted: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await snapshotsApi.deleteOne('concordance-name with spaces.ldaca-snapshot');

    expect(requestAt(fetchMock).url).toContain('concordance-name%20with%20spaces.ldaca-snapshot');
  });
});
