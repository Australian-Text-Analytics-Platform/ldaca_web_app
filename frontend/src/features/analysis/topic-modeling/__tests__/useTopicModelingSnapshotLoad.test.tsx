import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import * as snapshotsApiModule from '@/api/snapshots';
import { useSnapshotViewStore } from '@/features/snapshot-view';
import type { SnapshotManifest } from '@/features/snapshot-view';
import { useTopicModelingSnapshotLoad } from '../hooks/useTopicModelingSnapshotLoad';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ getAuthHeaders: () => ({}) }),
}));

function makeManifest(overrides: Partial<SnapshotManifest> = {}): SnapshotManifest {
  return {
    schema_version: 1,
    mode: 'demo',
    tool: 'topic_modeling',
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
      tool: 'topic_modeling',
      numTopics: 12,
      vocabSize: 180,
      embedder: 'bertopic',
      wordsPerTopic: 15,
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

describe('useTopicModelingSnapshotLoad', () => {
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
      message: '',
      data: {
        topics: [
          { id: 0, label: 'foo, bar', representative_words: ['foo', 'bar'], size: [10], total_size: 10, x: 0, y: 0 },
        ],
        corpus_sizes: [100],
      },
    };
    const settings = {
      node_ids: ['n1'],
      node_columns: { n1: 'text' },
      random_seed: 42,
      representative_words_count: 15,
      topic_size_mode: 'exact',
      topic_size_value: 20,
    };
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, result, settings));

    const { result: hookResult } = renderHook(() => useTopicModelingSnapshotLoad());
    await act(async () => {
      await hookResult.current('topic_modeling-demo.ldaca-snapshot');
    });

    await waitFor(() => {
      const state = useSnapshotViewStore.getState();
      expect(state.mode.topic_modeling).toEqual({ kind: 'demoSnapshot' });
      const snap = state.snapshots.topic_modeling;
      expect(snap).not.toBeNull();
      expect(snap?.manifest.title).toBe('fixture');
      const payload = snap?.payload as {
        result: { state?: string; data?: { topics?: unknown[] } };
        settings?: { random_seed?: number; topic_size_value?: number };
      };
      expect(payload.result.state).toBe('successful');
      expect(payload.result.data?.topics).toHaveLength(1);
      expect(payload.settings?.random_seed).toBe(42);
      expect(payload.settings?.topic_size_value).toBe(20);
    });
  });

  it('rejects bundles for a different tool', async () => {
    const manifest = makeManifest({
      tool: 'concordance',
      payloads: [{ kind: 'result', path: 'tables/result.json' }],
    });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, {}));

    const { result: hookResult } = renderHook(() => useTopicModelingSnapshotLoad());
    await expect(
      hookResult.current('concordance-foo.ldaca-snapshot'),
    ).rejects.toThrow(/not topic_modeling/i);
    expect(
      useSnapshotViewStore.getState().getSnapshot('topic_modeling'),
    ).toBeNull();
  });

  it('throws when the bundle has no result payload', async () => {
    const manifest = makeManifest({ payloads: [] });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, {}));

    const { result: hookResult } = renderHook(() => useTopicModelingSnapshotLoad());
    await expect(
      hookResult.current('topic-bad.ldaca-snapshot'),
    ).rejects.toThrow();
  });

  it('loads a bundle with no settings payload (settings becomes undefined)', async () => {
    const manifest = makeManifest({
      payloads: [{ kind: 'result', path: 'tables/result.json' }],
    });
    downloadSpy.mockResolvedValue(
      await buildBundleBlob(manifest, {
        state: 'successful',
        message: '',
        data: { topics: [] },
      }),
    );

    const { result: hookResult } = renderHook(() => useTopicModelingSnapshotLoad());
    await act(async () => {
      await hookResult.current('topic-nosettings.ldaca-snapshot');
    });

    const snap = useSnapshotViewStore.getState().snapshots.topic_modeling;
    expect(snap).not.toBeNull();
    type Payload = { result: unknown; settings?: unknown };
    expect((snap?.payload as Payload).settings).toBeUndefined();
  });
});
