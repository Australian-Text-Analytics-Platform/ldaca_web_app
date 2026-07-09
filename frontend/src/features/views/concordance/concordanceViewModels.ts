import type { ConcordanceDispersionBinRow, ConcordanceNodeResult } from '@/api';
import { CONCORDANCE_COLUMN_KEYS, CONCORDANCE_CORE_COLUMNS } from '../common/generatedColumns';

type ConcordanceHitRow = Record<string, unknown>;
type ConcordanceGroupedRow = ConcordanceHitRow[];

export type ConcordanceDispersionRow = Record<string, unknown> & {
  CONC_dispersion: ConcordanceGroupedRow;
};

const CORE_COLUMN_SET = new Set<string>(CONCORDANCE_CORE_COLUMNS);

/** Normalizes concordance offsets that may arrive from local rows or server JSON. */
/**
 * Called by: concordanceViewModels analysis helper module as a local helper in this analysis workflow.
 */
const getNumericIndex = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : Math.max(0, parsed);
  }
  return null;
};

/**
 * Coerce an unknown concordance cell value to a display string.
 *
 * Behaves exactly like the historical ``String(value ?? '')`` call sites
 * (null/undefined → '', primitives stringified) but keeps the result typed as
 * ``string`` so the strict template/stringification lints pass. The cast is to
 * a primitive union, so runtime coercion is byte-identical to the old code for
 * every input — concordance cells are scalars in practice.
 *
 * Used by: ConcordanceDispersionCell.tsx, ConcordanceDispersionNodeBlock.tsx,
 * ConcordanceTableNodeBlock.tsx and this module because every hit/metadata cell
 * renders an unknown Polars value as text.
 */
export const toCellText = (value: unknown): string =>
  String((value as string | number | boolean | null | undefined) ?? '');

/** Flattens grouped concordance hits for the standard table-oriented view. */
/**
 * Used by: concordanceViewModels.test.ts, ConcordanceTableNodeBlock.tsx.
 */
export function flattenConcordanceGroups(groups: ConcordanceGroupedRow[]): ConcordanceHitRow[] {
  return groups.flatMap((group) => group);
}

/**
 * Synthesizes the client-side "combined" concordance view from two per-node
 * result slices. Replaces the former backend ``collect_interleaved_combined``
 * helper: the backend now only ever returns per-node slices, and the Combined
 * layout is composed entirely on the frontend.
 *
 * Used by: useConcordanceViewModeSwap because entering Combined view (or paging
 * within it) fetches both nodes at the same page and folds them into a single
 * ``__COMBINED__`` block.
 *
 * Flow:
 * - Interleave the two slices' grouped rows left/right (alternating, with the
 *   longer side's leftover rows appended in order). Rows already carry
 *   ``__source_node`` so the table can colour each hit by origin.
 * - Union the column lists (dedupe, left order first) and recompute the
 *   concordance/metadata column split from the core-column set.
 * - Pagination spans the larger of the two nodes: ``total_source_*`` use max(),
 *   ``has_next``/``has_prev`` derive from the shared page, and ``result_count``
 *   is the interleaved row count.
 */
