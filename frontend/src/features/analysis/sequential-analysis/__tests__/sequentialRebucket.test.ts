/**
 * Golden tests for the snapshot-mode re-aggregation engine.
 *
 * Each coarsening transition has its own block. Bucket totals are
 * verified against hand-computed expected values so a future change
 * to the bucketing math doesn't silently shift the chart.
 *
 * Pattern: build a synthetic captured row set at a known fine
 * granularity, run ``rebucket`` to a coarser one, and assert the
 * resulting chartData's series totals + bucket keys.
 */
import { describe, expect, it } from 'vitest';
import {
  formatBucket,
  isCoarserOrEqual,
  rebucket,
  type CapturedRow,
  type RebucketViewConfig,
} from '../sequentialRebucket';

/** Helper: build a captured row at daily granularity. */
function dailyRow(
  iso: string,
  count: number,
  groups: Record<string, string> = {},
): CapturedRow {
  const start = new Date(iso);
  // period_end on the captured side approximates "last timestamp in
  // this bucket"; for daily buckets that's end-of-day, but the
  // rebucket engine only uses min/max so any value inside the day works.
  return {
    time_period_formatted: iso.slice(0, 10),
    time_period: iso.slice(0, 10),
    period_start: start.toISOString(),
    period_end: start.toISOString(),
    sequential_count: count,
    ...groups,
  };
}

describe('formatBucket', () => {
  it('formats each frequency per the backend convention', () => {
    const d = new Date('2026-05-17T03:42:17Z');
    expect(formatBucket(d, 'second')).toBe('2026-05-17 03:42:17');
    expect(formatBucket(d, 'minute')).toBe('2026-05-17 03:42');
    expect(formatBucket(d, 'hourly')).toBe('2026-05-17 03:42'); // hourly displays as Y-m-d H:M too
    expect(formatBucket(d, 'daily')).toBe('2026-05-17');
    expect(formatBucket(d, 'monthly')).toBe('2026-05');
    expect(formatBucket(d, 'yearly')).toBe('2026');
  });

  it('formats quarterly as Y-Q{1-4}', () => {
    expect(formatBucket(new Date('2026-01-15T00:00:00Z'), 'quarterly')).toBe('2026-Q1');
    expect(formatBucket(new Date('2026-04-15T00:00:00Z'), 'quarterly')).toBe('2026-Q2');
    expect(formatBucket(new Date('2026-07-15T00:00:00Z'), 'quarterly')).toBe('2026-Q3');
    expect(formatBucket(new Date('2026-10-15T00:00:00Z'), 'quarterly')).toBe('2026-Q4');
  });

  it('formats weekly as Y-W%W (Monday-start)', () => {
    // 2026-01-05 is a Monday — first week of year per %W.
    expect(formatBucket(new Date('2026-01-05T00:00:00Z'), 'weekly')).toBe('2026-W01');
    // 2026-01-04 is a Sunday before the first Monday → week 00.
    expect(formatBucket(new Date('2026-01-04T00:00:00Z'), 'weekly')).toBe('2026-W00');
    // 2026-01-12 is the second Monday → week 02.
    expect(formatBucket(new Date('2026-01-12T00:00:00Z'), 'weekly')).toBe('2026-W02');
  });
});

describe('isCoarserOrEqual', () => {
  it('returns true when view ≥ capture in the frequency ordering', () => {
    expect(isCoarserOrEqual('daily', 'daily')).toBe(true);
    expect(isCoarserOrEqual('monthly', 'daily')).toBe(true);
    expect(isCoarserOrEqual('yearly', 'second')).toBe(true);
  });

  it('returns false when view < capture (refinement)', () => {
    expect(isCoarserOrEqual('hourly', 'daily')).toBe(false);
    expect(isCoarserOrEqual('second', 'minute')).toBe(false);
    expect(isCoarserOrEqual('weekly', 'monthly')).toBe(false);
  });
});

const baseConfig: RebucketViewConfig = {
  columnType: 'datetime',
  viewFrequency: 'daily',
  viewNumericInterval: 1,
  captureNumericOrigin: 0,
  viewGroupByColumns: [],
  caseSensitive: true,
};

