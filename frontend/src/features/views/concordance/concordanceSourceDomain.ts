import { CONCORDANCE_COMBINED_NODE_KEY, toCellText } from './concordanceTableDomain';

interface ConcordanceNodeIdentity {
  id: string;
  name: string;
}

/** Cycles a palette with one explicit empty-palette policy at the caller. */
const cyclePalette = (palette: readonly string[], index: number, emptyColor: string): string =>
  palette.reduce(
    (selected, color, paletteIndex) => (paletteIndex === index % palette.length ? color : selected),
    emptyColor,
  );

/**
 * Assigns visual colours to each selected concordance node id variant.
 * Used by: useConcordanceResultSession and metadata-column grouping because
 * combined result rows should resolve the selected node id to the same source
 * colour across table and dispersion views.
 * Flow: start from deterministic palette colours by selected-node order, then
 * apply the effective ``Node.color`` map supplied by the selected-node controls.
 */
export function buildConcordanceNodeColorMap(
  nodes: readonly ConcordanceNodeIdentity[],
  palette: readonly string[],
  nodeColorOverrides: Record<string, string> = {},
): Record<string, string> {
  const map: Record<string, string> = {};
  if (palette.length === 0) return map;

  nodes.forEach((node, index) => {
    const nodeId = typeof node.id === 'string' && node.id.length > 0 ? node.id : null;
    if (!nodeId) return;
    const override = nodeColorOverrides[nodeId];
    const colour = override ?? cyclePalette(palette, index, '');
    map[nodeId] = colour;
  });
  return map;
}

/**
 * Builds the lower-case label lookup used to colour combined-result table rows.
 * Used by: useConcordanceResultSession so canonical source names and ids
 * share the same palette assignment.
 */
export function buildConcordanceSourceColorMap(
  nodes: readonly ConcordanceNodeIdentity[],
  nodeColors: Record<string, string>,
  palette: readonly string[],
): Record<string, string> {
  const map: Record<string, string> = {};

  nodes.forEach((node, index) => {
    const primaryId =
      typeof node.id === 'string' && node.id.length > 0 ? node.id : `node-${String(index)}`;
    const assigned = nodeColors[primaryId] ?? cyclePalette(palette, index, '');
    if (!assigned) return;
    const variants = new Set<string>([primaryId, node.name]);

    variants.forEach((value) => {
      const trimmed = value.trim();
      if (trimmed) map[trimmed.toLowerCase()] = assigned;
    });
  });

  return map;
}

/**
 * Finds the selected source node represented by a rendered combined-result label.
 * Used by: Concordance table and dispersion blocks when a combined-view row is
 * clicked, because those rows carry a source label rather than the stable
 * workspace node id needed to open row details.
 */
export function findConcordanceSourceNode<T extends ConcordanceNodeIdentity>(
  nodes: readonly T[],
  sourceLabel: unknown,
): T | undefined {
  if (!sourceLabel) return undefined;

  const normalizedSource = toCellText(sourceLabel).toLowerCase();
  if (!normalizedSource) return undefined;

  return nodes.find((node) => {
    const candidates = [node.id, node.name].filter(Boolean).map((value) => value.toLowerCase());
    return candidates.includes(normalizedSource);
  });
}

/**
 * Resolves the row background colour for a combined concordance source label.
 * Used by: Concordance table and dispersion blocks so exact map lookup, loose
 * fallback lookup, and deterministic palette fallback stay identical across
 * table and chart-oriented result views.
 */
export function getConcordanceSourceColor(
  sourceLabel: unknown,
  sourceColorMap: Record<string, string>,
  defaultPalette: readonly string[],
): string {
  if (!sourceLabel) return '#ffffff';

  const labelText = toCellText(sourceLabel);
  const normalized = labelText.toLowerCase();
  const exact = sourceColorMap[normalized];
  if (exact) return exact;

  const looseMatch = Object.entries(sourceColorMap).find(([key]) => key.includes(normalized));
  if (looseMatch?.[1]) return looseMatch[1];

  if (defaultPalette.length === 0) return '#ffffff';
  const hash = Array.from(labelText).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return cyclePalette(defaultPalette, hash, '#ffffff');
}

/**
 * Resolves a rendered concordance result key back to a backend node id.
 * Used by: ConcordanceFeature and result projection helpers because result
 * blocks can be keyed by canonical node id,
 * canonical node name, or a request-provided label-to-node map.
 */
export function resolveConcordanceNodeIdForKey(
  nodeKey: string,
  selectedNodes: ConcordanceNodeIdentity[],
  labelToNodeId: Record<string, string> | null,
): string | null {
  if (nodeKey === CONCORDANCE_COMBINED_NODE_KEY) return null;
  const direct = selectedNodes.find((node) => {
    return node.id === nodeKey || node.name === nodeKey;
  });
  if (direct?.id) return direct.id;
  const mapped = labelToNodeId?.[nodeKey];
  return mapped ?? null;
}

/**
 * Binds one separated result block to its canonical selected node and column.
 * Used by: ConcordanceResultsPanel so result-object order never becomes an
 * implicit node identity contract. Unknown keys deliberately remain unbound;
 * the panel may still use their raw key for display and pagination only.
 */
export function resolveConcordanceResultBlock<T extends ConcordanceNodeIdentity>(
  nodeKey: string,
  selectedNodes: T[],
  selections: { nodeId: string; column: string }[],
  labelToNodeId: Record<string, string> | null,
): { node: T | undefined; nodeId: string; column: string } {
  const resolvedNodeId = resolveConcordanceNodeIdForKey(nodeKey, selectedNodes, labelToNodeId);
  const node = resolvedNodeId
    ? selectedNodes.find((candidate) => candidate.id === resolvedNodeId)
    : undefined;
  if (!node) return { node: undefined, nodeId: '', column: '' };

  const column = selections.find((selection) => selection.nodeId === node.id)?.column ?? '';
  return { node, nodeId: node.id, column };
}
