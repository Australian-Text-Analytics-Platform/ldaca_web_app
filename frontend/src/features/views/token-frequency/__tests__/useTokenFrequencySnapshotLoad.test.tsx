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
import { useTokenFrequencySnapshotLoad } from '../hooks/useTokenFrequencySnapshotLoad';

vi.mock('@/hooks/useAuth', () => ({
  /** Supplies the auth hook shape expected by the snapshot loader. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  useAuth: () => ({
    /** Keeps generated API calls header-compatible without real credentials. */
    // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
    getAuthHeaders: () => ({}),
  }),
}));

/** Builds a token-frequency snapshot manifest fixture with optional overrides. */
/**
 * Called by: Vitest cases in this file to exercise the scoped analysis behavior because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
 * Steps: arrange fixtures and mocks, run the hook or component path under test, then assert the visible behavior or generated payload.
 */
function makeManifest(overrides: Partial<SnapshotManifest> = {}): SnapshotManifest {
  return makeSnapshotManifest(
    {
      tool: 'token_frequencies',
      preview: {
        tool: 'token_frequencies',
        vocabSize: 17,
        topToken: 'the',
        topTokenCount: 42,
        tokeniserId: '(unspecified)',
      },
      payloads: [
        { kind: 'result', path: 'tables/result.json' },
        { kind: 'settings', path: 'settings.json' },
      ],
    },
    overrides,
  );
}

/** Creates a zipped snapshot blob containing result and optional settings payloads. */
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

describe('useTokenFrequencySnapshotLoad', () => {
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
        settings?: { node_ids?: string[]; node_columns?: Record<string, string> };
      };
      expect(payload.result.state).toBe('successful');
      expect(payload.settings?.node_ids).toEqual(['n1']);
      expect(payload.settings?.node_columns).toEqual({ n1: 'text' });
    });
  });

  it('rejects bundles for a different tool', async () => {
    const manifest = makeManifest({
      tool: 'concordance',
      payloads: [{ kind: 'result', path: 'tables/result.json' }],
    });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, {}));

    const { result: hookResult } = renderHook(() => useTokenFrequencySnapshotLoad());
    await expect(hookResult.current('concordance-foo.ldaca-snapshot')).rejects.toThrow(
      /not token_frequencies/i,
    );
    expect(useSnapshotViewStore.getState().getSnapshot('token_frequencies')).toBeNull();
  });

  it('throws when the bundle has no result payload', async () => {
    const manifest = makeManifest({ payloads: [] });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, {}));

    const { result: hookResult } = renderHook(() => useTokenFrequencySnapshotLoad());
    await expect(hookResult.current('token-frequency-bad.ldaca-snapshot')).rejects.toThrow();
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