describe('rebucket — datetime coarsening', () => {
  it('daily → daily is a passthrough (no aggregation needed)', () => {
    const rows = [
      dailyRow('2026-01-01T00:00:00Z', 5),
      dailyRow('2026-01-02T00:00:00Z', 3),
      dailyRow('2026-01-03T00:00:00Z', 7),
    ];
    const result = rebucket(rows, { ...baseConfig, viewFrequency: 'daily' });
    expect(result.chartData.length).toBe(3);
    expect(result.chartData[0]?.time_period).toBe('2026-01-01');
    expect(result.chartData[0]?.sequential_count).toBe(5);
    expect(result.chartData[2]?.sequential_count).toBe(7);
  });

  it('daily → monthly sums counts within each calendar month', () => {
    const rows = [
      // January: 5+3+7 = 15
      dailyRow('2026-01-01T00:00:00Z', 5),
      dailyRow('2026-01-15T00:00:00Z', 3),
      dailyRow('2026-01-31T00:00:00Z', 7),
      // February: 2+8 = 10
      dailyRow('2026-02-05T00:00:00Z', 2),
      dailyRow('2026-02-20T00:00:00Z', 8),
      // March: 1
      dailyRow('2026-03-10T00:00:00Z', 1),
    ];
    const result = rebucket(rows, { ...baseConfig, viewFrequency: 'monthly' });
    expect(result.chartData.length).toBe(3);
    expect(result.chartData[0]).toMatchObject({ time_period: '2026-01', sequential_count: 15 });
    expect(result.chartData[1]).toMatchObject({ time_period: '2026-02', sequential_count: 10 });
    expect(result.chartData[2]).toMatchObject({ time_period: '2026-03', sequential_count: 1 });
  });

  it('daily → yearly sums counts across the entire year', () => {
    const rows = [
      dailyRow('2026-01-01T00:00:00Z', 100),
      dailyRow('2026-06-15T00:00:00Z', 50),
      dailyRow('2026-12-31T00:00:00Z', 25),
      dailyRow('2027-01-01T00:00:00Z', 7),
    ];
    const result = rebucket(rows, { ...baseConfig, viewFrequency: 'yearly' });
    expect(result.chartData.length).toBe(2);
    expect(result.chartData[0]).toMatchObject({ time_period: '2026', sequential_count: 175 });
    expect(result.chartData[1]).toMatchObject({ time_period: '2027', sequential_count: 7 });
  });

  it('daily → quarterly buckets on Jan/Apr/Jul/Oct boundaries', () => {
    const rows = [
      dailyRow('2026-01-15T00:00:00Z', 10), // Q1
      dailyRow('2026-03-31T00:00:00Z', 5),  // Q1
      dailyRow('2026-04-01T00:00:00Z', 3),  // Q2
      dailyRow('2026-09-30T00:00:00Z', 8),  // Q3
      dailyRow('2026-10-01T00:00:00Z', 4),  // Q4
    ];
    const result = rebucket(rows, { ...baseConfig, viewFrequency: 'quarterly' });
    expect(result.chartData.length).toBe(4);
    expect(result.chartData[0]).toMatchObject({ time_period: '2026-Q1', sequential_count: 15 });
    expect(result.chartData[1]).toMatchObject({ time_period: '2026-Q2', sequential_count: 3 });
    expect(result.chartData[2]).toMatchObject({ time_period: '2026-Q3', sequential_count: 8 });
    expect(result.chartData[3]).toMatchObject({ time_period: '2026-Q4', sequential_count: 4 });
  });

  it('daily → weekly buckets on Monday boundaries', () => {
    // 2026-01-05 is Monday, so week 01 covers Mon Jan 5 .. Sun Jan 11.
    // 2026-01-12 is the next Monday → week 02.
    const rows = [
      dailyRow('2026-01-05T00:00:00Z', 4), // Mon W01
      dailyRow('2026-01-11T00:00:00Z', 6), // Sun W01
      dailyRow('2026-01-12T00:00:00Z', 9), // Mon W02
    ];
    const result = rebucket(rows, { ...baseConfig, viewFrequency: 'weekly' });
    expect(result.chartData.length).toBe(2);
    expect(result.chartData[0]).toMatchObject({ time_period: '2026-W01', sequential_count: 10 });
    expect(result.chartData[1]).toMatchObject({ time_period: '2026-W02', sequential_count: 9 });
  });
});

