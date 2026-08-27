import { useEffect, useState } from 'react';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { normalizeNodeColor } from '@/lib/nodeColor';
import { GREY, VIZ_PALETTE, pickRandomColor } from '../vizPalette';

interface NodeColorControlsParams {
  nodeIds: readonly string[];
  nodes: readonly WorkspaceNodeMetadata[];
  persistNodeColor?: (nodeId: string, color: string) => Promise<unknown> | undefined;
}

const withoutNodeColor = (
  colors: Record<string, string>,
  nodeId: string,
): Record<string, string> => {
  const next: Record<string, string> = {};
  for (const [candidateId, color] of Object.entries(colors)) {
    if (candidateId !== nodeId) next[candidateId] = color;
  }
  return next;
};

const sameColorMap = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && bKeys.every((key) => a[key] === b[key]);
};

/**
 * Adapts workspace-node colours for colour-coded analysis tabs.
 * Used by: token frequency, concordance, and topic modelling because their
 * selected source nodes drive chart/table colours.
 *
 * Colour model — preview then commit:
 * - A block's durable colour lives on ``Node.color`` (grey / unset until it has
 *   been through an analysis). The graph card and sidebar row read that, so an
 *   un-analysed block stays grey there.
 * - When a block is added to a tool's selection it gets a *temporary* colour
 *   (random, non-grey, distinct from its siblings) held only in local
 *   ``preview`` state — so the tool UI shows a pre-filled colour and the user
 *   can preview the result. Deselecting the block discards the temporary colour
 *   (revert). The temporary colour is **not** persisted, so graph/sidebar are
 *   unaffected until a run.
 * - ``ensureNodeColors`` (called just before an analysis runs) commits each
 *   selected block's previewed colour to ``Node.color``, at which point the
 *   graph/sidebar pick it up.
 * - ``setNodeColor`` (the picker) also stays a preview edit — it updates the
 *   temporary colour and commits on the next run.
 */
export function useNodeColorControls({
  nodeIds,
  nodes,
  persistNodeColor,
}: NodeColorControlsParams) {
  // Temporary, not-yet-persisted preview colours, keyed by node id.
  const [previewColors, setPreviewColors] = useState<Record<string, string>>({});

  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  // Preview colour wins in the tool UI; otherwise the persisted colour; else grey.
  const nodeColors: Record<string, string> = {};
  nodeIds.forEach((nodeId) => {
    const persisted = normalizeNodeColor(nodeById.get(nodeId)?.color);
    nodeColors[nodeId] = previewColors[nodeId] ?? persisted ?? GREY;
  });

  const setNodeColor = (nodeId: string, color: string) => {
    const normalized = normalizeNodeColor(color);
    if (!nodeId || !normalized) return;
    // Preview edit only; committed to Node.color on the next run.
    setPreviewColors((prev) =>
      prev[nodeId] === normalized ? prev : { ...prev, [nodeId]: normalized },
    );
  };

  // Signature of the selection + each block's persisted colour. Changes when a
  // block is added/removed or a colour is committed, but NOT when only the
  // preview map changes — so reconciliation runs once per selection change
  // without looping.
  const selectionSignature = nodeIds
    .map((nodeId) => `${nodeId}:${normalizeNodeColor(nodeById.get(nodeId)?.color) ?? ''}`)
    .join('|');

  // Reconcile the preview map with the current selection: keep previews for
  // still-selected blocks, drop them for deselected ones (revert), and pre-fill
  // a temporary colour for any newly-selected block that has none. No
  // persistence happens here — this only feeds the tool UI.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate sync: reconcile the temporary preview map with the selection; guarded by sameColorMap so it settles in one pass and never loops.
    setPreviewColors((prev) => {
      const selected = nodeIds.filter(Boolean);
      const selectedSet = new Set(selected);
      const used = new Set<string>();
      selected.forEach((nodeId) => {
        const persisted = normalizeNodeColor(nodeById.get(nodeId)?.color);
        if (persisted) used.add(persisted.toLowerCase());
      });
      const next: Record<string, string> = {};
      // Keep existing previews (auto or user-picked) for still-selected blocks.
      for (const [nodeId, color] of Object.entries(prev)) {
        if (selectedSet.has(nodeId)) {
          next[nodeId] = color;
          used.add(color.toLowerCase());
        }
      }
      // Pre-fill a temporary colour for selected blocks that have neither a
      // persisted colour nor a preview yet.
      selected.forEach((nodeId) => {
        if (next[nodeId] || normalizeNodeColor(nodeById.get(nodeId)?.color)) return;
        const color = pickRandomColor(used);
        used.add(color.toLowerCase());
        next[nodeId] = color;
      });
      return sameColorMap(prev, next) ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectionSignature captures the meaningful inputs (selected ids + their persisted colours); depending on nodeById/previewColors would re-run every render.
  }, [selectionSignature]);

  const ensureNodeColors = async () => {
    if (!persistNodeColor) return;
    const persist = persistNodeColor;
    const used = new Set<string>();
    nodeIds.forEach((nodeId) => {
      const existing = normalizeNodeColor(nodeById.get(nodeId)?.color) ?? previewColors[nodeId];
      if (existing) used.add(existing.toLowerCase());
    });
    const updates: Promise<void>[] = [];
    nodeIds.forEach((nodeId) => {
      if (!nodeId) return;
      const persisted = normalizeNodeColor(nodeById.get(nodeId)?.color);
      // Use the colour the user previewed, or allocate one if a run happens
      // before the preview effect settles.
      let target = previewColors[nodeId] ?? persisted;
      if (!target) {
        const allocated = pickRandomColor(used);
        target = allocated;
        setPreviewColors((prev) =>
          prev[nodeId] === allocated ? prev : { ...prev, [nodeId]: allocated },
        );
      }
      used.add(target.toLowerCase());
      // Already committed with this exact colour — nothing to do.
      if (persisted && persisted === target) return;
      const committed = target;
      updates.push(
        Promise.resolve(persist(nodeId, committed))
          .then(() => undefined)
          .catch((error: unknown) => {
            setPreviewColors((prev) => withoutNodeColor(prev, nodeId));
            throw error;
          }),
      );
    });
    await Promise.all(updates);
  };

  return {
    defaultPalette: VIZ_PALETTE,
    nodeColors,
    ensureNodeColors,
    setNodeColor,
  };
}
