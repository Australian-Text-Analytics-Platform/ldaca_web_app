import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import * as snapshotsApiModule from '@/api/snapshots';
import { useSnapshotViewStore } from '@/features/snapshot-view';
import type { SnapshotManifest } from '@/features/snapshot-view';
import { useConcordanceSnapshotLoad } from '../hooks/useConcordanceSnapshotLoad';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ getAuthHeaders: () => ({}) }),
}));

function makeManifest(overrides: Partial<SnapshotManifest> = {}): SnapshotManifest {
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
    preview: {
      tool: 'concordance',
      searchTerm: 'love',
      totalHits: 42,
      materialised: true,
      displayColumns: [],
    },
    payloads: [
      { kind: 'result', path: 'tables/result.json' },
      { kind: 'dispersion-bins', path: 'tables/dispersion-bins.json' },
      { kind: 'settings', path: 'settings.json' },
    ],
    node_colors: { n1: '#aabbcc' },
    ...overrides,
  };
}

async function buildBundleBlob(
  manifest: SnapshotManifest,
  resultPayload: unknown,
  binsPayload: unknown,
  settingsPayload?: unknown,
): Promise<Blob> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file('tables/result.json', JSON.stringify(resultPayload));
  zip.file('tables/dispersion-bins.json', JSON.stringify(binsPayload));
  if (settingsPayload !== undefined) {
    zip.file('settings.json', JSON.stringify(settingsPayload));
  }
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new Blob([bytes as BlobPart], { type: 'application/zip' });
}

describe('useConcordanceSnapshotLoad', () => {
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
      n1: {
        data: [],
        columns: ['matched_text'],
        metadata: {},
        pagination: {},
        sorting: { descending: false },
        materialized: true,
      },
    };
    const bins = { n1: { node_id: 'n1', total_hits: 0, document_column: null, bin_count: 100, rows: [] } };
    const settings = {
      node_ids: ['n1'],
      node_columns: { n1: 'text' },
      search_word: 'love',
      num_left_tokens: 8,
      num_right_tokens: 8,
      regex: false,
      whole_word: true,
      case_sensitive: false,
      combined: false,
      search_mode: 'regex',
    };
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, result, bins, settings));

    const { result: hookResult } = renderHook(() => useConcordanceSnapshotLoad());
    await act(async () => {
      await hookResult.current('concordance-demo.ldaca-snapshot');
    });

    await waitFor(() => {
      const state = useSnapshotViewStore.getState();
      expect(state.mode.concordance).toEqual({ kind: 'demoSnapshot' });
      const snap = state.snapshots.concordance;
      expect(snap).not.toBeNull();
      expect(snap?.manifest.title).toBe('fixture');
      const payload = snap?.payload as { settings?: { search_word?: string } };
      expect(payload.settings?.search_word).toBe('love');
    });
  });

  it('rejects bundles for a different tool', async () => {
    const manifest = makeManifest({
      tool: 'quotation',
      // Drop the settings payload entry — bundle reader fails if a
      // manifest-declared payload is missing from the zip.
      payloads: [
        { kind: 'result', path: 'tables/result.json' },
        { kind: 'dispersion-bins', path: 'tables/dispersion-bins.json' },
      ],
    });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, {}, {}));

    const { result: hookResult } = renderHook(() => useConcordanceSnapshotLoad());
    await expect(
      hookResult.current('quotation-foo.ldaca-snapshot'),
    ).rejects.toThrow(/not concordance/i);
    // Store should not have been mutated.
    expect(useSnapshotViewStore.getState().getSnapshot('concordance')).toBeNull();
  });

  it('throws when the bundle has no result payload', async () => {
    const manifest = makeManifest({ payloads: [] });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, {}, {}));

    const { result: hookResult } = renderHook(() => useConcordanceSnapshotLoad());
    await expect(
      hookResult.current('concordance-bad.ldaca-snapshot'),
    ).rejects.toThrow();
  });

  it('handles a bundle with missing dispersion-bins payload gracefully', async () => {
    const manifest = makeManifest({
      payloads: [{ kind: 'result', path: 'tables/result.json' }],
    });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, { n1: {} }, {}));

    const { result: hookResult } = renderHook(() => useConcordanceSnapshotLoad());
    await act(async () => {
      await hookResult.current('concordance-nobins.ldaca-snapshot');
    });

    const snap = useSnapshotViewStore.getState().snapshots.concordance;
    expect(snap).not.toBeNull();
    // Payload is loaded with an empty bins map.
    type Payload = { resultByNodeId: Record<string, unknown>; binsByNodeId: Record<string, unknown> };
    expect((snap?.payload as Payload).binsByNodeId).toEqual({});
  });
});
