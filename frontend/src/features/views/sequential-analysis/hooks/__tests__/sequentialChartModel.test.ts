import { describe, expect, it } from 'vitest';

import {
  buildSequentialChartModel,
  type BuildSequentialChartModelInput,
  type SequentialResultSummaryFallbacks,
} from '../sequentialChartModel';

const fallbacks: SequentialResultSummaryFallbacks = {
  timeColumn: 'time',
  groupBy: [],
  columnType: 'datetime',
  numericOrigin: null,
  numericInterval: null,
  frequency: 'daily',
  customIntervalValue: null,
  customIntervalUnit: null,
};

const build = (
  results: Record<string, unknown> | null,
  overrides: Partial<Omit<BuildSequentialChartModelInput, 'results' | 'fallbacks'>> & {
    fallbacks?: SequentialResultSummaryFallbacks;
  } = {},
) =>
  buildSequentialChartModel({
    results,
    fallbacks: overrides.fallbacks ?? fallbacks,
    chartType: overrides.chartType ?? 'line',
    xAxisType: overrides.xAxisType ?? 'category',
    hiddenKeys: overrides.hiddenKeys ?? new Set(),
    selectedPeriodIndices: overrides.selectedPeriodIndices ?? new Set(),
    sourceDocumentCount: overrides.sourceDocumentCount,
  });

