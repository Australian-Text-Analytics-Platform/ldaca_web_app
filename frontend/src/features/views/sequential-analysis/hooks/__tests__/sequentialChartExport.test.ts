import { describe, expect, it } from 'vitest';

import { buildSequentialChartExportMetadata } from '../sequentialChartExport';
import { buildSequentialChartModel } from '../sequentialChartModel';

describe('buildSequentialChartExportMetadata', () => {
  it('reuses canonical summary, counts, and grouped legend entries', () => {
    const fallbacks = {
      timeColumn: '',
      groupBy: [],
      columnType: 'datetime' as const,
      numericOrigin: null,
      numericInterval: null,
      frequency: 'daily' as const,
      customIntervalValue: null,
      customIntervalUnit: null,
    };
    const base = buildSequentialChartModel({
      results: {
        data: [
          {
            period_index: 0,
            group_index: 0,
            time_period: '2024-01',
            period_start: '2024-01-01',
            period_end: '2024-02-01',
            speaker: 'Ada',
            sequential_count: 2,
          },
          {
            period_index: 0,
            group_index: 1,
            time_period: '2024-01',
            period_start: '2024-01-01',
            period_end: '2024-02-01',
            speaker: 'Grace',
            sequential_count: 3,
          },
        ],
      },
      parameters: {
        time_column: 'date',
        column_type: 'datetime',
        frequency: 'monthly',
        group_by_columns: ['speaker'],
      },
      fallbacks,
      chartType: 'area',
      xAxisType: 'category',
      uncased: false,
      excludedGroupIndices: new Set(),
      selectedPeriodIndices: new Set(),
    });
    const graceIndex = base.groups.find((group) => group.label === 'Grace')?.memberGroupIndices[0];
    const model = buildSequentialChartModel({
      results: {
        data: [
          {
            period_index: 0,
            group_index: 0,
            time_period: '2024-01',
            period_start: '2024-01-01',
            period_end: '2024-02-01',
            speaker: 'Ada',
            sequential_count: 2,
          },
          {
            period_index: 0,
            group_index: 1,
            time_period: '2024-01',
            period_start: '2024-01-01',
            period_end: '2024-02-01',
            speaker: 'Grace',
            sequential_count: 3,
          },
        ],
      },
      parameters: {
        time_column: 'date',
        column_type: 'datetime',
        frequency: 'monthly',
        group_by_columns: ['speaker'],
      },
      fallbacks,
      chartType: 'area',
      xAxisType: 'category',
      uncased: false,
      excludedGroupIndices: new Set(graceIndex === undefined ? [] : [graceIndex]),
      selectedPeriodIndices: new Set(),
    });

    const metadata = buildSequentialChartExportMetadata({ nodeName: 'Interviews', model });

    expect(metadata.header).toEqual([
      { label: 'Data Block', value: 'Interviews' },
      { label: 'Time Column', value: 'date' },
      { label: 'Frequency', value: 'monthly' },
      { label: 'Total', value: '2/5' },
      { label: 'Shown', value: '1/2' },
      { label: 'Chosen', value: '0/0' },
      { label: 'Groups', value: 'speaker' },
    ]);
    expect(metadata.legend).toEqual([
      { label: 'Ada (2 · 100.0%)', color: '#2563eb', type: 'area', hidden: false },
      { label: 'Grace (3 · Hidden)', color: '#16a34a', type: 'area', hidden: true },
    ]);
  });
});