describe('rebucket — group composition', () => {
  it('drops a group column by summing across the removed dimension', () => {
    // Captured with section + category; viewer drops "category".
    const rows: CapturedRow[] = [
      { ...dailyRow('2026-01-01T00:00:00Z', 5, { section: 'news', category: 'A' }) },
      { ...dailyRow('2026-01-01T00:00:00Z', 3, { section: 'news', category: 'B' }) },
      { ...dailyRow('2026-01-01T00:00:00Z', 7, { section: 'sports', category: 'A' }) },
    ];
    const result = rebucket(rows, {
      ...baseConfig,
      viewGroupByColumns: ['section'],
    });
    expect(result.chartData.length).toBe(1);
    // 'news' = 5 + 3 = 8; 'sports' = 7
    expect(result.chartData[0]).toMatchObject({
      time_period: '2026-01-01',
      news: 8,
      sports: 7,
    });
    expect(result.groupKeys.sort()).toEqual(['news', 'sports']);
  });

  it('case-fold merges variant casings when caseSensitive=false', () => {
    const rows: CapturedRow[] = [
      { ...dailyRow('2026-01-01T00:00:00Z', 5, { author: 'Alice' }) },
      { ...dailyRow('2026-01-01T00:00:00Z', 3, { author: 'alice' }) },
      { ...dailyRow('2026-01-01T00:00:00Z', 7, { author: 'Bob' }) },
    ];
    const result = rebucket(rows, {
      ...baseConfig,
      viewGroupByColumns: ['author'],
      caseSensitive: false,
    });
    expect(result.chartData.length).toBe(1);
    // 'alice' folded: 5 + 3 = 8; 'bob' = 7
    expect(result.chartData[0]).toMatchObject({
      time_period: '2026-01-01',
      alice: 8,
      bob: 7,
    });
    expect(result.groupKeys.sort()).toEqual(['alice', 'bob']);
  });

  it('case-sensitive=true keeps variant casings as separate series', () => {
    const rows: CapturedRow[] = [
      { ...dailyRow('2026-01-01T00:00:00Z', 5, { author: 'Alice' }) },
      { ...dailyRow('2026-01-01T00:00:00Z', 3, { author: 'alice' }) },
    ];
    const result = rebucket(rows, {
      ...baseConfig,
      viewGroupByColumns: ['author'],
      caseSensitive: true,
    });
    expect(result.groupKeys.sort()).toEqual(['Alice', 'alice']);
    expect(result.chartData[0]?.Alice).toBe(5);
    expect(result.chartData[0]?.alice).toBe(3);
  });

  it('drops all groupings → single implicit sequential_count series', () => {
    const rows: CapturedRow[] = [
      { ...dailyRow('2026-01-01T00:00:00Z', 5, { section: 'news' }) },
      { ...dailyRow('2026-01-01T00:00:00Z', 3, { section: 'sports' }) },
    ];
    const result = rebucket(rows, {
      ...baseConfig,
      viewGroupByColumns: [],
    });
    expect(result.groupKeys).toEqual(['sequential_count']);
    expect(result.chartData[0]?.sequential_count).toBe(8);
  });

  it('combines bucket coarsening + group composition + case-fold in one pass', () => {
    const rows: CapturedRow[] = [
      // January
      { ...dailyRow('2026-01-15T00:00:00Z', 5, { author: 'Alice' }) },
      { ...dailyRow('2026-01-20T00:00:00Z', 3, { author: 'alice' }) },
      { ...dailyRow('2026-01-25T00:00:00Z', 2, { author: 'Bob' }) },
      // February
      { ...dailyRow('2026-02-10T00:00:00Z', 4, { author: 'ALICE' }) },
      { ...dailyRow('2026-02-15T00:00:00Z', 6, { author: 'Bob' }) },
    ];
    const result = rebucket(rows, {
      ...baseConfig,
      viewFrequency: 'monthly',
      viewGroupByColumns: ['author'],
      caseSensitive: false,
    });
    expect(result.chartData.length).toBe(2);
    expect(result.chartData[0]).toMatchObject({
      time_period: '2026-01',
      alice: 8, // 5 + 3
      bob: 2,
    });
    expect(result.chartData[1]).toMatchObject({
      time_period: '2026-02',
      alice: 4,
      bob: 6,
    });
  });
});

