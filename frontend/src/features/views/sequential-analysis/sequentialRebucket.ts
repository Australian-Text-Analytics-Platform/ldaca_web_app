/**
 * Snapshot-mode re-aggregation engine for Trends.
 *
 * Trends snapshots are captured at the user's chosen "finest" time bin
 * (and up to 3 group columns at always-``case_sensitive: true``). The
 * viewer can then **coarsen** the chart client-side:
 *  - re-bucket time to any frequency ≥ the captured one
 *  - drop group dimensions (the captured row keeps all selected
 *    columns; the viewer's group-by is a subset)
 *  - case-fold group values (merge "Alice" / "alice" into one series)
 *  - re-bucket numeric x-axis to any multiple of the captured interval
 *
 * Refinements (sub-bucket time, add a column) need raw data and are
 * impossible from captured rows. The viewer's parameter dropdowns are
 * constrained to coarser-or-equal options.
 *
 * **Bucket-boundary invariant**: a captured-at-daily snapshot
 * re-aggregated to monthly here must equal a live-mode monthly run
 * from the same raw data. Match the backend's polars semantics:
 *  - week boundary = Monday (polars ``dt.truncate("1w")``,
 *    strftime ``%Y-W%W``)
 *  - quarter boundary = Jan/Apr/Jul/Oct (polars ``dt.truncate("3mo")``,
 *    custom format ``Y-Q{1-4}``)
 *  - all other truncations follow the natural UTC calendar boundary
 *
 * No external date library — Date + UTC accessors are sufficient.
 */
import type { ChartConfig } from '@/components/ui/chart';
import type { SequentialAnalysisRequestInput } from '@/api/generated/types.gen';

type SequentialFrequency = NonNullable<SequentialAnalysisRequestInput['frequency']>;

export type SnapshotFinestFrequency = Exclude<SequentialFrequency, 'custom'>;

export const FREQUENCY_ORDER: readonly SnapshotFinestFrequency[] = [
  'second',
  'minute',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
];

const FREQUENCY_INDEX: Record<SnapshotFinestFrequency, number> = Object.fromEntries(
  FREQUENCY_ORDER.map((f, i) => [f, i]),
) as Record<SnapshotFinestFrequency, number>;

/** Returns true when ``view`` is the same as or coarser than
 * ``capture``. Used to gate the viewer's frequency dropdown. */
/**
 * Used by: SequentialAnalysisFeature.tsx, sequentialRebucket.test.ts because snapshot Trends needs client-side re-aggregation that preserves backend bucket semantics without rerunning the analysis.
 */
export function isCoarserOrEqual(
  view: SnapshotFinestFrequency,
  capture: SnapshotFinestFrequency,
): boolean {
  return FREQUENCY_INDEX[view] >= FREQUENCY_INDEX[capture];
}

const DEFAULT_PALETTE = [
  '#2563eb',
  '#16a34a',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#14b8a6',
  '#f97316',
  '#ec4899',
  '#0ea5e9',
  '#22c55e',
];

// Provides deterministic series colours that match the live sequential chart palette style.
/**
 * Called by: sequentialRebucket analysis helper module during this analysis workflow because snapshot Trends needs client-side re-aggregation that preserves backend bucket semantics without rerunning the analysis.
 */
const paletteColor = (index: number) =>
  DEFAULT_PALETTE[index % DEFAULT_PALETTE.length] ?? '#888888';

// ── Date math ─────────────────────────────────────────────────────────

/** Parse a captured ``period_start`` value (ISO string, epoch millis,
 * or epoch microseconds) into a UTC Date. Returns ``null`` for
 * unrecognisable inputs. */
/**
 * Called by: sequentialRebucket analysis helper module as a local helper in this analysis workflow because snapshot Trends needs client-side re-aggregation that preserves backend bucket semantics without rerunning the analysis.
 * Flow: accept Date instances, detect epoch microseconds versus milliseconds, parse nonempty strings, then return null for unrecognized values.
 */
