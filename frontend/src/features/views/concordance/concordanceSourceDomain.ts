import type { ConcordanceDispersionBinRow, ConcordanceNodeResult } from '@/api';
import { CONCORDANCE_COLUMN_KEYS } from '../common/generatedColumns';
import type { TaggedBinRow } from './concordanceDispersionDomain';
import { CONCORDANCE_COMBINED_NODE_KEY, toCellText } from './concordanceTableDomain';

interface ConcordanceNodeIdentity {
  id: string;
  name: string;
}

interface ConcordanceMaterializedLookupOptions {
  selectedNodes: ConcordanceNodeIdentity[];
  labelToNodeId: Record<string, string> | null;
  materializedPaths: Record<string, string>;
  materializedBins?: Record<string, ConcordanceDispersionBinRow[]>;
}

/** Cycles a palette with one explicit empty-palette policy at the caller. */
const cyclePalette = (palette: readonly string[], index: number, emptyColor: string): string =>
  palette.reduce(
    (selected, color, paletteIndex) => (paletteIndex === index % palette.length ? color : selected),
    emptyColor,
  );

/**
 * Normalizes backend `analysis_params.label_to_node_map` into a strict
 * label->node-id map.
 * Used by: useConcordanceResultSession before rendering result blocks because
 * the generated API type keeps analysis params loose while downstream lookup
 * helpers need only valid string pairs.
 */
export function normalizeConcordanceLabelToNodeMap(
  analysisParams: unknown,
): Record<string, string> | null {
  if (!analysisParams || typeof analysisParams !== 'object') return null;
  const params = analysisParams as Record<string, unknown>;
  const mapping = params.label_to_node_map;
  if (!mapping || typeof mapping !== 'object') return null;

  const normalized: Record<string, string> = {};
  for (const [label, value] of Object.entries(mapping)) {
    if (typeof label === 'string' && label && typeof value === 'string' && value) {
      normalized[label] = value;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

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
 * Used by: ConcordanceFeature, metadata-column derivation, and materialized
 * dispersion helpers because result blocks can be keyed by canonical node id,
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

/**
 * Resolves a rendered concordance result block to every source node id behind it.
 * Used by: ConcordanceFeature and materialized dispersion helpers so the
 * combined view can require/process all backing nodes while separated blocks
 * target only their own source node.
 */
export function getConcordanceNodeIdsForKey(
  nodeKey: string,
  selectedNodes: ConcordanceNodeIdentity[],
  labelToNodeId: Record<string, string> | null,
): string[] {
  if (nodeKey === CONCORDANCE_COMBINED_NODE_KEY) {
    return selectedNodes.map((node) => node.id).filter((id): id is string => Boolean(id));
  }
  const id = resolveConcordanceNodeIdForKey(nodeKey, selectedNodes, labelToNodeId);
  return id ? [id] : [];
}

/**
 * Reports whether a result block has materialized paths for every backing node.
 * Used by: Concordance table and dispersion blocks to decide whether
 * whole-corpus paging/bins are available for a separated or combined result.
 */
export function isConcordanceBlockMaterialized(
  nodeKey: string,
  { selectedNodes, labelToNodeId, materializedPaths }: ConcordanceMaterializedLookupOptions,
): boolean {
  const ids = getConcordanceNodeIdsForKey(nodeKey, selectedNodes, labelToNodeId);
  return ids.length > 0 && ids.every((id) => id in materializedPaths);
}

/**
 * Combines cached server-bin rows for every materialized node behind a result block.
 * Used by: ConcordanceFeature before rendering dispersion charts because
 * combined-view charts need one tagged row stream while separated charts still
 * need the same all-nodes-present guard.
 */
export function getMaterializedBinsForConcordanceKey(
  nodeKey: string,
  {
    selectedNodes,
    labelToNodeId,
    materializedPaths,
    materializedBins = {},
  }: ConcordanceMaterializedLookupOptions,
): TaggedBinRow[] | undefined {
  const ids = getConcordanceNodeIdsForKey(nodeKey, selectedNodes, labelToNodeId);
  if (ids.length === 0) return undefined;
  if (!ids.every((id) => id in materializedPaths)) return undefined;
  if (!ids.every((id) => id in materializedBins)) return undefined;

  const tagged: TaggedBinRow[] = [];
  for (const id of ids) {
    const node = selectedNodes.find((entry) => entry.id === id);
    const sourceLabel = node?.name ?? id;
    const bins = materializedBins[id];
    if (!bins) continue;
    for (const row of bins) {
      tagged.push({ ...row, __source_node: sourceLabel });
    }
  }
  return tagged;
}

export interface CollectConcordanceMatchedTextsOptions {
  getMaterializedBinsForKey: (nodeKey: string) => TaggedBinRow[] | undefined;
  lowercaseMatches: boolean;
}

/**
 * Collects the unique matched-text series names used by coloured dispersion charts.
 * Used by: ConcordanceFeature because the feature shell needs one tested helper
 * to derive chart series from either cached server bins or the current page's
 * raw concordance rows before assigning stable colours.
 *
 * Flow:
 * - Walk each result block in display order.
 * - Prefer materialized server-bin rows when available so whole-corpus charts
 *   and current-page charts label series the same way.
 * - Fall back to grouped page rows for non-materialized results, normalize
 *   case according to the active concordance setting, and return sorted unique
 *   labels for deterministic colour assignment.
 */
export function collectConcordanceMatchedTexts(
  resultsData: Record<string, ConcordanceNodeResult> | undefined,
  { getMaterializedBinsForKey, lowercaseMatches }: CollectConcordanceMatchedTextsOptions,
): string[] {
  if (!resultsData) return [];

  const seen = new Set<string>();
  for (const [nodeKey, nodeData] of Object.entries(resultsData)) {
    const binRows = getMaterializedBinsForKey(nodeKey);
    if (binRows) {
      for (const row of binRows) {
        const rawText = row.matched_text ?? '';
        if (rawText) seen.add(lowercaseMatches ? rawText.toLowerCase() : rawText);
      }
      continue;
    }

    for (const group of nodeData.data) {
      for (const hit of group) {
        const rawText = toCellText(hit[CONCORDANCE_COLUMN_KEYS.matchedText]);
        if (rawText) seen.add(lowercaseMatches ? rawText.toLowerCase() : rawText);
      }
    }
  }

  return [...seen].sort();
}

/**
 * Assigns stable colours to matched-text series by cycling through a palette.
 * Used by: ConcordanceFeature so chart and row-rendering surfaces receive the
 * same text-to-colour lookup without duplicating palette logic in the feature
 * component.
 */
export function buildMatchedTextColorMap(
  matchedTexts: readonly string[],
  palette: readonly string[],
): Record<string, string> {
  if (palette.length === 0) return {};

  return Object.fromEntries(
    matchedTexts.map((text, index) => [text, cyclePalette(palette, index, '')]),
  );
}