export function buildCombinedSlice(
  leftSlice: ConcordanceNodeResult,
  rightSlice: ConcordanceNodeResult,
  page: number,
  pageSize: number,
): ConcordanceNodeResult {
  const leftRows = leftSlice.data;
  const rightRows = rightSlice.data;

  const interleaved: ConcordanceNodeResult['data'] = [];
  let li = 0;
  let ri = 0;
  let useLeft = true;
  while (li < leftRows.length || ri < rightRows.length) {
    if (useLeft) {
      const leftRow = leftRows[li];
      if (leftRow !== undefined) {
        interleaved.push(leftRow);
        li += 1;
      } else {
        const rightRow = rightRows[ri];
        if (rightRow !== undefined) {
          interleaved.push(rightRow);
          ri += 1;
          useLeft = !useLeft;
          continue;
        }
        break;
      }
    } else {
      const rightRow = rightRows[ri];
      if (rightRow !== undefined) {
        interleaved.push(rightRow);
        ri += 1;
      } else {
        const leftRow = leftRows[li];
        if (leftRow !== undefined) {
          interleaved.push(leftRow);
          li += 1;
          useLeft = !useLeft;
          continue;
        }
        break;
      }
    }
    useLeft = !useLeft;
  }

  const leftColumns = leftSlice.columns;
  const rightColumns = rightSlice.columns;
  let columns: string[] = leftColumns.length > 0 ? leftColumns : rightColumns;
  if (leftColumns.length > 0 && rightColumns.length > 0) {
    columns = Array.from(new Set([...leftColumns, ...rightColumns]));
  }

  const leftPag = leftSlice.pagination;
  const rightPag = rightSlice.pagination;
  const totalSourceRows = Math.max(leftPag.total_source_rows, rightPag.total_source_rows);
  const totalSourcePages = Math.max(leftPag.total_source_pages, rightPag.total_source_pages);
  const resolvedPageSize = leftPag.page_size || rightPag.page_size || pageSize;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty-string sort_by means "unsorted" and must fall back to the other node, then null
  const effectiveSortBy = leftSlice.sorting.sort_by || rightSlice.sorting.sort_by || null;

  return {
    data: interleaved,
    columns,
    metadata: {
      concordance_columns: columns.filter((c) => CORE_COLUMN_SET.has(c)),
      metadata_columns: columns.filter((c) => !CORE_COLUMN_SET.has(c)),
      all_columns: columns,
    },
    pagination: {
      page,
      page_size: resolvedPageSize,
      total_source_rows: totalSourceRows,
      total_source_pages: totalSourcePages,
      result_count: interleaved.length,
      has_next: page < totalSourcePages,
      has_prev: page > 1,
    },
    sorting: {
      sort_by: effectiveSortBy,
      descending: leftSlice.sorting.descending,
    },
  };
}

/** Converts hit groups into one dispersion row per source document for chart consumers. */
/**
 * Used by: concordanceViewModels.test.ts, ConcordanceDispersionNodeBlock.tsx.
 */
export function buildDispersionRows(groups: ConcordanceGroupedRow[]): ConcordanceDispersionRow[] {
  return groups.flatMap((group) => {
    if (group.length === 0) {
      return [];
    }

    const firstHit = group[0];
    if (firstHit === undefined) {
      return [];
    }
    const metadataEntries = Object.entries(firstHit).filter(([key]) => !CORE_COLUMN_SET.has(key));
    return [
      {
        ...Object.fromEntries(metadataEntries),
        [CONCORDANCE_COLUMN_KEYS.dispersion]: group,
      },
    ];
  });
}

/** Reads the hidden grouped-hit payload that powers dispersion table cells and charts. */
/**
 * Used by: ConcordanceDispersionNodeBlock.tsx.
 */
export function getDispersionHits(row: Record<string, unknown>): ConcordanceGroupedRow {
  return row[CONCORDANCE_COLUMN_KEYS.dispersion] as ConcordanceGroupedRow;
}

/** Chooses the source text length used to scale dispersion positions for a row. */
/**
 * Used by: ConcordanceDispersionNodeBlock.tsx.
 */
export function getDispersionTextLength(row: Record<string, unknown>, textColumn: string): number {
  const textValue = row[textColumn];
  if (typeof textValue === 'string') {
    return textValue.length;
  }

  return getDispersionHits(row).reduce((max, hit) => {
    const endIndex = getNumericIndex(hit[CONCORDANCE_COLUMN_KEYS.endIdx]);
    return endIndex === null ? max : Math.max(max, endIndex);
  }, 0);
}

/** Scales a document's dispersion bar relative to the longest displayed source text. */
/**
 * Used by: concordanceViewModels.test.ts, ConcordanceDispersionNodeBlock.tsx.
 */
