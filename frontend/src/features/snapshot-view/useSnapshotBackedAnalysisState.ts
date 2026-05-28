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

/**
 * Combines per-tool mode and loaded payload into the read-only state consumed
 * by analysis features that can render from snapshots.
 * Used by: store module, index module, QuotationFeature module (rg call sites/imports) because snapshot-aware features need a single live/demo state adapter.
 * Flow: read the tool mode, select the matching loaded payload, require both snapshot mode and payload before marking the feature read-only.
 */
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

/**
 * Reconstructs source-node cards from manifest metadata for snapshot views.
 * Used by: index module, useSnapshotBackedAnalysisState tests, ConcordanceFeature module (rg call sites/imports) because frozen manifests must supply the node cards normally read from live workspace data.
 * Flow: derive an even row-count fallback, pair manifest node ids with labels and per-block rows, then emit node-like records for snapshot-only panels.
 */
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