function parseCapturedTimestamp(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === 'number') {
    // Heuristic: polars datetime is microseconds-since-epoch when cast
    // to int; JS Date wants milliseconds. Anything above year-3000
    // millis (~3.2e13) is almost certainly microseconds.
    const millis = value > 3.2e13 ? value / 1000 : value;
    return new Date(millis);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

/** Round ``d`` down to the start of its bucket at ``freq``. Pure UTC. */
/**
 * Called by: sequentialRebucket analysis helper module during this analysis workflow because snapshot Trends needs client-side re-aggregation that preserves backend bucket semantics without rerunning the analysis.
 * Flow: extract UTC date parts, round to the requested second/minute/hour/day/week/month/quarter/year boundary, then return the bucket start.
 */
function bucketStart(d: Date, freq: SnapshotFinestFrequency): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const h = d.getUTCHours();
  const min = d.getUTCMinutes();
  const sec = d.getUTCSeconds();
  switch (freq) {
    case 'second':
      return new Date(Date.UTC(y, m, day, h, min, sec));
    case 'minute':
      return new Date(Date.UTC(y, m, day, h, min));
    case 'hourly':
      return new Date(Date.UTC(y, m, day, h));
    case 'daily':
      return new Date(Date.UTC(y, m, day));
    case 'weekly': {
      // Monday-start ISO week — matches polars dt.truncate("1w").
      // JS ``getUTCDay`` returns 0=Sun..6=Sat; convert so Mon=0.
      const dow = (d.getUTCDay() + 6) % 7;
      const start = new Date(Date.UTC(y, m, day - dow));
      return start;
    }
    case 'monthly':
      return new Date(Date.UTC(y, m, 1));
    case 'quarterly': {
      const qStartMonth = Math.floor(m / 3) * 3;
      return new Date(Date.UTC(y, qStartMonth, 1));
    }
    case 'yearly':
      return new Date(Date.UTC(y, 0, 1));
  }
}

// Pads date/time fields so rebucketed labels match backend string formatting.
/**
 * Called by: sequentialRebucket analysis helper module during this analysis workflow because snapshot Trends needs client-side re-aggregation that preserves backend bucket semantics without rerunning the analysis.
 */
const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** strftime ``%W``: Monday-start week-of-year, 00–53. Week 01 is the
 * week containing the first Monday. Days before the first Monday are
 * week 00. Matches polars' ``%W`` behaviour. */
/**
 * Called by: sequentialRebucket analysis helper module during this analysis workflow because snapshot Trends needs client-side re-aggregation that preserves backend bucket semantics without rerunning the analysis.
 * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
 */
function isoWeekNumberMondayStart(d: Date): number {
  const y = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(y, 0, 1));
  // Day-of-week with Monday=0..Sunday=6.
  const dowJan1 = (jan1.getUTCDay() + 6) % 7;
  // Day of year (1-indexed).
  const msPerDay = 86_400_000;
  const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / msPerDay) + 1;
  // %W: week 01 starts at the first Monday; days before are week 00.
  const daysBeforeFirstMonday = dowJan1 === 0 ? 0 : 7 - dowJan1;
  if (dayOfYear <= daysBeforeFirstMonday) return 0;
  return Math.floor((dayOfYear - daysBeforeFirstMonday - 1) / 7) + 1;
}

/** Format ``d`` (assumed already bucketed) per the backend's
 * convention for ``freq``. The viewer relies on these strings being
 * identical to what a live run would have produced so chart x-axis
 * labels stay consistent across modes. */
/**
 * Used by: sequentialRebucket.test.ts because snapshot Trends needs client-side re-aggregation that preserves backend bucket semantics without rerunning the analysis.
 * Flow: read UTC bucket parts, format each supported frequency with backend-compatible labels, then return the period string.
 */
export function formatBucket(d: Date, freq: SnapshotFinestFrequency): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const h = d.getUTCHours();
  const min = d.getUTCMinutes();
  const sec = d.getUTCSeconds();
  switch (freq) {
    case 'second':
      return `${y}-${pad2(m)}-${pad2(day)} ${pad2(h)}:${pad2(min)}:${pad2(sec)}`;
    case 'minute':
    case 'hourly':
      return `${y}-${pad2(m)}-${pad2(day)} ${pad2(h)}:${pad2(min)}`;
    case 'daily':
      return `${y}-${pad2(m)}-${pad2(day)}`;
    case 'weekly':
      return `${y}-W${pad2(isoWeekNumberMondayStart(d))}`;
    case 'monthly':
      return `${y}-${pad2(m)}`;
    case 'quarterly': {
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      return `${y}-Q${q}`;
    }
    case 'yearly':
      return String(y);
  }
}

// ── Aggregation engine ────────────────────────────────────────────────

