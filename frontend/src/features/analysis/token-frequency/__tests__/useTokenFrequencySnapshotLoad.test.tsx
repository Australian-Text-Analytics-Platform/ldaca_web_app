import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import * as snapshotsApiModule from '@/api/snapshots';
import { useSnapshotViewStore } from '@/features/snapshot-view';
import type { SnapshotManifest } from '@/features/snapshot-view';
import { useTokenFrequencySnapshotLoad } from '../hooks/useTokenFrequencySnapshotLoad';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ getAuthHeaders: () => ({}) }),
}));

function makeManifest(overrides: Partial<SnapshotManifest> = {}): SnapshotManifest {
  return {
    schema_version: 1,
    mode: 'demo',
    tool: 'token_frequencies',
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
      canPaginate: false,
      canSortAndFilterResult: true,
      canExport: true,
      canFilterSourceRows: false,
      canCrossJump: false,
    },
    preview: {
      tool: 'token_frequencies',
      vocabSize: 17,
      topToken: 'the',
      topTokenCount: 42,
      tokeniserId: '(default)',
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

describe('useTokenFrequencySnapshotLoad', () => {
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
      state: 'successful',
      data: {
        n1: {
          data: [{ token: 'the', frequency: 42 }],
          columns: ['token', 'frequency'],
        },
      },
      token_limit: 100,
    };
    const settings = {
      node_ids: ['n1'],
      node_columns: { n1: 'text' },
      model: 'spacy:en_core_web_sm',
    };
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, result, settings));

    const { result: hookResult } = renderHook(() => useTokenFrequencySnapshotLoad());
    await act(async () => {
      await hookResult.current('token-frequency-demo.ldaca-snapshot');
    });

    await waitFor(() => {
      const state = useSnapshotViewStore.getState();
      expect(state.mode.token_frequencies).toEqual({ kind: 'demoSnapshot' });
      const snap = state.snapshots.token_frequencies;
      expect(snap).not.toBeNull();
      expect(snap?.manifest.title).toBe('fixture');
      const payload = snap?.payload as {
        result: { state?: string };
        settings?: { node_ids?: string[]; node_columns?: Record<string, string>; model?: string };
      };
      expect(payload.result.state).toBe('successful');
      expect(payload.settings?.node_ids).toEqual(['n1']);
      expect(payload.settings?.node_columns).toEqual({ n1: 'text' });
      expect(payload.settings?.model).toBe('spacy:en_core_web_sm');
    });
  });

  it('rejects bundles for a different tool', async () => {
    const manifest = makeManifest({
      tool: 'concordance',
      payloads: [{ kind: 'result', path: 'tables/result.json' }],
    });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, {}));

    const { result: hookResult } = renderHook(() => useTokenFrequencySnapshotLoad());
    await expect(
      hookResult.current('concordance-foo.ldaca-snapshot'),
    ).rejects.toThrow(/not token_frequencies/i);
    expect(
      useSnapshotViewStore.getState().getSnapshot('token_frequencies'),
    ).toBeNull();
  });

  it('throws when the bundle has no result payload', async () => {
    const manifest = makeManifest({ payloads: [] });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, {}));

    const { result: hookResult } = renderHook(() => useTokenFrequencySnapshotLoad());
    await expect(
      hookResult.current('token-frequency-bad.ldaca-snapshot'),
    ).rejects.toThrow();
  });

  it('loads a bundle with no settings payload (settings becomes undefined)', async () => {
    const manifest = makeManifest({
      payloads: [{ kind: 'result', path: 'tables/result.json' }],
    });
    downloadSpy.mockResolvedValue(
      await buildBundleBlob(manifest, {
        state: 'successful',
        data: {},
      }),
    );

    const { result: hookResult } = renderHook(() => useTokenFrequencySnapshotLoad());
    await act(async () => {
      await hookResult.current('token-frequency-nosettings.ldaca-snapshot');
    });

    const snap = useSnapshotViewStore.getState().snapshots.token_frequencies;
    expect(snap).not.toBeNull();
    type Payload = { result: unknown; settings?: unknown };
    expect((snap?.payload as Payload).settings).toBeUndefined();
  });
});
