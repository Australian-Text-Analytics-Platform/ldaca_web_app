import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshotsApi } from '../snapshots';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as unknown as Response;
}

function blobResponse(bytes: Uint8Array, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/zip' }),
    blob: async () => new Blob([bytes as BlobPart]),
  } as unknown as Response;
}

function textResponse(text: string, contentType: string, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': contentType }),
    text: async () => text,
  } as unknown as Response;
}

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

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/users/me/snapshots');
    expect(url).not.toContain('tool=');
  });

  it('list with tool filter passes ?tool= query', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await snapshotsApi.list('concordance');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('tool=concordance');
  });

  it('upload sends multipart body with file + filename form fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        filename: 'concordance-x.ldaca-snapshot',
        manifest: { tool: 'concordance' },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const bundle = new Blob([new Uint8Array([1, 2, 3]) as BlobPart]);
    await snapshotsApi.upload(bundle, 'concordance-x.ldaca-snapshot');

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/users/me/snapshots');
    expect(options.method).toBe('POST');
    expect(options.body).toBeInstanceOf(FormData);
    const fd = options.body as FormData;
    expect(fd.get('filename')).toBe('concordance-x.ldaca-snapshot');
    expect(fd.get('file')).toBeInstanceOf(Blob);
  });

  it('download GETs the bundle and returns a Blob', async () => {
    const bytes = new Uint8Array([0xff, 0x00, 0xab]);
    const fetchMock = vi.fn().mockResolvedValue(blobResponse(bytes));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await snapshotsApi.download('concordance-x.ldaca-snapshot');

    expect(result).toBeInstanceOf(Blob);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/users/me/snapshots/concordance-x.ldaca-snapshot');
    expect(options.method).toBe('GET');
  });

  it('getDescription returns the .md text', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(textResponse('# Hello\n', 'text/markdown'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await snapshotsApi.getDescription('concordance-x.ldaca-snapshot');
    expect(result).toBe('# Hello\n');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      '/api/users/me/snapshots/concordance-x.ldaca-snapshot/description',
    );
  });

  it('deleteOne sends DELETE for a specific filename', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ deleted: ['concordance-x.ldaca-snapshot'] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await snapshotsApi.deleteOne('concordance-x.ldaca-snapshot');

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/users/me/snapshots/concordance-x.ldaca-snapshot');
    expect(options.method).toBe('DELETE');
  });

  it('deleteBatch without incompatibleWith sends only ?tool=', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ deleted: [] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await snapshotsApi.deleteBatch('concordance', undefined);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('DELETE');
    expect(url).toContain('tool=concordance');
    expect(url).not.toContain('incompatible_with');
  });

  it('deleteBatch with incompatibleWith passes the version', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ deleted: [] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await snapshotsApi.deleteBatch('concordance', 'v0.4.4');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('tool=concordance');
    expect(url).toContain('incompatible_with=v0.4.4');
  });

  it('encodes filenames with special chars in the URL path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deleted: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await snapshotsApi.deleteOne('concordance-name with spaces.ldaca-snapshot');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('concordance-name%20with%20spaces.ldaca-snapshot');
  });
});
