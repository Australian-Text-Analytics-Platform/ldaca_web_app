import { describe, expect, it } from 'vitest';

import {
  deriveSequentialResultSummary,
  type SequentialResultSummaryFallbacks,
} from '../useSequentialResultSummary';

const fallbackSummary: SequentialResultSummaryFallbacks = {
  timeColumn: 'fallback_time',
  groupBy: ['fallback_group'],
  columnType: 'numeric',
  numericOrigin: 0,
  numericInterval: 10,
  frequency: 'weekly',
  customIntervalValue: null,
  customIntervalUnit: null,
};

describe('deriveSequentialResultSummary', () => {
  it('prefers saved result parameters and formats custom datetime intervals', () => {
    const summary = deriveSequentialResultSummary(
      {
        analysis_params: {
          time_column: 'created_at',
          group_by_columns: ['speaker'],
          column_type: 'datetime',
          numeric_origin: 50,
          numeric_interval: 25,
          frequency: 'custom',
          custom_interval_value: 5,
          custom_interval_unit: 'days',
        },
      },
      fallbackSummary,
    );

    expect(summary).toEqual({
      timeColumn: 'created_at',
      groupBy: ['speaker'],
      columnType: 'datetime',
      numericOrigin: null,
      numericInterval: null,
      rawFrequency: 'custom',
      customIntervalValue: 5,
      customIntervalUnit: 'days',
      frequencyDisplay: 'Every 5 days',
    });
  });

  it('falls back to live form values and rejects unknown custom interval units', () => {
    const summary = deriveSequentialResultSummary(
      {
        analysis_params: {
          frequency: 'custom',
          custom_interval_value: 3,
          custom_interval_unit: 'fortnights',
        },
      },
      fallbackSummary,
    );

    expect(summary).toEqual({
      timeColumn: 'fallback_time',
      groupBy: ['fallback_group'],
      columnType: 'numeric',
      numericOrigin: 0,
      numericInterval: 10,
      rawFrequency: 'custom',
      customIntervalValue: 3,
      customIntervalUnit: null,
      frequencyDisplay: 'Numeric bins',
    });
  });
});