export function getDispersionBarWidthPercent(
  row: Record<string, unknown>,
  textColumn: string,
  longestTextLength: number,
): number {
  if (longestTextLength <= 0) {
    return 100;
  }

  const textLength = getDispersionTextLength(row, textColumn);
  if (textLength <= 0) {
    return 0;
  }

  return Math.min(100, (textLength / longestTextLength) * 100);
}

/**
 * Delimiter used inside binned-series keys to combine matched-text with a
 * source-node identifier. Chosen because NUL is never present in normal text.
 */
export const DISPERSION_SOURCE_DELIMITER = '\0';

type DispersionBinDatum = {
  binCenter: number;
} & Record<string, number>;

export interface BuildDispersionBinsOptions {
  lowercaseMatches?: boolean;
  splitBySource?: boolean;
  /**
   * When true, all hits collapse into a single aggregate series rather than
   * being split per matched-text. Used when the user has not enabled "Colour
   * matches" — the plot shows a single overall distribution line.
   */
  aggregateAll?: boolean;
}

/** Series key used when {@link BuildDispersionBinsOptions.aggregateAll} is true. */
export const DISPERSION_AGGREGATE_KEY = '__dispersion_total__';

/**
 * Make sure every bin has an explicit entry for every series key encountered.
 * Recharts' default behaviour treats missing keys as null, so a line with gaps
 * would visually skip empty bins instead of dropping to zero.
 */
/**
 * Called by: concordanceViewModels analysis helper module during this analysis workflow.
 */
const fillEmptyBins = (bins: DispersionBinDatum[], totalsByKey: Record<string, number>): void => {
  const keys = Object.keys(totalsByKey);
  for (const bin of bins) {
    for (const key of keys) {
      bin[key] ??= 0;
    }
  }
};

export interface BuildDispersionBinsResult {
  bins: DispersionBinDatum[];
  totalsByKey: Record<string, number>;
  sources: string[];
}

/** Builds normalized hit-count bins from raw grouped rows for client-side previews. */
/**
 * Used by: ConcordanceDispersionSummary.tsx.
 * Flow: normalize raw analysis values, apply filtering or mapping rules, then return the view model consumed by components or tests.
 */
export function buildDispersionBins(
  rows: ConcordanceDispersionRow[],
  textColumn: string,
  binCount: number,
  options: BuildDispersionBinsOptions = {},
): BuildDispersionBinsResult {
  const { lowercaseMatches = false, splitBySource = false, aggregateAll = false } = options;
  const safeBinCount = Math.max(1, Math.floor(binCount));
  const bins: DispersionBinDatum[] = Array.from({ length: safeBinCount }, (_, i) => ({
    binCenter: ((i + 0.5) / safeBinCount) * 100,
  }));
  const totalsByKey: Record<string, number> = {};
  const sourceSet = new Set<string>();
  if (aggregateAll) totalsByKey[DISPERSION_AGGREGATE_KEY] = 0;

  for (const row of rows) {
    const docLength = getDispersionTextLength(row, textColumn);
    if (docLength <= 0) continue;
    const rowSource = toCellText(row.__source_node);
    const hits = getDispersionHits(row);
    for (const hit of hits) {
      const startIdx = getNumericIndex(hit[CONCORDANCE_COLUMN_KEYS.startIdx]);
      if (startIdx === null) continue;
      const ratio = Math.min(0.99999, startIdx / docLength);
      const binIdx = Math.min(safeBinCount - 1, Math.max(0, Math.floor(ratio * safeBinCount)));
      const rawText = toCellText(hit[CONCORDANCE_COLUMN_KEYS.matchedText]);
      if (!rawText) continue;
      const text = lowercaseMatches ? rawText.toLowerCase() : rawText;
      const source = rowSource || toCellText(hit.__source_node);
      if (source) sourceSet.add(source);
      const baseKey = aggregateAll ? DISPERSION_AGGREGATE_KEY : text;
      const seriesKey =
        splitBySource && source ? `${baseKey}${DISPERSION_SOURCE_DELIMITER}${source}` : baseKey;
      const bin = bins[binIdx];
      if (bin === undefined) continue;
      bin[seriesKey] = (bin[seriesKey] ?? 0) + 1;
      totalsByKey[seriesKey] = (totalsByKey[seriesKey] ?? 0) + 1;
    }
  }

  fillEmptyBins(bins, totalsByKey);
  return { bins, totalsByKey, sources: [...sourceSet].sort() };
}

