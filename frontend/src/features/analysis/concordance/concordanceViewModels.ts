import type {
  ConcordanceDispersionBinRow,
} from '@/api/generated/types.gen';
import {
  CONCORDANCE_COLUMN_KEYS,
  CONCORDANCE_CORE_COLUMNS,
} from '../generatedColumns';

type ConcordanceHitRow = Record<string, unknown>;
type ConcordanceGroupedRow = ConcordanceHitRow[];

export type ConcordanceDispersionRow = Record<string, unknown> & {
  CONC_dispersion: ConcordanceGroupedRow;
};

const CORE_COLUMN_SET = new Set<string>(CONCORDANCE_CORE_COLUMNS);

/** Normalizes concordance offsets that may arrive from local rows or server JSON. */
/**
 * Called by: concordanceViewModels analysis helper module as a local helper in this analysis workflow because callers need the same normalization and view-model rules before rendering or testing analysis results.
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

/** Flattens grouped concordance hits for the standard table-oriented view. */
/**
 * Used by: concordanceViewModels.test.ts, ConcordanceTableNodeBlock.tsx because callers need the same normalization and view-model rules before rendering or testing analysis results.
 */
export function flattenConcordanceGroups(groups: ConcordanceGroupedRow[]): ConcordanceHitRow[] {
  return groups.flatMap((group) => group);
}

/** Converts hit groups into one dispersion row per source document for chart consumers. */
/**
 * Used by: concordanceViewModels.test.ts, ConcordanceDispersionNodeBlock.tsx because callers need the same normalization and view-model rules before rendering or testing analysis results.
 */
