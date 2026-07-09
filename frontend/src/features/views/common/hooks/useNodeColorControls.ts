import { useState } from 'react';
import { getNodeIdentifier, type WorkspaceNodeLike } from '../nodeSelectionTypes';
import { VIZ_PALETTE, vizColorMapForNodes } from '../vizPalette';

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

interface NodeColorControlsParams {
  nodeIds: readonly string[];
  nodes: readonly WorkspaceNodeLike[];
  persistNodeColor?: (nodeId: string, color: string) => Promise<unknown> | undefined;
}

const normalizeHexColor = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  return HEX_COLOR_RE.test(value) ? value.toLowerCase() : null;
};

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

/**
 * Adapts persisted workspace-node colours for colour-coded analysis tabs.
 * Used by: token frequency, concordance, and topic modelling because their
 * selected source nodes drive chart/table colours and missing colours must be
 * written to ``Node.color`` before an analysis starts.
 * Flow: derive palette defaults from node order, prefer valid ``node.color``
 * metadata, layer immediate optimistic picks, and expose a run-time guard that
 * posts defaults for selected nodes that still lack a persisted colour.
 */
export function useNodeColorControls({
  nodeIds,
  nodes,
  persistNodeColor,
}: NodeColorControlsParams) {
  const [optimisticNodeColors, setOptimisticNodeColors] = useState<Record<string, string>>({});

  const defaultNodeColors = vizColorMapForNodes(nodeIds);
  const nodeById = new Map(nodes.map((node) => [getNodeIdentifier(node), node] as const));
  const nodeColors = { ...defaultNodeColors };
  nodeIds.forEach((nodeId) => {
    const persisted = normalizeHexColor(nodeById.get(nodeId)?.color);
    const optimistic = optimisticNodeColors[nodeId];
    nodeColors[nodeId] = optimistic ?? persisted ?? nodeColors[nodeId] ?? '#000000';
  });

  const setNodeColor = async (nodeId: string, color: string) => {
    const normalized = normalizeHexColor(color);
    if (!nodeId || !normalized) return;
    setOptimisticNodeColors((prev) =>
      prev[nodeId] === normalized ? prev : { ...prev, [nodeId]: normalized },
    );
    if (persistNodeColor) {
      await Promise.resolve(persistNodeColor(nodeId, normalized)).catch(() => {
        setOptimisticNodeColors((prev) => withoutNodeColor(prev, nodeId));
      });
    }
  };

  const ensureNodeColors = async () => {
    const updates: Promise<void>[] = [];
    nodeIds.forEach((nodeId) => {
      if (!nodeId) return;
      if (normalizeHexColor(nodeById.get(nodeId)?.color) || optimisticNodeColors[nodeId]) {
        return;
      }
      const fallback = defaultNodeColors[nodeId];
      if (!fallback || !persistNodeColor) return;
      setOptimisticNodeColors((prev) =>
        prev[nodeId] === fallback ? prev : { ...prev, [nodeId]: fallback },
      );
      updates.push(
        Promise.resolve(persistNodeColor(nodeId, fallback))
          .then(() => undefined)
          .catch((error: unknown) => {
            setOptimisticNodeColors((prev) => withoutNodeColor(prev, nodeId));
            throw error;
          }),
      );
    });
    await Promise.all(updates);
  };

  return {
    defaultPalette: VIZ_PALETTE,
    nodeColors,
    nodeColorOverrides: nodeColors,
    ensureNodeColors,
    setNodeColor,
  };
}
