import { describe, expect, it } from 'vitest';
import {
  MANIFEST_FILE_NAME,
  findResultPayload,
  readBundle,
  writeBundle,
} from '../bundle';
import type { SnapshotManifest } from '../types';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function demoManifest(
  overrides: Partial<SnapshotManifest> = {},
): SnapshotManifest {
  return {
    schema_version: 1,
    mode: 'demo',
    tool: 'concordance',
    tool_version: 'v0.4.4',
    captured_at: '2026-05-16T08:00:00Z',
    title: 'fixture',
    source: {
      workspace_id: 'ws-1',
      workspace_name: 'WS',
      node_ids: ['n1'],
      node_labels: ['Node 1'],
      total_source_rows: 100,
    },
    capabilities: {
      canPaginate: true,
      canSortAndFilterResult: true,
      canExport: true,
      canFilterSourceRows: false,
      canCrossJump: false,
    },
    payloads: [
      { kind: 'result', path: 'tables/result.parquet' },
      { kind: 'dispersion-bins', path: 'tables/dispersion-bins.json' },
    ],
    node_colors: { n1: '#abcdef' },
    ...overrides,
  };
}

describe('writeBundle + readBundle — round trip', () => {
  it('round-trips a manifest and payload bytes byte-for-byte', async () => {
    const manifest = demoManifest();
    const resultBytes = bytes('fake-parquet-bytes');
    const binsBytes = bytes(JSON.stringify({ n1: { total: 42, bins: [] } }));

    const zipBytes = await writeBundle({
      manifest,
      payloadBytes: new Map([
        ['tables/result.parquet', resultBytes],
        ['tables/dispersion-bins.json', binsBytes],
      ]),
    });

    const read = await readBundle(zipBytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.bundle.manifest).toEqual(manifest);
    expect(read.bundle.degradations).toEqual([]);
    // Compare via Array.from() to dodge cross-realm typed-array equality
    // quirks under vitest+jsdom (jszip returns a Uint8Array from its
    // own module realm). The byte content is what matters.
    expect(Array.from(read.bundle.payloadBytes.get('tables/result.parquet')!)).toEqual(
      Array.from(resultBytes),
    );
    expect(
      Array.from(read.bundle.payloadBytes.get('tables/dispersion-bins.json')!),
    ).toEqual(Array.from(binsBytes));
  });

  it('writeBundle throws when a declared payload has no bytes provided', async () => {
    const manifest = demoManifest();
    await expect(
      writeBundle({
        manifest,
        payloadBytes: new Map([['tables/result.parquet', bytes('rb')]]),
        // dispersion-bins.json bytes are missing
      }),
    ).rejects.toThrow(/payload bytes missing/);
  });
});

describe('readBundle — error paths', () => {
  it('fails when the zip is corrupt', async () => {
    const bad = bytes('not a zip');
    const read = await readBundle(bad);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.kind).toBe('zip-parse-failed');
  });

  it('fails when the manifest file is missing', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('tables/result.parquet', new Blob([bytes('rb') as BlobPart]));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const read = await readBundle(zipBytes);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.kind).toBe('manifest-missing');
  });

  it('fails when a declared payload is missing from the zip', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const manifest = demoManifest();
    const { emitManifestJson } = await import('../manifest');
    zip.file(MANIFEST_FILE_NAME, emitManifestJson(manifest));
    // Intentionally omit the result.parquet file
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const read = await readBundle(zipBytes);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.error.kind).toBe('payload-missing');
      if (read.error.kind === 'payload-missing') {
        expect(read.error.path).toBe('tables/result.parquet');
      }
    }
  });

  it('fails with manifest-parse-failed on a malformed manifest', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file(MANIFEST_FILE_NAME, '{ malformed');
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const read = await readBundle(zipBytes);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.kind).toBe('manifest-parse-failed');
  });
});

describe('readBundle — Mode 2a graceful degrade', () => {
  it('a v1 build reading a share bundle gets capabilities gated + degradations reported', async () => {
    const manifest: SnapshotManifest = {
      ...demoManifest(),
      mode: 'share',
      capabilities: {
        canPaginate: true,
        canSortAndFilterResult: true,
        canExport: true,
        canFilterSourceRows: true,
        canCrossJump: false,
      },
      payloads: [
        { kind: 'result', path: 'tables/result.parquet' },
        {
          kind: 'source-projection',
          path: 'tables/source.parquet',
          columns: ['text', 'doc_id'],
        },
      ],
    };

    const zipBytes = await writeBundle({
      manifest,
      payloadBytes: new Map([
        ['tables/result.parquet', bytes('rb')],
        ['tables/source.parquet', bytes('sb')],
      ]),
    });

    const read = await readBundle(zipBytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.bundle.manifest.capabilities.canFilterSourceRows).toBe(false);
    expect(
      read.bundle.degradations.find((d) => d.kind === 'source-projection-unsupported'),
    ).toBeDefined();
    // The source-projection payload bytes are still read into memory —
    // a future build can light up the feature without re-decoding.
    expect(read.bundle.payloadBytes.has('tables/source.parquet')).toBe(true);
  });
});

describe('findResultPayload', () => {
  it('returns the result entry from a manifest', () => {
    const m = demoManifest();
    const entry = findResultPayload(m);
    expect(entry).toEqual({ kind: 'result', path: 'tables/result.parquet' });
  });
});