export interface CapturedRow {
  /** Captured-time formatted period (informational; the engine uses
   * ``period_start`` for re-bucketing). */
  time_period_formatted?: string;
  time_period?: string | number;
  /** Bucket start timestamp at the captured granularity. */
  period_start?: string | number | null;
  /** Bucket end timestamp at the captured granularity. */
  period_end?: string | number | null;
  /** Count for this bucket × group cell. */
  sequential_count?: number | string;
  /** Group column values present on every row (one entry per
   * column the capture-time request listed in ``group_by_columns``). */
  [groupColumn: string]: unknown;
}

export interface RebucketViewConfig {
  /** ``datetime`` or ``numeric`` — matches the captured x-axis. The
   * viewer can't switch this; only re-bucket within the captured kind. */
  columnType: 'datetime' | 'numeric';
  /** Datetime path: view-time frequency. Must be coarser-or-equal to
   * the captured finest frequency (callers gate the dropdown). */
  viewFrequency: SnapshotFinestFrequency;
  /** Numeric path: view-time bin width. Must be a multiple of the
   * captured interval (caller validates). */
  viewNumericInterval: number;
  captureNumericOrigin: number | null;
  /** Subset of the columns the capture shipped. */
  viewGroupByColumns: string[];
  /** When ``false``, group values are case-folded (lowercased) before
   * merging. Captured rows always have ``case_sensitive: true`` so
   * folding is always reversible. */
  caseSensitive: boolean;
}

export interface RebucketResult {
  chartData: Array<Record<string, unknown>>;
  groupKeys: string[];
  chartConfig: ChartConfig;
  /** Per-series count of non-null cells across buckets — same shape
   * the live ``useSequentialAnalysisTaskFlow`` emits so the chart's
   * ``singlePoint`` and "single non-zero bucket" UX kick in. */
  groupPointCounts: Record<string, number>;
}

const SINGLE_SERIES_KEY = 'sequential_count';
const NON_SERIES_KEYS = new Set(['time_period', 'period_start', 'period_end']);

/** Compose the group key for a single captured row given the viewer's
 * selected group columns. Empty group list → an implicit single
 * series. */
/**
 * Called by: sequentialRebucket analysis helper module during this analysis workflow because snapshot Trends needs client-side re-aggregation that preserves backend bucket semantics without rerunning the analysis.
 */
function groupKeyFor(
  row: CapturedRow,
  viewGroupByColumns: string[],
  caseSensitive: boolean,
): string {
  if (viewGroupByColumns.length === 0) return SINGLE_SERIES_KEY;
  return viewGroupByColumns
    .map((col) => {
      const raw = row[col];
      const str = raw == null ? '' : String(raw);
      return caseSensitive ? str : str.toLowerCase();
    })
    .join(' - ');
}

interface BucketAccumulator {
  time_period: string;
  period_start: Date | null;
  period_end: Date | null;
  series: Record<string, number>;
}

/** Compute the view-time bucket key + start for a captured row. For
 * datetime: parse period_start, round down to viewFrequency. For
 * numeric: floor(time_period / interval) * interval. */
/**
 * Called by: sequentialRebucket analysis helper module during this analysis workflow because snapshot Trends needs client-side re-aggregation that preserves backend bucket semantics without rerunning the analysis.
 * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
 */
function viewBucket(
  row: CapturedRow,
  config: RebucketViewConfig,
): { key: string; start: Date | null; end: Date | null } | null {
  if (config.columnType === 'numeric') {
    const raw = row.time_period;
    const numericValue = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(numericValue)) return null;
    const origin = config.captureNumericOrigin ?? 0;
    const interval = config.viewNumericInterval > 0 ? config.viewNumericInterval : 1;
    const binIdx = Math.floor((numericValue - origin) / interval);
    const binStart = origin + binIdx * interval;
    // Numeric "bucket key" is just the formatted start value. Round
    // to 6 decimals to dodge float-bleed accumulation.
    const rounded = Math.round(binStart * 1e6) / 1e6;
    return {
      key: String(rounded),
      start: null,
      end: null,
    };
  }
  const captured = parseCapturedTimestamp(row.period_start);
  if (!captured) return null;
  const start = bucketStart(captured, config.viewFrequency);
  return {
    key: formatBucket(start, config.viewFrequency),
    start,
    end: null, // recomputed below from row.period_end
  };
}