export function buildDispersionRows(groups: ConcordanceGroupedRow[]): ConcordanceDispersionRow[] {
  return groups.flatMap((group) => {
    if (group.length === 0) {
      return [];
    }

    const firstHit = group[0]!;
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
 * Used by: ConcordanceDispersionNodeBlock.tsx because callers need the same normalization and view-model rules before rendering or testing analysis results.
 */
export function getDispersionHits(row: Record<string, unknown>): ConcordanceGroupedRow {
  return row[CONCORDANCE_COLUMN_KEYS.dispersion] as ConcordanceGroupedRow;
}

/** Chooses the source text length used to scale dispersion positions for a row. */
/**
 * Used by: ConcordanceDispersionNodeBlock.tsx because callers need the same normalization and view-model rules before rendering or testing analysis results.
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
 * Used by: concordanceViewModels.test.ts, ConcordanceDispersionNodeBlock.tsx because callers need the same normalization and view-model rules before rendering or testing analysis results.
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

export type DispersionBinDatum = {
  binCenter: number;
} & Record<string, number>;

export type BuildDispersionBinsOptions = {
  lowercaseMatches?: boolean;
  splitBySource?: boolean;
  /**
   * When true, all hits collapse into a single aggregate series rather than
   * being split per matched-text. Used when the user has not enabled "Colour
   * matches" — the plot shows a single overall distribution line.
   */
  aggregateAll?: boolean;
};

/** Series key used when {@link BuildDispersionBinsOptions.aggregateAll} is true. */
export const DISPERSION_AGGREGATE_KEY = '__dispersion_total__';

/**
 * Make sure every bin has an explicit entry for every series key encountered.
 * Recharts' default behaviour treats missing keys as null, so a line with gaps
 * would visually skip empty bins instead of dropping to zero.
 */
/**
 * Called by: concordanceViewModels analysis helper module during this analysis workflow because callers need the same normalization and view-model rules before rendering or testing analysis results.
 */
const fillEmptyBins = (
  bins: DispersionBinDatum[],
  totalsByKey: Record<string, number>,
): void => {
  const keys = Object.keys(totalsByKey);
  for (const bin of bins) {
    for (const key of keys) {
      if (bin[key] === undefined) bin[key] = 0;
    }
  }
};

export type BuildDispersionBinsResult = {
  bins: DispersionBinDatum[];
  totalsByKey: Record<string, number>;
  sources: string[];
};

/** Builds normalized hit-count bins from raw grouped rows for client-side previews. */
/**
 * Used by: ConcordanceDispersionSummary.tsx because callers need the same normalization and view-model rules before rendering or testing analysis results.
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
    const rowSource = String(row.__source_node ?? '');
    const hits = getDispersionHits(row);
    for (const hit of hits) {
      const startIdx = getNumericIndex(hit[CONCORDANCE_COLUMN_KEYS.startIdx]);
      if (startIdx === null) continue;
      const ratio = Math.min(0.99999, startIdx / docLength);
      const binIdx = Math.min(safeBinCount - 1, Math.max(0, Math.floor(ratio * safeBinCount)));
      const rawText = String(hit[CONCORDANCE_COLUMN_KEYS.matchedText] ?? '');
      if (!rawText) continue;
      const text = lowercaseMatches ? rawText.toLowerCase() : rawText;
      const source = rowSource || String(hit.__source_node ?? '');
      if (source) sourceSet.add(source);
      const baseKey = aggregateAll ? DISPERSION_AGGREGATE_KEY : text;
      const seriesKey = splitBySource && source
        ? `${baseKey}${DISPERSION_SOURCE_DELIMITER}${source}`
        : baseKey;
      const bin = bins[binIdx]!;
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

/** The fixed source-bin resolution returned by the `/bins` endpoint. */
export const DISPERSION_SERVER_BIN_COUNT = 100;

/** Display bin counts the user can pick. Each value divides 100 evenly so we
 *  can re-aggregate the 100 server bins without remainders.
 */
export const DISPERSION_DISPLAY_BIN_COUNTS = [4, 5, 10, 20, 25, 50, 100] as const;
export type DispersionDisplayBinCount = (typeof DISPERSION_DISPLAY_BIN_COUNTS)[number];
export const DISPERSION_DEFAULT_BIN_COUNT: DispersionDisplayBinCount = 20;

/** Guards user or persisted preferences before re-binning server dispersion data. */
/**
 * Called by: concordanceViewModels analysis helper module during this analysis workflow because callers need the same normalization and view-model rules before rendering or testing analysis results.
 */
const isValidDisplayBinCount = (n: number): n is DispersionDisplayBinCount =>
  (DISPERSION_DISPLAY_BIN_COUNTS as readonly number[]).includes(n);

/**
 * Re-aggregate server-binned hit counts (100 buckets) into N display bins.
 * `displayBinCount` must divide {@link DISPERSION_SERVER_BIN_COUNT} evenly;
 * if it doesn't we fall back to {@link DISPERSION_DEFAULT_BIN_COUNT}.
 */
/**
 * Used by: ConcordanceDispersionSummary.tsx, ConcordanceDispersionNodeBlock.tsx because callers need the same normalization and view-model rules before rendering or testing analysis results.
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
    const rawText = String(row.matched_text ?? '');
    if (!rawText) continue;
    const text = lowercaseMatches ? rawText.toLowerCase() : rawText;
    const source = String(row.__source_node ?? '');
    if (source) sourceSet.add(source);
    const displayIdx = Math.min(targetCount - 1, Math.floor(sourceBinIdx / step));
    const baseKey = aggregateAll ? DISPERSION_AGGREGATE_KEY : text;
    const seriesKey = splitBySource && source
      ? `${baseKey}${DISPERSION_SOURCE_DELIMITER}${source}`
      : baseKey;
    const bin = bins[displayIdx]!;
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
 * Used by: useConcordanceTaskFlow.ts because callers need the same normalization and view-model rules before rendering or testing analysis results.
 * Flow: normalize raw analysis values, apply filtering or mapping rules, then return the view model consumed by components or tests.
 */
export function formatBinIndicesAsRangeLabel(
  binIndices: ReadonlySet<number> | ReadonlyArray<number>,
  binCount: number,
): string {
  const arr = Array.from(binIndices);
  if (arr.length === 0) return '';
  const safeBinCount = Math.max(1, Math.floor(binCount));
  const width = 100 / safeBinCount;
  const sorted = [...arr].sort((a, b) => a - b);
  const spans: Array<[number, number]> = [];
  let start = sorted[0]!;
  let end = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i]!;
    } else {
      spans.push([start, end]);
      start = sorted[i]!;
      end = sorted[i]!;
    }
  }
  spans.push([start, end]);

  const parts = spans.map(([s, e]) => {
    if (width >= 2) {
      const lower = s === 0 ? 0 : Math.round(s * width) + 1;
      const upper = Math.round((e + 1) * width);
      return `${lower}-${upper}%`;
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
 * Used by: ConcordanceTableNodeBlock.tsx, ConcordanceDispersionNodeBlock.tsx because callers need the same normalization and view-model rules before rendering or testing analysis results.
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