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
import { useSequentialAnalysisSnapshotLoad } from '../hooks/useSequentialAnalysisSnapshotLoad';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ getAuthHeaders: () => ({}) }),
}));

function makeManifest(overrides: Partial<SnapshotManifest> = {}): SnapshotManifest {
  return makeSnapshotManifest(
    {
      tool: 'sequential_analysis',
      preview: {
        tool: 'sequential_analysis',
        seriesCount: 3,
        bucketCount: 24,
        chartType: 'line',
      },
      payloads: [
        { kind: 'result', path: 'tables/result.json' },
        { kind: 'settings', path: 'settings.json' },
      ],
    },
    overrides,
  );
}

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

describe('useSequentialAnalysisSnapshotLoad', () => {
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
      data: [
        { time_period: '2026-01', sequential_count: 5 },
        { time_period: '2026-02', sequential_count: 7 },
      ],
      analysis_params: {
        time_column: 'published_at',
        frequency: 'monthly',
        group_by_columns: [],
        column_type: 'datetime',
      },
      chart_type: 'bar',
      total_records: 12,
    };
    const settings = {
      node_id: 'n1',
      time_column: 'published_at',
      frequency: 'monthly',
      sort_by_time: true,
      column_type: 'datetime',
      case_sensitive: true,
    };
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, result, settings));

    const { result: hookResult } = renderHook(() => useSequentialAnalysisSnapshotLoad());
    await act(async () => {
      await hookResult.current('trends-demo.ldaca-snapshot');
    });

    await waitFor(() => {
      const state = useSnapshotViewStore.getState();
      expect(state.mode.sequential_analysis).toEqual({ kind: 'demoSnapshot' });
      const snap = state.snapshots.sequential_analysis;
      expect(snap).not.toBeNull();
      expect(snap?.manifest.title).toBe('fixture');
      const payload = snap?.payload as {
        result: { chart_type?: string };
        settings?: { time_column?: string; frequency?: string };
      };
      expect(payload.result.chart_type).toBe('bar');
      expect(payload.settings?.time_column).toBe('published_at');
      expect(payload.settings?.frequency).toBe('monthly');
    });
  });

  it('rejects bundles for a different tool', async () => {
    const manifest = makeManifest({
      tool: 'concordance',
      payloads: [{ kind: 'result', path: 'tables/result.json' }],
    });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, {}));

    const { result: hookResult } = renderHook(() => useSequentialAnalysisSnapshotLoad());
    await expect(hookResult.current('concordance-foo.ldaca-snapshot')).rejects.toThrow(
      /not sequential_analysis/i,
    );
    expect(useSnapshotViewStore.getState().getSnapshot('sequential_analysis')).toBeNull();
  });

  it('throws when the bundle has no result payload', async () => {
    const manifest = makeManifest({ payloads: [] });
    downloadSpy.mockResolvedValue(await buildBundleBlob(manifest, {}));

    const { result: hookResult } = renderHook(() => useSequentialAnalysisSnapshotLoad());
    await expect(hookResult.current('trends-bad.ldaca-snapshot')).rejects.toThrow();
  });

  it('loads a bundle with no settings payload (settings becomes undefined)', async () => {
    const manifest = makeManifest({
      payloads: [{ kind: 'result', path: 'tables/result.json' }],
    });
    downloadSpy.mockResolvedValue(
      await buildBundleBlob(manifest, {
        state: 'successful',
        data: [],
        chart_type: 'line',
      }),
    );

    const { result: hookResult } = renderHook(() => useSequentialAnalysisSnapshotLoad());
    await act(async () => {
      await hookResult.current('trends-nosettings.ldaca-snapshot');
    });

    const snap = useSnapshotViewStore.getState().snapshots.sequential_analysis;
    expect(snap).not.toBeNull();
    type Payload = { result: unknown; settings?: unknown };
    expect((snap?.payload as Payload).settings).toBeUndefined();
  });
});
