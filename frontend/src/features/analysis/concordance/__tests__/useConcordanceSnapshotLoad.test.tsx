import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSnapshotViewStore } from '@/features/snapshot-view';
import type { SnapshotManifest } from '@/features/snapshot-view';
import {
  buildJsonBundleBlob,
  makeSnapshotManifest,
  mockSnapshotDownload,
  resetSnapshotStore,
} from '@/features/analysis/common/__tests__/snapshotLoadTestUtils';
import { useConcordanceSnapshotLoad } from '../hooks/useConcordanceSnapshotLoad';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ getAuthHeaders: () => ({}) }),
}));

function makeManifest(overrides: Partial<SnapshotManifest> = {}): SnapshotManifest {
  return makeSnapshotManifest(
    {
      tool: 'concordance',
      version: 'v0.4.4',
      canPaginate: true,
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
    },
    overrides,
  );
}

async function buildBundleBlob(
  manifest: SnapshotManifest,
  resultPayload: unknown,
  binsPayload: unknown,
  settingsPayload?: unknown,
): Promise<Blob> {
  return buildJsonBundleBlob(manifest, {
    'tables/result.json': resultPayload,
    'tables/dispersion-bins.json': binsPayload,
    ...(settingsPayload !== undefined ? { 'settings.json': settingsPayload } : {}),
  });
}

describe('useConcordanceSnapshotLoad', () => {
  let downloadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    downloadSpy = mockSnapshotDownload();
    resetSnapshotStore();
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
    const bins = {
      n1: { node_id: 'n1', total_hits: 0, document_column: null, bin_count: 100, rows: [] },
    };
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
    await expect(hookResult.current('quotation-foo.ldaca-snapshot')).rejects.toThrow(
      /not concordance/i,
    );
    // Store should not have been mutated.
    expect(useSnapshotViewStore.getState().getSnapshot('concordance')).toBeNull();
  });

  it('throws when the bundle has no result payload', async () => {
    const manifest = makeManifest({ payloads: [] });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, {}, {}));

    const { result: hookResult } = renderHook(() => useConcordanceSnapshotLoad());
    await expect(hookResult.current('concordance-bad.ldaca-snapshot')).rejects.toThrow();
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
    type Payload = {
      resultByNodeId: Record<string, unknown>;
      binsByNodeId: Record<string, unknown>;
    };
    expect((snap?.payload as Payload).binsByNodeId).toEqual({});
  });
});
