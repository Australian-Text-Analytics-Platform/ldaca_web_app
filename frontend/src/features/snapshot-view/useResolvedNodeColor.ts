/**
 * ``useResolvedNodeColor(tool, nodeId)`` — read the rendered colour
 * for a node, dispatching by the tool's view mode.
 *
 * In live mode the colour comes from the global
 * ``useNodeColorsStore`` (which is also persisted via the workspace
 * ``ui_state`` sidecar). In snapshot mode it comes from the loaded
 * snapshot's frozen ``node_colors`` map. The two are kept strictly
 * separated: a snapshot view must NOT write back into the live
 * colours store — that would silently mutate the host workspace's
 * colours when the user is just inspecting a snapshot.
 *
 * Per-tool dispatch (rather than a global mode) lets one tool sit in
 * snapshot view while another is live, which is supported by the
 * store design.
 */
import { useNodeColorsStore } from '@/stores/nodeColorsStore';
import { isSnapshotMode } from './mode';
import { useSnapshotViewStore } from './store';
import type { SnapshotToolKey } from './types';

/** Return the rendered colour for ``nodeId`` in ``tool``'s view, or
 * ``undefined`` if no colour is assigned. Subscribes to whichever
 * store is the source of truth so the component re-renders when the
 * colour changes (live mode) or when the snapshot is swapped
 * (snapshot mode).  * Used by: index module, useResolvedNodeColor tests (rg call sites/imports).
 * Why: because snapshot graph rendering needs captured source colors when live workspace color state is unavailable.
 */
export function useResolvedNodeColor(
  tool: SnapshotToolKey,
  nodeId: string,
): string | undefined {
  const mode = useSnapshotViewStore((s) => s.mode[tool]);
  const snapshot = useSnapshotViewStore((s) => s.snapshots[tool]);
  const liveColor = useNodeColorsStore((s) => s.colors[nodeId]);

  if (mode && isSnapshotMode(mode)) {
    return snapshot?.manifest.node_colors[nodeId];
  }
  return liveColor;
}
