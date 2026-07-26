import { CONCORDANCE_COLUMN_KEYS, CONCORDANCE_CORE_COLUMNS } from '../common/generatedColumns';
import { toCellText } from './concordanceTableDomain';

type ConcordanceHitRow = Record<string, unknown>;
type ConcordanceGroupedRow = ConcordanceHitRow[];

export type ConcordanceDispersionRow = Record<string, unknown> & {
  CONC_dispersion: ConcordanceGroupedRow;
};

const CORE_COLUMN_SET = new Set<string>(CONCORDANCE_CORE_COLUMNS);

/** Normalizes concordance offsets that may arrive from local rows or server JSON. */
const getNumericIndex = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : Math.max(0, parsed);
  }
  return null;
};

/** Converts hit groups into one dispersion row per source document for chart consumers. */
/**
 * Used by: concordanceDomains.test.ts, ConcordanceDispersionNodeBlock.tsx.
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
 * Used by: concordanceDomains.test.ts, ConcordanceDispersionNodeBlock.tsx.
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
 * Used by concordance view-model builders in this module.
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
 * Flow: assign hits to percentage bins, optionally split series by source,
 * accumulate totals, then fill missing series/bin pairs with zero.
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
/** Display bin counts the user can pick. Each value divides 100 evenly so we
 *  can re-aggregate the 100 server bins without remainders.
 */
export const DISPERSION_DISPLAY_BIN_COUNTS = [4, 5, 10, 20, 25, 50, 100] as const;
export type DispersionDisplayBinCount = (typeof DISPERSION_DISPLAY_BIN_COUNTS)[number];
export const DISPERSION_DEFAULT_BIN_COUNT: DispersionDisplayBinCount = 20;
export const CONCORDANCE_DISPERSION_CHART_MODES = ['density', 'cumulative'] as const;
export type ConcordanceDispersionChartMode = (typeof CONCORDANCE_DISPERSION_CHART_MODES)[number];

/**
 * Re-aggregate server-binned hit counts (100 buckets) into N display bins.
 * `displayBinCount` must divide {@link DISPERSION_SERVER_BIN_COUNT} evenly;
 * if it doesn't we fall back to {@link DISPERSION_DEFAULT_BIN_COUNT}.
 */
/**
 * Used by: ConcordanceDispersionSummary.tsx, ConcordanceDispersionNodeBlock.tsx.
 * Flow: validate the requested display-bin count, fold each of the 100 server
 * bins into its display bucket, accumulate series totals, then fill gaps.
 */
/**
 * How many source documents the engine actually considered to produce
 * the current page — the per-page batch size capped by the corpus.
 * ``page_size`` alone overstates on small corpora (estimator might pick
 * 100 when only 30 rows exist); ``total_source_rows`` alone conflates
 * the current batch size with the total source-row count. Returns ``undefined`` when
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
