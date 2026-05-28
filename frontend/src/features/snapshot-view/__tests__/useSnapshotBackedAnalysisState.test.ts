import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_SNAPSHOT_MODE, LIVE_MODE } from '../mode';
import { useSnapshotViewStore } from '../store';
import type { LoadedSnapshot, SnapshotManifest, SnapshotToolKey } from '../types';
import {
  snapshotSourceNodes,
  useSnapshotBackedAnalysisState,
} from '../useSnapshotBackedAnalysisState';

/**
 * Builds a typed loaded-snapshot fixture for one tool and payload shape.
 * Used by: Vitest setup or assertions in snapshot-view/useSnapshotBackedAnalysisState.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 * Flow: the manifest captures source metadata, then the payload map carries the tool result under the result key.
 */
function snapshotForTool<Payload>(
  tool: SnapshotToolKey,
  payload: Payload,
): LoadedSnapshot<Payload> {
  const manifest: SnapshotManifest = {
    schema_version: 1,
    mode: 'demo',
    tool,
    tool_version: 'v0.5.0',
    captured_at: '2026-05-16T08:00:00Z',
    title: 'fixture',
    source: {
      workspace_id: 'ws-1',
      workspace_name: 'Workspace',
      node_ids: ['node-1'],
      node_labels: ['Node 1'],
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
      searchTerm: 'term',
      totalHits: 1,
      materialised: true,
      displayColumns: ['text'],
    },
    payloads: [{ kind: 'result', path: 'tables/result.parquet' }],
    node_colors: {},
  };

  return {
    manifest,
    capabilities: manifest.capabilities,
    payload,
    sourceProjection: null,
  };
}

describe('useSnapshotBackedAnalysisState', () => {
  beforeEach(() => {
    useSnapshotViewStore.getState().reset();
  });

  it('defaults to live mode with no loaded snapshot', () => {
    const { result } = renderHook(() =>
      useSnapshotBackedAnalysisState('concordance'),
    );

    expect(result.current.snapshotMode).toEqual(LIVE_MODE);
    expect(result.current.loadedSnapshot).toBeNull();
    expect(result.current.inSnapshotMode).toBe(false);
    expect(result.current.readOnly).toBe(false);
  });

  it('enters read-only snapshot mode when the tool has a loaded snapshot', () => {
    const snapshot = snapshotForTool('concordance', { result: ['row'] });

    const { result } = renderHook(() =>
      useSnapshotBackedAnalysisState<typeof snapshot.payload>('concordance'),
    );

    act(() => {
      useSnapshotViewStore
        .getState()
        .loadSnapshot('concordance', snapshot, DEMO_SNAPSHOT_MODE);
    });

    expect(result.current.snapshotMode).toEqual(DEMO_SNAPSHOT_MODE);
    expect(result.current.loadedSnapshot).toBe(snapshot);
    expect(result.current.inSnapshotMode).toBe(true);
    expect(result.current.readOnly).toBe(true);
  });

  it('does not report snapshot mode when a mode is set without a snapshot payload', () => {
    act(() => {
      useSnapshotViewStore.getState().setMode('concordance', DEMO_SNAPSHOT_MODE);
    });

    const { result } = renderHook(() =>
      useSnapshotBackedAnalysisState('concordance'),
    );

    expect(result.current.snapshotMode).toEqual(DEMO_SNAPSHOT_MODE);
    expect(result.current.loadedSnapshot).toBeNull();
    expect(result.current.inSnapshotMode).toBe(false);
    expect(result.current.readOnly).toBe(false);
  });

  it('keeps each tool slice independent', () => {
    const snapshot = snapshotForTool('quotation', { result: ['quote'] });

    act(() => {
      useSnapshotViewStore
        .getState()
        .loadSnapshot('quotation', snapshot, DEMO_SNAPSHOT_MODE);
    });

    const { result } = renderHook(() =>
      useSnapshotBackedAnalysisState('concordance'),
    );

    expect(result.current.snapshotMode).toEqual(LIVE_MODE);
    expect(result.current.loadedSnapshot).toBeNull();
    expect(result.current.inSnapshotMode).toBe(false);
  });

  it('reconstructs source nodes from the captured manifest source', () => {
    const snapshot = snapshotForTool('concordance', { result: ['row'] });
    snapshot.manifest.source = {
      ...snapshot.manifest.source,
      node_ids: ['node-1', 'node-2'],
      node_labels: ['First node', 'Second node'],
      per_block_rows: [8, 12],
      total_source_rows: 20,
    };

    expect(snapshotSourceNodes(snapshot.manifest.source)).toEqual([
      {
        id: 'node-1',
        node_id: 'node-1',
        name: 'First node',
        shape: [8, 0],
      },
      {
        id: 'node-2',
        node_id: 'node-2',
        name: 'Second node',
        shape: [12, 0],
      },
    ]);
  });

  it('falls back to an even source-row split for older manifests', () => {
    const snapshot = snapshotForTool('concordance', { result: ['row'] });
    snapshot.manifest.source = {
      ...snapshot.manifest.source,
      node_ids: ['node-1', 'node-2'],
      node_labels: ['First node'],
      total_source_rows: 21,
    };

    expect(snapshotSourceNodes(snapshot.manifest.source)).toEqual([
      {
        id: 'node-1',
        node_id: 'node-1',
        name: 'First node',
        shape: [10, 0],
      },
      {
        id: 'node-2',
        node_id: 'node-2',
        name: 'node-2',
        shape: [10, 0],
      },
    ]);
  });
});