/**
 * Server-side bin row tagged with the source node it came from. The frontend
 * combines per-node responses for combined-view display.
 */
export type TaggedBinRow = ConcordanceDispersionBinRow & {
  __source_node?: string;
};

export const CONCORDANCE_COMBINED_NODE_KEY = '__COMBINED__';

interface ConcordanceNodeIdentity {
  id?: string;
  node_id?: string;
  name?: string;
  label?: string;
  data?: unknown;
}

interface ConcordanceMaterializedLookupOptions {
  selectedNodes: ConcordanceNodeIdentity[];
  labelToNodeId: Record<string, string> | null;
  materializedPaths: Record<string, string>;
  materializedBins?: Record<string, ConcordanceDispersionBinRow[]>;
}

/**
 * Normalizes backend `analysis_params.label_to_node_map` into a strict
 * label->node-id map.
 * Used by: useConcordanceResultViewModel before rendering result blocks because
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
 * Used by: useConcordanceResultViewModel and metadata-column grouping because
 * combined result rows can refer to either `id` or `node_id`, and both variants
 * should resolve to the same source colour.
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
    const candidateIds = [node.id, node.node_id].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    const override = candidateIds.map((candidate) => nodeColorOverrides[candidate]).find(Boolean);
    const colour = override ?? palette[index % palette.length] ?? '';
    for (const candidate of candidateIds) {
      map[candidate] = colour;
    }
  });
  return map;
}

const getNodeDataLabelCandidates = (node: ConcordanceNodeIdentity): string[] => {
  const data =
    typeof node.data === 'object' && node.data !== null
      ? (node.data as Record<string, unknown>)
      : undefined;
  return [data?.name, data?.label].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
};

/**
 * Builds the lower-case label lookup used to colour combined-result table rows.
 * Used by: useConcordanceResultViewModel so source-label, id, node_id, and
 * nested node metadata aliases all share the same palette assignment.
 */
