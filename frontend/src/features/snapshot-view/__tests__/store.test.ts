import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_SNAPSHOT_MODE, LIVE_MODE } from '../mode';
import { useSnapshotViewStore } from '../store';
import type { LoadedSnapshot, SnapshotManifest } from '../types';

function makeFakeSnapshot(
  overrides: Partial<SnapshotManifest> = {},
): LoadedSnapshot {
  const manifest: SnapshotManifest = {
    schema_version: 1,
    mode: 'demo',
    tool: 'concordance',
    tool_version: 'v0.4.4',
    captured_at: '2026-05-16T08:00:00Z',
    title: 'test snapshot',
    source: {
      workspace_id: 'ws-1',
      workspace_name: 'Test workspace',
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
      displayColumns: ['doc_id', 'matched_text'],
    },
    payloads: [{ kind: 'result', path: 'tables/result.parquet' }],
    node_colors: { n1: '#ff0000' },
    ...overrides,
  };
  return {
    manifest,
    capabilities: manifest.capabilities,
    payload: { fake: 'payload' },
    sourceProjection: null,
  };
}

describe('useSnapshotViewStore', () => {
  beforeEach(() => {
    useSnapshotViewStore.getState().reset();
  });

  it('defaults every tool to live mode', () => {
    expect(useSnapshotViewStore.getState().getMode('concordance')).toEqual(
      LIVE_MODE,
    );
    expect(useSnapshotViewStore.getState().getMode('quotation')).toEqual(
      LIVE_MODE,
    );
  });

  it('getSnapshot returns null when nothing is loaded', () => {
    expect(useSnapshotViewStore.getState().getSnapshot('concordance')).toBeNull();
  });

  it('setMode changes mode without touching the snapshot slice', () => {
    useSnapshotViewStore.getState().setMode('concordance', DEMO_SNAPSHOT_MODE);
    expect(useSnapshotViewStore.getState().getMode('concordance')).toEqual(
      DEMO_SNAPSHOT_MODE,
    );
    expect(useSnapshotViewStore.getState().getSnapshot('concordance')).toBeNull();
  });

  it('loadSnapshot populates the slice and flips the mode atomically', () => {
    const snap = makeFakeSnapshot();
    useSnapshotViewStore
      .getState()
      .loadSnapshot('concordance', snap, DEMO_SNAPSHOT_MODE);
    expect(useSnapshotViewStore.getState().getMode('concordance')).toEqual(
      DEMO_SNAPSHOT_MODE,
    );
    expect(useSnapshotViewStore.getState().getSnapshot('concordance')).toBe(snap);
  });

  it('exitSnapshot clears the slice and returns to live', () => {
    const snap = makeFakeSnapshot();
    useSnapshotViewStore
      .getState()
      .loadSnapshot('concordance', snap, DEMO_SNAPSHOT_MODE);
    useSnapshotViewStore.getState().exitSnapshot('concordance');
    expect(useSnapshotViewStore.getState().getMode('concordance')).toEqual(
      LIVE_MODE,
    );
    expect(useSnapshotViewStore.getState().getSnapshot('concordance')).toBeNull();
  });

  it('exitSnapshot is idempotent — exiting a tool already in live mode is a no-op', () => {
    useSnapshotViewStore.getState().exitSnapshot('concordance');
    expect(useSnapshotViewStore.getState().getMode('concordance')).toEqual(
      LIVE_MODE,
    );
    expect(useSnapshotViewStore.getState().getSnapshot('concordance')).toBeNull();
  });

  it('tools are independent — concordance in snapshot does not affect quotation', () => {
    const snap = makeFakeSnapshot();
    useSnapshotViewStore
      .getState()
      .loadSnapshot('concordance', snap, DEMO_SNAPSHOT_MODE);
    expect(useSnapshotViewStore.getState().getMode('quotation')).toEqual(
      LIVE_MODE,
    );
    expect(useSnapshotViewStore.getState().getSnapshot('quotation')).toBeNull();
  });

  it('reset clears all tools', () => {
    const snap = makeFakeSnapshot();
    useSnapshotViewStore
      .getState()
      .loadSnapshot('concordance', snap, DEMO_SNAPSHOT_MODE);
    useSnapshotViewStore.getState().setMode('quotation', DEMO_SNAPSHOT_MODE);
    useSnapshotViewStore.getState().reset();
    expect(useSnapshotViewStore.getState().getMode('concordance')).toEqual(
      LIVE_MODE,
    );
    expect(useSnapshotViewStore.getState().getMode('quotation')).toEqual(
      LIVE_MODE,
    );
    expect(useSnapshotViewStore.getState().getSnapshot('concordance')).toBeNull();
  });

  it('sourceProjection is null on demo snapshots (forward-compat hook)', () => {
    const snap = makeFakeSnapshot();
    useSnapshotViewStore
      .getState()
      .loadSnapshot('concordance', snap, DEMO_SNAPSHOT_MODE);
    const loaded = useSnapshotViewStore.getState().getSnapshot('concordance');
    expect(loaded?.sourceProjection).toBeNull();
  });
});
