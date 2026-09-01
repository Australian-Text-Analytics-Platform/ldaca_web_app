import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
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
 * Used by: annotation, token frequency, concordance, and topic modelling
 * because their selected source nodes drive table/chart colours.
 *
 * Colour model — automatic preview, explicit immediate commit:
 * - A block's durable colour lives on ``Node.color`` (grey / unset until it is
 *   assigned automatically on first analysis or explicitly edited). The graph
 *   card and sidebar row read that persisted property.
 * - When a block is added to a tool's selection it gets a *temporary* colour
 *   (random, non-grey, distinct from its siblings) held only in local
 *   ``preview`` state — so the tool UI shows a pre-filled colour and the user
 *   can preview the result. Deselecting the block discards the temporary colour
 *   (revert). The temporary colour is **not** persisted, so graph/sidebar are
 *   unaffected until a run.
 * - ``ensureNodeColors`` (called just before an analysis runs) commits each
 *   selected block's previewed colour to ``Node.color``, at which point the
 *   graph/sidebar pick it up.
 * - ``setNodeColor`` (the picker) updates the tool optimistically and writes
 *   ``Node.color`` immediately. Explicit colour changes are node metadata
 *   mutations and do not wait for, or block, a later analysis run.
 */
export function useNodeColorControls({
  nodeIds,
  nodes,
  persistNodeColor,
}: NodeColorControlsParams) {
  // Tool-local colours: automatic previews plus optimistic explicit edits.
  const [previewColors, setPreviewColors] = useState<Record<string, string>>({});
  // Tracks colours whose node-property request has already been started. This
  // prevents a later analysis run from submitting the same metadata write.
  const requestedColors = useRef(new Map<string, string>());
  // Native colour inputs can emit several changes quickly. Serialize writes per
  // node so an older response cannot overwrite the user's final choice.
  const colorWriteQueues = useRef(new Map<string, Promise<void>>());

  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  // Preview colour wins in the tool UI; otherwise the persisted colour; else grey.
  const nodeColors: Record<string, string> = {};
  nodeIds.forEach((nodeId) => {
    const persisted = normalizeNodeColor(nodeById.get(nodeId)?.color);
    nodeColors[nodeId] = previewColors[nodeId] ?? persisted ?? GREY;
  });

  const persistColor = (
    nodeId: string,
    color: string,
    reportFailure: boolean,
  ): Promise<void> | null => {
    if (!persistNodeColor) return null;
    requestedColors.current.set(nodeId, color);
    const previousWrite = colorWriteQueues.current.get(nodeId) ?? Promise.resolve();
    const write = previousWrite
      .catch(() => undefined)
      .then(async () => {
        await persistNodeColor(nodeId, color);
      })
      .catch((error: unknown) => {
        if (requestedColors.current.get(nodeId) === color) {
          requestedColors.current.delete(nodeId);
          setPreviewColors((prev) =>
            prev[nodeId] === color ? withoutNodeColor(prev, nodeId) : prev,
          );
          if (reportFailure) {
            toast.error('Could not save the Data Block color.');
          }
        }
        throw error;
      });
    colorWriteQueues.current.set(nodeId, write);
    void write
      .finally(() => {
        if (colorWriteQueues.current.get(nodeId) === write) {
          colorWriteQueues.current.delete(nodeId);
        }
      })
      .catch(() => undefined);
    return write;
  };

  const setNodeColor = (nodeId: string, color: string) => {
    const normalized = normalizeNodeColor(color);
    if (!nodeId || !normalized) return;
    // Show the explicit choice immediately while the node-property request is
    // in flight. A failed latest write removes only its own optimistic value.
    setPreviewColors((prev) =>
      prev[nodeId] === normalized ? prev : { ...prev, [nodeId]: normalized },
    );
    const write = persistColor(nodeId, normalized, true);
    if (write) void write.catch(() => undefined);
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
    setPreviewColors((prev) => {
      const selected = nodeIds.filter(Boolean);
      const selectedSet = new Set(selected);
      const used = new Set<string>();
      selected.forEach((nodeId) => {
        const persisted = normalizeNodeColor(nodeById.get(nodeId)?.color);
        if (persisted) used.add(persisted.toLowerCase());
      });
      const next: Record<string, string> = {};
      // Keep unresolved previews for still-selected blocks. Once the graph
      // reflects a requested colour, its canonical Node.color takes over.
      for (const [nodeId, color] of Object.entries(prev)) {
        if (selectedSet.has(nodeId)) {
          const persisted = normalizeNodeColor(nodeById.get(nodeId)?.color);
          if (persisted === color && requestedColors.current.get(nodeId) === color) {
            requestedColors.current.delete(nodeId);
            continue;
          }
          next[nodeId] = color;
          used.add(color.toLowerCase());
        }
      }
      // Pre-fill a temporary colour for selected blocks that have neither a
      // persisted colour nor a preview yet.
      selected.forEach((nodeId) => {
        if (next[nodeId] || normalizeNodeColor(nodeById.get(nodeId)?.color)) return;
        const requested = requestedColors.current.get(nodeId);
        if (requested) {
          next[nodeId] = requested;
          used.add(requested.toLowerCase());
          return;
        }
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
      // Already persisted or requested by an explicit picker edit — nothing to do.
      if ((persisted && persisted === target) || requestedColors.current.get(nodeId) === target) {
        return;
      }
      const committed = target;
      const write = persistColor(nodeId, committed, false);
      if (write) updates.push(write);
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
