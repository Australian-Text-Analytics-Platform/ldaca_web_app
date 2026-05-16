import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import * as snapshotsApiModule from '@/api/snapshots';
import { useSnapshotViewStore } from '@/features/snapshot-view';
import type { SnapshotManifest } from '@/features/snapshot-view';
import { useQuotationSnapshotLoad } from '../hooks/useQuotationSnapshotLoad';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ getAuthHeaders: () => ({}) }),
}));

function makeManifest(overrides: Partial<SnapshotManifest> = {}): SnapshotManifest {
  return {
    schema_version: 1,
    mode: 'demo',
    tool: 'quotation',
    tool_version: 'v0.5.0',
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
    preview: {
      tool: 'quotation',
      openPattern: '(rules)',
      closePattern: '',
      totalHits: 17,
      displayColumns: [],
    },
    payloads: [
      { kind: 'result', path: 'tables/result.json' },
      { kind: 'settings', path: 'settings.json' },
    ],
    node_colors: { n1: '#aabbcc' },
    ...overrides,
  };
}

async function buildBundleBlob(
  manifest: SnapshotManifest,
  resultPayload: unknown,
  settingsPayload?: unknown,
): Promise<Blob> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file('tables/result.json', JSON.stringify(resultPayload));
  if (settingsPayload !== undefined) {
    zip.file('settings.json', JSON.stringify(settingsPayload));
  }
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new Blob([bytes as BlobPart], { type: 'application/zip' });
}

describe('useQuotationSnapshotLoad', () => {
  let downloadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    downloadSpy = vi.spyOn(snapshotsApiModule.snapshotsApi, 'download');
    act(() => {
      useSnapshotViewStore.getState().reset();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads, decodes, populates the store, and flips view mode', async () => {
    const manifest = makeManifest();
    const result = {
      data: [],
      columns: ['QUOTE_quote'],
      metadata: { quotation_columns: [], metadata_columns: [], all_columns: [] },
      pagination: {
        page: 1,
        page_size: 100,
        total_source_rows: 0,
        total_source_pages: 1,
        result_count: 0,
        has_next: false,
        has_prev: false,
      },
      sorting: { descending: false },
    };
    const settings = {
      node_id: 'n1',
      column: 'text',
      engine: { type: 'local' },
    };
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, result, settings));

    const { result: hookResult } = renderHook(() => useQuotationSnapshotLoad());
    await act(async () => {
      await hookResult.current('quotation-demo.ldaca-snapshot');
    });

    await waitFor(() => {
      const state = useSnapshotViewStore.getState();
      expect(state.mode.quotation).toEqual({ kind: 'demoSnapshot' });
      const snap = state.snapshots.quotation;
      expect(snap).not.toBeNull();
      expect(snap?.manifest.title).toBe('fixture');
      const payload = snap?.payload as { settings?: { node_id?: string; column?: string } };
      expect(payload.settings?.node_id).toBe('n1');
      expect(payload.settings?.column).toBe('text');
    });
  });

  it('rejects bundles for a different tool', async () => {
    const manifest = makeManifest({
      tool: 'concordance',
      payloads: [{ kind: 'result', path: 'tables/result.json' }],
    });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, {}));

    const { result: hookResult } = renderHook(() => useQuotationSnapshotLoad());
    await expect(
      hookResult.current('concordance-foo.ldaca-snapshot'),
    ).rejects.toThrow(/not quotation/i);
    expect(useSnapshotViewStore.getState().getSnapshot('quotation')).toBeNull();
  });

  it('throws when the bundle has no result payload', async () => {
    const manifest = makeManifest({ payloads: [] });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, {}));

    const { result: hookResult } = renderHook(() => useQuotationSnapshotLoad());
    await expect(
      hookResult.current('quotation-bad.ldaca-snapshot'),
    ).rejects.toThrow();
  });

  it('loads a bundle with no settings payload (settings becomes undefined)', async () => {
    const manifest = makeManifest({
      payloads: [{ kind: 'result', path: 'tables/result.json' }],
    });
    downloadSpy.mockResolvedValue(
      await buildBundleBlob(manifest, {
        data: [],
        columns: [],
        metadata: { quotation_columns: [], metadata_columns: [], all_columns: [] },
        pagination: {
          page: 1,
          page_size: 100,
          total_source_rows: 0,
          total_source_pages: 1,
          result_count: 0,
          has_next: false,
          has_prev: false,
        },
        sorting: { descending: false },
      }),
    );

    const { result: hookResult } = renderHook(() => useQuotationSnapshotLoad());
    await act(async () => {
      await hookResult.current('quotation-nosettings.ldaca-snapshot');
    });

    const snap = useSnapshotViewStore.getState().snapshots.quotation;
    expect(snap).not.toBeNull();
    type Payload = { result: unknown; settings?: unknown };
    expect((snap?.payload as Payload).settings).toBeUndefined();
  });
});
