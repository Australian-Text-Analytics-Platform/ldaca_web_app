import { isSnapshotMode } from './mode';
import { useSnapshotViewStore, useToolSnapshotMode } from './store';
import type { LoadedSnapshot, SnapshotManifest, SnapshotToolKey, ViewMode } from './types';

export interface SnapshotSourceNode extends Record<string, unknown> {
  id: string;
  node_id: string;
  name: string;
  shape: [number, number];
}

export interface SnapshotBackedAnalysisState<Payload> {
  snapshotMode: ViewMode;
  loadedSnapshot: LoadedSnapshot<Payload> | null;
  inSnapshotMode: boolean;
  readOnly: boolean;
}

export function useSnapshotBackedAnalysisState<Payload>(
  tool: SnapshotToolKey,
): SnapshotBackedAnalysisState<Payload> {
  const snapshotMode = useToolSnapshotMode(tool);
  const loadedSnapshot = useSnapshotViewStore(
    (state) => state.snapshots[tool] ?? null,
  ) as LoadedSnapshot<Payload> | null;
  const inSnapshotMode = isSnapshotMode(snapshotMode) && loadedSnapshot != null;

  return {
    snapshotMode,
    loadedSnapshot,
    inSnapshotMode,
    readOnly: inSnapshotMode,
  };
}

export function snapshotSourceNodes(
  source: SnapshotManifest['source'],
): SnapshotSourceNode[] {
  const { node_ids, node_labels, per_block_rows, total_source_rows } = source;
  const evenSplit =
    node_ids.length > 0 ? Math.floor(total_source_rows / node_ids.length) : 0;

  return node_ids.map((id, index) => ({
    id,
    node_id: id,
    name: node_labels[index] ?? id,
    shape: [per_block_rows?.[index] ?? evenSplit, 0],
  }));
}