describe('rebucket — numeric coarsening', () => {
  function numericRow(value: number, count: number, groups: Record<string, string> = {}): CapturedRow {
    return {
      time_period_formatted: String(value),
      time_period: value,
      period_start: null,
      period_end: null,
      sequential_count: count,
      ...groups,
    };
  }

  it('numeric pass-through at the captured interval', () => {
    const rows = [numericRow(0, 5), numericRow(1, 3), numericRow(2, 7)];
    const result = rebucket(rows, {
      ...baseConfig,
      columnType: 'numeric',
      viewNumericInterval: 1,
      captureNumericOrigin: 0,
    });
    expect(result.chartData.length).toBe(3);
    expect(result.chartData.map((r) => r.sequential_count)).toEqual([5, 3, 7]);
  });

  it('coarsens by integer multiple — bin=2 from a bin=1 capture', () => {
    const rows = [
      numericRow(0, 5), numericRow(1, 3), // bin 0..2 → 8
      numericRow(2, 7), numericRow(3, 1), // bin 2..4 → 8
      numericRow(4, 4),                    // bin 4..6 → 4
    ];
    const result = rebucket(rows, {
      ...baseConfig,
      columnType: 'numeric',
      viewNumericInterval: 2,
      captureNumericOrigin: 0,
    });
    expect(result.chartData.length).toBe(3);
    expect(result.chartData.map((r) => r.time_period)).toEqual(['0', '2', '4']);
    expect(result.chartData.map((r) => r.sequential_count)).toEqual([8, 8, 4]);
  });

  it('honours capture origin when coarsening', () => {
    // Capture: origin=10, interval=1; view: interval=5 from origin 10.
    const rows = [
      numericRow(10, 1), numericRow(11, 2), numericRow(12, 3), // bin 10..15 → 6
      numericRow(15, 4), numericRow(19, 5),                     // bin 15..20 → 9
    ];
    const result = rebucket(rows, {
      ...baseConfig,
      columnType: 'numeric',
      viewNumericInterval: 5,
      captureNumericOrigin: 10,
    });
    expect(result.chartData.length).toBe(2);
    expect(result.chartData.map((r) => r.time_period)).toEqual(['10', '15']);
    expect(result.chartData.map((r) => r.sequential_count)).toEqual([6, 9]);
  });
});

describe('rebucket — chart shape parity with live task-flow', () => {
  it('backfills 0 for absent (bucket, series) cells', () => {
    const rows: CapturedRow[] = [
      // January: only "news"
      { ...dailyRow('2026-01-15T00:00:00Z', 5, { section: 'news' }) },
      // February: only "sports"
      { ...dailyRow('2026-02-15T00:00:00Z', 7, { section: 'sports' }) },
    ];
    const result = rebucket(rows, {
      ...baseConfig,
      viewFrequency: 'monthly',
      viewGroupByColumns: ['section'],
    });
    expect(result.chartData.length).toBe(2);
    // Jan: news=5, sports=0
    expect(result.chartData[0]).toMatchObject({
      time_period: '2026-01',
      news: 5,
      sports: 0,
    });
    // Feb: news=0, sports=7
    expect(result.chartData[1]).toMatchObject({
      time_period: '2026-02',
      news: 0,
      sports: 7,
    });
  });

  it('emits chronologically-sorted buckets', () => {
    const rows = [
      dailyRow('2026-03-01T00:00:00Z', 1),
      dailyRow('2026-01-01T00:00:00Z', 2),
      dailyRow('2026-02-01T00:00:00Z', 3),
    ];
    const result = rebucket(rows, { ...baseConfig, viewFrequency: 'monthly' });
    expect(result.chartData.map((r) => r.time_period)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('counts non-zero points per series in groupPointCounts', () => {
    const rows: CapturedRow[] = [
      { ...dailyRow('2026-01-01T00:00:00Z', 5, { section: 'news' }) },
      { ...dailyRow('2026-02-01T00:00:00Z', 3, { section: 'news' }) },
      { ...dailyRow('2026-01-01T00:00:00Z', 7, { section: 'sports' }) },
    ];
    const result = rebucket(rows, {
      ...baseConfig,
      viewFrequency: 'monthly',
      viewGroupByColumns: ['section'],
    });
    expect(result.groupPointCounts).toEqual({ news: 2, sports: 1 });
  });

  it('handles polars-style microsecond epoch numeric timestamps in period_start', () => {
    // Polars datetime → int = microseconds since epoch.
    const microsForJan1 = Date.UTC(2026, 0, 1) * 1000;
    const row: CapturedRow = {
      time_period: '2026-01-01',
      period_start: microsForJan1,
      period_end: microsForJan1,
      sequential_count: 42,
    };
    const result = rebucket([row], { ...baseConfig, viewFrequency: 'monthly' });
    expect(result.chartData[0]?.time_period).toBe('2026-01');
    expect(result.chartData[0]?.sequential_count).toBe(42);
  });
});
