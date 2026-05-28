import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useNodeColorsStore } from '@/stores/nodeColorsStore';
import { DEMO_SNAPSHOT_MODE } from '../mode';
import { useSnapshotViewStore } from '../store';
import type { LoadedSnapshot, SnapshotManifest } from '../types';
import { useResolvedNodeColor } from '../useResolvedNodeColor';

/**
 * Builds a loaded snapshot fixture whose manifest carries frozen node colors.
 * Used by: Vitest setup or assertions in snapshot-view/useResolvedNodeColor.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 * Flow: node colors enter manifest metadata, then the loaded snapshot fixture exposes them through the hook path.
 */
function snapshotWithColors(colors: Record<string, string>): LoadedSnapshot {
  const manifest: SnapshotManifest = {
    schema_version: 1,
    mode: 'demo',
    tool: 'concordance',
    tool_version: 'v0.4.4',
    captured_at: '2026-05-16T08:00:00Z',
    title: 'fixture',
    source: {
      workspace_id: 'ws-1',
      workspace_name: 'WS',
      node_ids: Object.keys(colors),
      node_labels: Object.keys(colors).map((id) => `Node ${id}`),
      total_source_rows: 10,
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
      displayColumns: ['doc_id', 'matched_text'],
    },
    payloads: [{ kind: 'result', path: 'tables/result.parquet' }],
    node_colors: colors,
  };
  return {
    manifest,
    capabilities: manifest.capabilities,
    payload: null,
    sourceProjection: null,
  };
}

describe('useResolvedNodeColor', () => {
  beforeEach(() => {
    useSnapshotViewStore.getState().reset();
    useNodeColorsStore.getState().reset();
  });

  it('returns the live colour when the tool is in live mode', () => {
    useNodeColorsStore.getState().setColor('n1', '#aabbcc');
    const { result } = renderHook(() => useResolvedNodeColor('concordance', 'n1'));
    expect(result.current).toBe('#aabbcc');
  });

  it('returns undefined when no live colour is assigned and not in snapshot mode', () => {
    const { result } = renderHook(() => useResolvedNodeColor('concordance', 'unknown'));
    expect(result.current).toBeUndefined();
  });

  it('returns the snapshot-frozen colour when the tool is in snapshot mode', () => {
    // Different colour in the live store vs the snapshot — proves the
    // hook reads from the snapshot, not the live store.
    useNodeColorsStore.getState().setColor('n1', '#aaaaaa');
    useSnapshotViewStore
      .getState()
      .loadSnapshot('concordance', snapshotWithColors({ n1: '#ff00ff' }), DEMO_SNAPSHOT_MODE);
    const { result } = renderHook(() => useResolvedNodeColor('concordance', 'n1'));
    expect(result.current).toBe('#ff00ff');
  });

  it('returns undefined for a node not present in the snapshot map', () => {
    useNodeColorsStore.getState().setColor('absent-node', '#aaaaaa');
    useSnapshotViewStore
      .getState()
      .loadSnapshot('concordance', snapshotWithColors({ n1: '#ff00ff' }), DEMO_SNAPSHOT_MODE);
    const { result } = renderHook(() => useResolvedNodeColor('concordance', 'absent-node'));
    expect(result.current).toBeUndefined();
  });

  it('per-tool dispatch — concordance in snapshot, quotation in live', () => {
    useNodeColorsStore.getState().setColor('n1', '#aaaaaa');
    useSnapshotViewStore
      .getState()
      .loadSnapshot('concordance', snapshotWithColors({ n1: '#ff00ff' }), DEMO_SNAPSHOT_MODE);

    const { result: concResult } = renderHook(() => useResolvedNodeColor('concordance', 'n1'));
    const { result: quotResult } = renderHook(() => useResolvedNodeColor('quotation', 'n1'));

    expect(concResult.current).toBe('#ff00ff'); // from snapshot
    expect(quotResult.current).toBe('#aaaaaa'); // from live
  });

  it('re-renders when the live colour changes (live mode)', () => {
    useNodeColorsStore.getState().setColor('n1', '#111111');
    const { result } = renderHook(() => useResolvedNodeColor('concordance', 'n1'));
    expect(result.current).toBe('#111111');

    act(() => {
      useNodeColorsStore.getState().setColor('n1', '#222222');
    });
    expect(result.current).toBe('#222222');
  });

  it('re-renders when the tool exits snapshot mode', () => {
    useNodeColorsStore.getState().setColor('n1', '#aaaaaa');
    useSnapshotViewStore
      .getState()
      .loadSnapshot('concordance', snapshotWithColors({ n1: '#ff00ff' }), DEMO_SNAPSHOT_MODE);

    const { result } = renderHook(() => useResolvedNodeColor('concordance', 'n1'));
    expect(result.current).toBe('#ff00ff');

    act(() => {
      useSnapshotViewStore.getState().exitSnapshot('concordance');
    });
    expect(result.current).toBe('#aaaaaa');
  });

  it('changing the live colour while in snapshot mode does NOT affect the snapshot view', () => {
    useNodeColorsStore.getState().setColor('n1', '#aaaaaa');
    useSnapshotViewStore
      .getState()
      .loadSnapshot('concordance', snapshotWithColors({ n1: '#ff00ff' }), DEMO_SNAPSHOT_MODE);

    const { result } = renderHook(() => useResolvedNodeColor('concordance', 'n1'));

    act(() => {
      useNodeColorsStore.getState().setColor('n1', '#000000');
    });
    expect(result.current).toBe('#ff00ff'); // still the snapshot's value
  });
});