export function buildConcordanceSourceColorMap(
  nodes: readonly ConcordanceNodeIdentity[],
  nodeColors: Record<string, string>,
  palette: readonly string[],
): Record<string, string> {
  const map: Record<string, string> = {};

  nodes.forEach((node, index) => {
    const candidateIds = [node.id, node.node_id].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    const primaryId = candidateIds[0] ?? `node-${String(index)}`;
    const assigned = nodeColors[primaryId] ?? palette[index % palette.length] ?? '';
    const variants = new Set<string>([
      primaryId,
      ...candidateIds,
      ...(typeof node.name === 'string' ? [node.name] : []),
      ...(typeof node.label === 'string' ? [node.label] : []),
      ...getNodeDataLabelCandidates(node),
    ]);

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
    const data =
      typeof node.data === 'object' && node.data !== null
        ? (node.data as Record<string, unknown>)
        : undefined;
    const dataName = typeof data?.name === 'string' ? data.name : undefined;
    const dataLabel = typeof data?.label === 'string' ? data.label : undefined;
    const candidates = [node.id, node.node_id, node.name, dataName, node.label, dataLabel]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
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
  return defaultPalette[hash % defaultPalette.length] ?? '#ffffff';
}

/**
 * Resolves a rendered concordance result key back to a backend node id.
 * Used by: ConcordanceFeature, metadata-column derivation, and materialized
 * dispersion helpers because result blocks can be keyed by node id, node name,
 * backend label, or a request-provided label-to-node map.
 */
export function resolveConcordanceNodeIdForKey(
  nodeKey: string,
  selectedNodes: ConcordanceNodeIdentity[],
  labelToNodeId: Record<string, string> | null,
): string | null {
  if (nodeKey === CONCORDANCE_COMBINED_NODE_KEY) return null;
  const direct = selectedNodes.find((node) => {
    const data =
      typeof node.data === 'object' && node.data !== null
        ? (node.data as Record<string, unknown>)
        : undefined;
    const dataName = typeof data?.name === 'string' ? data.name : undefined;
    return (
      node.id === nodeKey ||
      node.node_id === nodeKey ||
      node.name === nodeKey ||
      node.label === nodeKey ||
      dataName === nodeKey
    );
  });
  if (direct?.id) return direct.id;
  if (typeof direct?.node_id === 'string' && direct.node_id) return direct.node_id;
  const mapped = labelToNodeId?.[nodeKey];
  return mapped ?? null;
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
    return selectedNodes
      .map((node) => node.id ?? node.node_id)
      .filter((id: string | undefined): id is string => Boolean(id));
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
    const node = selectedNodes.find((entry) => entry.id === id || entry.node_id === id);
    const sourceLabel = node?.name ?? node?.label ?? id;
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
    matchedTexts.map((text, index) => [text, palette[index % palette.length] ?? '']),
  );
}

/** The fixed source-bin resolution returned by the `/bins` endpoint. */
const DISPERSION_SERVER_BIN_COUNT = 100;

/** Display bin counts the user can pick. Each value divides 100 evenly so we
 *  can re-aggregate the 100 server bins without remainders.
 */
export const DISPERSION_DISPLAY_BIN_COUNTS = [4, 5, 10, 20, 25, 50, 100] as const;
export type DispersionDisplayBinCount = (typeof DISPERSION_DISPLAY_BIN_COUNTS)[number];
export const DISPERSION_DEFAULT_BIN_COUNT: DispersionDisplayBinCount = 20;
export const CONCORDANCE_DISPERSION_CHART_MODES = ['density', 'cumulative'] as const;
export type ConcordanceDispersionChartMode = (typeof CONCORDANCE_DISPERSION_CHART_MODES)[number];

/** Guards user or persisted preferences before re-binning server dispersion data. */
/**
 * Called by: concordanceViewModels analysis helper module during this analysis workflow.
 */
const isValidDisplayBinCount = (n: number): n is DispersionDisplayBinCount =>
  (DISPERSION_DISPLAY_BIN_COUNTS as readonly number[]).includes(n);

/**
 * Re-aggregate server-binned hit counts (100 buckets) into N display bins.
 * `displayBinCount` must divide {@link DISPERSION_SERVER_BIN_COUNT} evenly;
 * if it doesn't we fall back to {@link DISPERSION_DEFAULT_BIN_COUNT}.
 */
/**
 * Used by: ConcordanceDispersionSummary.tsx, ConcordanceDispersionNodeBlock.tsx.
 * Flow: normalize raw analysis values, apply filtering or mapping rules, then return the view model consumed by components or tests.
 */
export function buildDispersionBinsFromBinned(
  rows: TaggedBinRow[],
  displayBinCount: number,
  options: BuildDispersionBinsOptions = {},
): BuildDispersionBinsResult {
  const { lowercaseMatches = false, splitBySource = false, aggregateAll = false } = options;
  const targetCount = isValidDisplayBinCount(displayBinCount)
    ? displayBinCount
    : DISPERSION_DEFAULT_BIN_COUNT;
  const step = DISPERSION_SERVER_BIN_COUNT / targetCount;
  const bins: DispersionBinDatum[] = Array.from({ length: targetCount }, (_, i) => ({
    binCenter: ((i + 0.5) / targetCount) * 100,
  }));
  const totalsByKey: Record<string, number> = {};
  const sourceSet = new Set<string>();
  if (aggregateAll) totalsByKey[DISPERSION_AGGREGATE_KEY] = 0;

  for (const row of rows) {
    const sourceBinIdx = getNumericIndex(row.bin_idx);
    if (sourceBinIdx === null) continue;
    if (sourceBinIdx < 0 || sourceBinIdx >= DISPERSION_SERVER_BIN_COUNT) continue;
    const count = typeof row.count === 'number' && Number.isFinite(row.count) ? row.count : 0;
    if (count <= 0) continue;
    const rawText = row.matched_text ?? '';
    if (!rawText) continue;
    const text = lowercaseMatches ? rawText.toLowerCase() : rawText;
    const source = row.__source_node ?? '';
    if (source) sourceSet.add(source);
    const displayIdx = Math.min(targetCount - 1, Math.floor(sourceBinIdx / step));
    const baseKey = aggregateAll ? DISPERSION_AGGREGATE_KEY : text;
    const seriesKey =
      splitBySource && source ? `${baseKey}${DISPERSION_SOURCE_DELIMITER}${source}` : baseKey;
    const bin = bins[displayIdx];
    if (bin === undefined) continue;
    bin[seriesKey] = (bin[seriesKey] ?? 0) + count;
    totalsByKey[seriesKey] = (totalsByKey[seriesKey] ?? 0) + count;
  }

  fillEmptyBins(bins, totalsByKey);
  return { bins, totalsByKey, sources: [...sourceSet].sort() };
}

/**
 * Format a sparse set of selected bin indices as a comma-separated list of
 * percentage ranges, suitable for appending to a node name on dispersion
 * detach. Contiguous bins collapse into a single span.
 *
 * Examples:
 * - bins {0,1,2} of 10 → "0-30%"
 * - bins {0,3,4} of 10 → "0-10%,30-50%"
 * - bins {} → "" (empty selection means "all hits")
 *
 * Mirrors the boundary style used by `formatBinRange` in
 * `ConcordanceDispersionSummary.tsx` so labels stay consistent between the
 * chart's tooltip and the detached node name.
 */
/**
 * Used by: useConcordanceTaskFlow.ts.
 * Flow: normalize raw analysis values, apply filtering or mapping rules, then return the view model consumed by components or tests.
 */
export function formatBinIndicesAsRangeLabel(
  binIndices: ReadonlySet<number> | readonly number[],
  binCount: number,
): string {
  const arr = Array.from(binIndices);
  if (arr.length === 0) return '';
  const safeBinCount = Math.max(1, Math.floor(binCount));
  const width = 100 / safeBinCount;
  const sorted = [...arr].sort((a, b) => a - b);
  const spans: [number, number][] = [];
  const [firstBin] = sorted;
  if (firstBin === undefined) return '';
  let start = firstBin;
  let end = firstBin;
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    if (current === undefined) continue;
    if (current === end + 1) {
      end = current;
    } else {
      spans.push([start, end]);
      start = current;
      end = current;
    }
  }
  spans.push([start, end]);

  const parts = spans.map(([s, e]) => {
    if (width >= 2) {
      const lower = s === 0 ? 0 : Math.round(s * width) + 1;
      const upper = Math.round((e + 1) * width);
      return `${String(lower)}-${String(upper)}%`;
    }
    const lower = s * width;
    const upper = (e + 1) * width;
    return `${lower.toFixed(1)}-${upper.toFixed(1)}%`;
  });
  return parts.join(',');
}

/**
 * How many source documents the engine actually considered to produce
 * the current page — the per-page batch size capped by the corpus.
 * ``page_size`` alone overstates on small corpora (estimator might pick
 * 100 when only 30 rows exist); ``total_source_rows`` alone conflates
 * "this batch" with "the whole corpus." Returns ``undefined`` when
 * neither value is reportable so callers can suppress the suffix.
 */
/**
 * Used by: ConcordanceTableNodeBlock.tsx, ConcordanceDispersionNodeBlock.tsx.
 */
export function batchProcessedCount(
  pagination: { page_size?: number; total_source_rows?: number } | undefined,
): number | undefined {
  const ps = pagination?.page_size;
  const tsr = pagination?.total_source_rows;
  if (typeof ps === 'number' && typeof tsr === 'number') {
    return Math.min(ps, tsr);
  }
  return ps ?? tsr;
}