describe('buildSequentialChartModel', () => {
  it('returns an explicit empty model when no rows exist', () => {
    const model = build({ data: [], analysis_params: {} });

    expect(model.status).toBe('empty');
    expect(model.chartData).toEqual([]);
    expect(model.series).toEqual([]);
  });

  it('builds one ungrouped series and preserves numeric zero as the linear x value', () => {
    const model = build(
      {
        data: [
          {
            time_period: 0,
            time_period_formatted: 'Zero bucket',
            period_start: -5,
            period_end: 5,
            sequential_count: 4,
          },
        ],
        analysis_params: { column_type: 'numeric', numeric_interval: 10 },
      },
      { xAxisType: 'number' },
    );

    expect(model.status).toBe('ready');
    expect(model.groups.map((group) => group.id)).toEqual(['sequential_count']);
    expect(model.axisData[0]).toEqual(
      expect.objectContaining({ time_period: 'Zero bucket', __x_numeric__: 0 }),
    );
    expect(model.tooltip.labelFormatter(0)).toBe('0');
    expect(model.series[0]).toEqual(
      expect.objectContaining({ key: 'sequential_count', label: 'Sequential Count' }),
    );
  });

  it('sorts numeric buckets by raw time_period and backfills sparse group cells', () => {
    const model = build(
      {
        data: [
          {
            time_period: 10,
            time_period_formatted: 'First label alphabetically',
            period_start: 1,
            period_end: 2,
            group: 'A',
            sequential_count: 3,
          },
          {
            time_period: 2,
            time_period_formatted: 'Last label alphabetically',
            period_start: 100,
            period_end: 101,
            group: 'B',
            sequential_count: 5,
          },
        ],
        analysis_params: { column_type: 'numeric', group_by_columns: ['group'] },
      },
      { xAxisType: 'number' },
    );

    expect(model.axisData.map((row) => row.__x_numeric__)).toEqual([2, 10]);
    const groupA = model.groups.find((group) => group.label === 'A')!;
    const groupB = model.groups.find((group) => group.label === 'B')!;
    expect(model.chartData[0]?.[groupA.id]).toBe(0);
    expect(model.chartData[0]?.[groupB.id]).toBe(5);
    expect(model.chartData[1]?.[groupA.id]).toBe(3);
    expect(model.chartData[1]?.[groupB.id]).toBe(0);
  });

  it('keeps duplicate display labels as distinct buckets and aggregates duplicate group rows', () => {
    const model = build({
      data: [
        {
          time_period: '2024-01',
          time_period_formatted: 'Same label',
          period_start: '2024-01-01',
          period_end: '2024-02-01',
          group: 'A',
          sequential_count: 2,
        },
        {
          time_period: '2024-01',
          time_period_formatted: 'Same label',
          period_start: '2024-01-01',
          period_end: '2024-02-01',
          group: 'A',
          sequential_count: 3,
        },
        {
          time_period: '2024-02',
          time_period_formatted: 'Same label',
          period_start: '2024-02-01',
          period_end: '2024-03-01',
          group: 'A',
          sequential_count: 4,
        },
      ],
      analysis_params: { column_type: 'datetime', group_by_columns: ['group'] },
    });

    expect(model.chartData).toHaveLength(2);
    expect(model.chartData.map((row) => row.time_period)).toEqual(['Same label', 'Same label']);
    const group = model.groups[0];
    expect(group).toBeDefined();
    expect(model.chartData[0]?.[group?.id ?? 'missing']).toBe(5);
    expect(model.chartData[1]?.[group?.id ?? 'missing']).toBe(4);
  });

  it('uses collision-safe ids for equal-looking group tuple labels and reserved column names', () => {
    const reservedRow = Object.fromEntries([
      ['time_period', '2024-01'],
      ['period_start', '2024-01-01'],
      ['period_end', '2024-02-01'],
      ['__proto__', 'safe'],
      ['sequential_count', 1],
    ]);
    const tupleModel = build({
      data: [
        {
          time_period: '2024-01',
          period_start: '2024-01-01',
          period_end: '2024-02-01',
          left: 'a - b',
          right: 'c',
          sequential_count: 1,
        },
        {
          time_period: '2024-01',
          period_start: '2024-01-01',
          period_end: '2024-02-01',
          left: 'a',
          right: 'b - c',
          sequential_count: 2,
        },
      ],
      analysis_params: {
        column_type: 'datetime',
        group_by_columns: ['left', 'right'],
      },
    });
    const reservedModel = build({
      data: [reservedRow],
      analysis_params: { column_type: 'datetime', group_by_columns: ['__proto__'] },
    });

    expect(tupleModel.groups.map((group) => group.label)).toEqual(['a - b - c', 'a - b - c']);
    expect(new Set(tupleModel.groups.map((group) => group.id)).size).toBe(2);
    expect(reservedModel.groups[0]?.values).toHaveProperty('__proto__', 'safe');
    expect(Object.getPrototypeOf(reservedModel.groups[0]?.values)).toBeNull();
  });

  it('keeps null and blank groups distinct and assigns stable colors independent of row order', () => {
    const rows = [
      {
        time_period: '2024-01',
        period_start: '2024-01-01',
        period_end: '2024-02-01',
        group: null,
        sequential_count: 1,
      },
      {
        time_period: '2024-01',
        period_start: '2024-01-01',
        period_end: '2024-02-01',
        group: '',
        sequential_count: 2,
      },
      {
        time_period: '2024-01',
        period_start: '2024-01-01',
        period_end: '2024-02-01',
        group: 'B',
        sequential_count: 3,
      },
    ];
    const input = {
      analysis_params: { column_type: 'datetime', group_by_columns: ['group'] },
    };
    const first = build({ ...input, data: rows });
    const reordered = build({ ...input, data: [...rows].reverse() });

    expect(new Set(first.groups.map((group) => group.id)).size).toBe(3);
    expect(first.groups.map((group) => group.values.group)).toEqual(['', 'B', null]);
    expect(reordered.groups).toEqual(first.groups);
  });

  it('assigns stable series order and colors independent of backend row order', () => {
    const rows = [
      {
        time_period: '2024-01',
        period_start: '2024-01-01',
        period_end: '2024-02-01',
        group: 'B',
        sequential_count: 2,
      },
      {
        time_period: '2024-01',
        period_start: '2024-01-01',
        period_end: '2024-02-01',
        group: 'A',
        sequential_count: 1,
      },
    ];
    const params = { column_type: 'datetime', group_by_columns: ['group'] };
    const forward = build({ data: rows, analysis_params: params });
    const reversed = build({ data: [...rows].reverse(), analysis_params: params });

    expect(forward.groups).toEqual(reversed.groups);
    expect(forward.series).toEqual(reversed.series);
  });

  it('derives visibility, selection, and detach metadata from canonical rows', () => {
    const initial = build({
      data: [
        {
          time_period: '2024-01',
          period_start: '2024-01-01',
          period_end: '2024-02-01',
          group: 'A',
          sequential_count: 2,
        },
        {
          time_period: '2024-01',
          period_start: '2024-01-01',
          period_end: '2024-02-01',
          group: 'B',
          sequential_count: 3,
        },
        {
          time_period: '2024-02',
          period_start: '2024-02-01',
          period_end: '2024-03-01',
          group: 'A',
          sequential_count: 4,
        },
      ],
      total_records: 10,
      analysis_params: { column_type: 'datetime', group_by_columns: ['group'] },
    });
    const hiddenId = initial.groups.find((group) => group.label === 'B')?.id ?? '';
    const model = build(
      {
        data: [
          {
            time_period: '2024-01',
            period_start: '2024-01-01',
            period_end: '2024-02-01',
            group: 'A',
            sequential_count: 2,
          },
          {
            time_period: '2024-01',
            period_start: '2024-01-01',
            period_end: '2024-02-01',
            group: 'B',
            sequential_count: 3,
          },
          {
            time_period: '2024-02',
            period_start: '2024-02-01',
            period_end: '2024-03-01',
            group: 'A',
            sequential_count: 4,
          },
        ],
        total_records: 10,
        analysis_params: { column_type: 'datetime', group_by_columns: ['group'] },
      },
      {
        hiddenKeys: new Set([hiddenId]),
        selectedPeriodIndices: new Set([1]),
        sourceDocumentCount: 20,
      },
    );

    expect(model.counts).toEqual({
      totalPointCount: 10,
      totalDocumentCount: 20,
      shownPointCount: 2,
      shownDocumentCount: 6,
      chosenPointCount: 1,
      chosenDocumentCount: 4,
    });
    expect(model.selection.selectedPeriods).toEqual([
      { period_start: '2024-02-01', period_end: '2024-03-01' },
    ]);
    expect(model.selection.visibleGroups).toEqual([{ values: { group: 'A' } }]);
    expect(model.selection.canDetach).toBe(true);
  });

  it('rejects stale selections and all-hidden ungrouped detach state', () => {
    const result = {
      data: [
        {
          time_period: 1,
          period_start: 0,
          period_end: 2,
          sequential_count: 1,
        },
        {
          time_period: 3,
          period_start: 2,
          period_end: 4,
          sequential_count: 1,
        },
      ],
      analysis_params: { column_type: 'numeric' },
    };

    const stale = build(result, { selectedPeriodIndices: new Set([9]) }).selection;
    expect(stale.canDetach).toBe(false);
    expect(stale.selectedIndices).toEqual(new Set());
    expect(stale.hasInvalidSelection).toBe(true);
    expect(build(result, { selectedPeriodIndices: new Set([0, 1]) }).selection.canDetach).toBe(
      false,
    );
    expect(
      build(result, {
        selectedPeriodIndices: new Set([0]),
        hiddenKeys: new Set(['sequential_count']),
      }).selection.canDetach,
    ).toBe(false);
  });

  it('rejects negative counts and inverted period bounds', () => {
    const model = build({
      data: [
        {
          time_period: 1,
          period_start: 0,
          period_end: 2,
          sequential_count: -1,
        },
        {
          time_period: 3,
          period_start: 4,
          period_end: 2,
          sequential_count: 1,
        },
      ],
      analysis_params: { column_type: 'numeric' },
    });

    expect(model.status).toBe('malformed');
    expect(model.chartData).toEqual([]);
    expect(model.diagnostics.map((item) => item.code)).toEqual(['invalid-count', 'invalid-period']);
  });

  it('reports malformed payloads and retains only rows safe for chart/export/detach', () => {
    const model = build({
      data: [
        {
          time_period: '2024-01',
          period_start: '2024-01-01',
          period_end: '2024-02-01',
          group: 'A',
          sequential_count: 2,
        },
        { time_period: 'missing-boundaries', group: 'B', sequential_count: 3 },
        {
          time_period: '2024-03',
          period_start: '2024-03-01',
          period_end: '2024-04-01',
          group: 'C',
          sequential_count: '4',
        },
        {
          time_period: '2024-04',
          period_start: '2024-04-01',
          period_end: '2024-05-01',
          group: { nested: true },
          sequential_count: 5,
        },
      ],
      analysis_params: {
        column_type: 'datetime',
        group_by_columns: ['group', 42, ''],
      },
    });

    expect(model.status).toBe('malformed');
    expect(model.chartData).toHaveLength(1);
    expect(model.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'invalid-group-columns',
        'invalid-period',
        'invalid-count',
        'invalid-group-value',
      ]),
    );
  });

  it('marks non-array data malformed rather than trusting a result cast', () => {
    const model = build({ data: { row: true }, analysis_params: {} });

    expect(model.status).toBe('malformed');
    expect(model.diagnostics).toEqual([expect.objectContaining({ code: 'invalid-data' })]);
  });

  it('supports saved custom intervals in seconds', () => {
    const model = build({
      data: [],
      analysis_params: {
        column_type: 'datetime',
        frequency: 'custom',
        custom_interval_value: 15,
        custom_interval_unit: 'seconds',
      },
    });

    expect(model.summary.customIntervalUnit).toBe('seconds');
    expect(model.summary.frequencyDisplay).toBe('Every 15 seconds');
  });

  it('uses the declared domain for category tooltips and each chart legend type', () => {
    const numeric = build(
      {
        data: [{ time_period: 0, period_start: -1, period_end: 1, sequential_count: 1 }],
        analysis_params: { column_type: 'numeric' },
      },
      { xAxisType: 'category' },
    );

    expect(numeric.tooltip.labelFormatter(0)).toBe('0');
    expect(
      build(
        {
          data: [
            {
              time_period: '1970-01-01',
              period_start: 0,
              period_end: 1,
              sequential_count: 1,
            },
          ],
          analysis_params: { column_type: 'datetime' },
        },
        { xAxisType: 'number' },
      ).tooltip.labelFormatter(0),
    ).toContain('1970');
    for (const chartType of ['line', 'bar', 'area'] as const) {
      const model = build(
        {
          data: [
            {
              time_period: '2024-01',
              period_start: '2024-01-01',
              period_end: '2024-02-01',
              sequential_count: 1,
            },
          ],
          analysis_params: { column_type: 'datetime' },
        },
        { chartType },
      );
      expect(model.legend[0]?.type).toBe(chartType);
    }
  });

  it.each([
    'line',
    'bar',
    'area',
  ] as const)('keeps colors and single-point metadata stable while emitting %s export legends', (chartType) => {
    const result = {
      data: [
        {
          time_period: '2024-01',
          period_start: '2024-01-01',
          period_end: '2024-02-01',
          group: 'A',
          sequential_count: 1,
        },
        {
          time_period: '2024-01',
          period_start: '2024-01-01',
          period_end: '2024-02-01',
          group: 'B',
          sequential_count: 2,
        },
      ],
      analysis_params: { column_type: 'datetime', group_by_columns: ['group'] },
    };
    const base = build(result, { chartType });
    const hiddenId = base.groups[0]?.id ?? '';
    const hidden = build(result, { chartType, hiddenKeys: new Set([hiddenId]) });

    expect(hidden.groups[0]).toEqual(expect.objectContaining({ color: '#2563eb', hidden: true }));
    expect(hidden.groups[1]).toEqual(expect.objectContaining({ color: '#16a34a', hidden: false }));
    expect(hidden.series).toEqual([
      expect.objectContaining({ color: '#16a34a', singlePoint: true }),
    ]);
    expect(hidden.legend.map((item) => item.type)).toEqual([chartType, chartType]);
  });

  it('formats early datetime epochs as dates while numeric category zero stays numeric', () => {
    const datetime = build(
      {
        data: [{ time_period: 0, period_start: 0, period_end: 1000, sequential_count: 1 }],
        analysis_params: { column_type: 'datetime' },
      },
      { xAxisType: 'number' },
    );
    const numeric = build({
      data: [{ time_period: 0, period_start: -1, period_end: 1, sequential_count: 1 }],
      analysis_params: { column_type: 'numeric' },
    });

    expect(datetime.tooltip.labelFormatter(0)).toContain('1970');
    expect(numeric.tooltip.labelFormatter(0)).toBe('0');
  });

  it('reports invalid custom intervals and invalid persisted group arrays', () => {
    const model = build({
      data: [],
      analysis_params: {
        column_type: 'datetime',
        group_by_columns: 'speaker',
        frequency: 'custom',
        custom_interval_value: -2,
        custom_interval_unit: 'seconds',
      },
    });

    expect(model.status).toBe('malformed');
    expect(model.summary.customIntervalValue).toBeNull();
    expect(model.diagnostics.map((item) => item.code)).toEqual([
      'invalid-group-columns',
      'invalid-parameters',
    ]);
  });

  it('deduplicates repeated saved group columns instead of creating redundant tuple identity', () => {
    const model = build({
      data: [
        {
          time_period: '2024-01',
          period_start: '2024-01-01',
          period_end: '2024-02-01',
          group: 'A',
          sequential_count: 1,
        },
      ],
      analysis_params: {
        column_type: 'datetime',
        group_by_columns: ['group', 'group'],
      },
    });

    expect(model.summary.groupBy).toEqual(['group']);
    expect(model.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-group-columns' }),
    );
    expect(model.selection.visibleGroups).toEqual([{ values: { group: 'A' } }]);
  });

  it('rejects negative or fractional aggregate metadata and uses canonical counts', () => {
    const model = build(
      {
        data: [
          {
            time_period: '2024-01',
            period_start: '2024-01-01',
            period_end: '2024-02-01',
            sequential_count: 3,
          },
        ],
        total_records: -2,
        analysis_params: { column_type: 'datetime' },
      },
      { sourceDocumentCount: 1.5 },
    );

    expect(model.counts.totalPointCount).toBe(1);
    expect(model.counts.totalDocumentCount).toBe(3);
    expect(model.diagnostics.filter((item) => item.code === 'invalid-count')).toHaveLength(2);
  });
});