/** Core entry point. Takes captured rows + the viewer's chosen
 * config, returns chart-ready data matching the live task-flow's
 * output shape. */
/**
 * Used by: sequentialRebucket.test.ts, SequentialAnalysisFeature.tsx because snapshot Trends needs client-side re-aggregation that preserves backend bucket semantics without rerunning the analysis.
 * Flow: parse captured buckets, regroup rows under the requested view, aggregate series counts, then return chart-ready data and config.
 */
export function rebucket(capturedRows: CapturedRow[], config: RebucketViewConfig): RebucketResult {
  const buckets = new Map<string, BucketAccumulator>();
  const seriesKeys = new Set<string>();

  for (const row of capturedRows) {
    const bucket = viewBucket(row, config);
    if (!bucket) continue;
    const rawCount = row.sequential_count;
    const count = typeof rawCount === 'number' ? rawCount : Number(rawCount ?? 0);
    if (!Number.isFinite(count)) continue;

    let acc = buckets.get(bucket.key);
    if (!acc) {
      acc = {
        time_period: bucket.key,
        period_start: bucket.start,
        period_end: null,
        series: {},
      };
      buckets.set(bucket.key, acc);
    }
    // Track the widest period_end seen for this bucket (matches the
    // backend's max() aggregation on the time column).
    const rowEnd = parseCapturedTimestamp(row.period_end);
    if (rowEnd && (!acc.period_end || rowEnd > acc.period_end)) {
      acc.period_end = rowEnd;
    }
    // Period_start narrows to the earliest captured start within the
    // view bucket (matches min() on the backend side).
    const rowStart = parseCapturedTimestamp(row.period_start);
    if (rowStart && (!acc.period_start || rowStart < acc.period_start)) {
      acc.period_start = rowStart;
    }

    const key = groupKeyFor(row, config.viewGroupByColumns, config.caseSensitive);
    seriesKeys.add(key);
    acc.series[key] = (acc.series[key] ?? 0) + count;
  }

  // Sort buckets in display order. For datetime this is chronological
  // via period_start; for numeric this is the numeric key (parsed).
  const sortedBuckets = Array.from(buckets.values()).sort((a, b) => {
    if (config.columnType === 'numeric') {
      return Number(a.time_period) - Number(b.time_period);
    }
    const aTime = a.period_start?.getTime() ?? 0;
    const bTime = b.period_start?.getTime() ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.time_period.localeCompare(b.time_period);
  });

  // Backfill 0 for any (bucket, series) cell that didn't see a row —
  // matches the live task-flow's "absent = zero" semantics so chart
  // lines don't break at empty buckets.
  const allKeys = Array.from(seriesKeys);
  const chartData: Array<Record<string, unknown>> = sortedBuckets.map((acc) => {
    const datum: Record<string, unknown> = {
      time_period: acc.time_period,
      period_start: acc.period_start ? acc.period_start.toISOString() : null,
      period_end: acc.period_end ? acc.period_end.toISOString() : null,
    };
    for (const key of allKeys) {
      datum[key] = acc.series[key] ?? 0;
    }
    return datum;
  });

  // Derive groupKeys/chartConfig matching the live task-flow's output.
  // If no grouping requested, present the single implicit series.
  const isSingleSeries = config.viewGroupByColumns.length === 0;
  const groupKeys: string[] = isSingleSeries
    ? [SINGLE_SERIES_KEY]
    : allKeys.filter((k) => !NON_SERIES_KEYS.has(k));

  const chartConfig: ChartConfig = {};
  if (isSingleSeries) {
    chartConfig[SINGLE_SERIES_KEY] = {
      label: 'Sequential Count',
      color: paletteColor(0),
    };
  } else {
    groupKeys.forEach((key, idx) => {
      chartConfig[key] = { label: key, color: paletteColor(idx) };
    });
  }

  // Group-level point counts: number of buckets where the series has
  // a non-null, non-zero entry. Mirrors useSequentialAnalysisTaskFlow.
  const groupPointCounts: Record<string, number> = {};
  for (const datum of chartData) {
    for (const key of groupKeys) {
      const v = datum[key];
      if (typeof v === 'number' && v !== 0) {
        groupPointCounts[key] = (groupPointCounts[key] ?? 0) + 1;
      }
    }
  }

  return { chartData, groupKeys, chartConfig, groupPointCounts };
}
