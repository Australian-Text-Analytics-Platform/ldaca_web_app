import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSnapshotViewStore } from '@/features/snapshot-view';
import type { SnapshotManifest } from '@/features/snapshot-view';
import {
  buildJsonBundleBlob,
  makeSnapshotManifest,
  mockSnapshotDownload,
  resetSnapshotStore,
} from '@/features/views/common/__tests__/snapshotLoadTestUtils';
import { useTopicModelingSnapshotLoad } from '../hooks/useTopicModelingSnapshotLoad';

vi.mock('@/features/auth/hooks/useAuth', () => ({
  // Supplies the auth hook contract without requiring login state in snapshot-load tests.
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  useAuth: () => ({
    // Snapshot download tests only need a stable header object.
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    getAuthHeaders: () => ({}),
  }),
}));

// Builds topic-modeling snapshot manifests with overridable fields for load-path tests.
/**
 * Called by: Vitest cases in this file to exercise the scoped analysis behavior because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
 * Steps: arrange fixtures and mocks, run the hook or component path under test, then assert the visible behavior or generated payload.
 */
function makeManifest(overrides: Partial<SnapshotManifest> = {}): SnapshotManifest {
  return makeSnapshotManifest(
    {
      tool: 'topic_modeling',
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
    },
    overrides,
  );
}

// Packages result/settings payloads into the Blob shape returned by the mocked download API.
/**
 * Called by: Vitest cases in this file to exercise the scoped analysis behavior because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
 * Steps: arrange fixtures and mocks, run the hook or component path under test, then assert the visible behavior or generated payload.
 */
async function buildBundleBlob(
  manifest: SnapshotManifest,
  resultPayload: unknown,
  settingsPayload?: unknown,
): Promise<Blob> {
  return buildJsonBundleBlob(manifest, {
    'tables/result.json': resultPayload,
    ...(settingsPayload !== undefined ? { 'settings.json': settingsPayload } : {}),
  });
}

describe('useTopicModelingSnapshotLoad', () => {
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
      state: 'successful',
      message: '',
      data: {
        topics: [
          {
            id: 0,
            label: 'foo, bar',
            representative_words: ['foo', 'bar'],
            size: [10],
            total_size: 10,
            x: 0,
            y: 0,
          },
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
    await expect(hookResult.current('concordance-foo.ldaca-snapshot')).rejects.toThrow(
      /not topic_modeling/i,
    );
    expect(useSnapshotViewStore.getState().getSnapshot('topic_modeling')).toBeNull();
  });

  it('throws when the bundle has no result payload', async () => {
    const manifest = makeManifest({ payloads: [] });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, {}));

    const { result: hookResult } = renderHook(() => useTopicModelingSnapshotLoad());
    await expect(hookResult.current('topic-bad.ldaca-snapshot')).rejects.toThrow();
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
