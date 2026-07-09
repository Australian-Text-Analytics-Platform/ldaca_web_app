import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  deriveSequentialParameterValues,
  readSequentialServerParams,
  useSequentialAnalysisParameters,
} from '../useSequentialAnalysisParameters';

describe('sequential analysis parameter helpers', () => {
  it('derives numeric request values from editable input strings', () => {
    const values = deriveSequentialParameterValues(
      {
        frequency: 'daily',
        groupByColumns: ['speaker', '', 'region'],
        numericOriginInput: ' 1900 ',
        numericIntervalInput: '10',
        customIntervalValueInput: '30',
        customIntervalUnit: 'minutes',
        caseSensitive: false,
      },
      'numeric',
    );

    expect(values.numericOriginValue).toBe(1900);
    expect(values.numericIntervalValue).toBe(10);
    expect(values.currentSequentialParams).toEqual({
      frequency: 'daily',
      group_by_columns: ['region', 'speaker'],
      column_type: 'numeric',
      numeric_origin: 1900,
      numeric_interval: 10,
      custom_interval_value: null,
      custom_interval_unit: null,
      case_sensitive: false,
    });
  });

  it('derives custom datetime interval values only for custom datetime runs', () => {
    const values = deriveSequentialParameterValues(
      {
        frequency: 'custom',
        groupByColumns: [],
        numericOriginInput: '',
        numericIntervalInput: '1',
        customIntervalValueInput: '15',
        customIntervalUnit: 'minutes',
        caseSensitive: true,
      },
      'datetime',
    );

    expect(values.isCustomDatetime).toBe(true);
    expect(values.customIntervalValue).toBe(15);
    expect(values.customIntervalUnitValue).toBe('minutes');
    expect(values.currentSequentialParams.custom_interval_value).toBe(15);
  });

  it('normalizes stored server request params for rerun comparison', () => {
    expect(
      readSequentialServerParams({
        frequency: 'custom',
        group_by_columns: ['speaker', 5, ''],
        column_type: 'datetime',
        custom_interval_value: 2,
        custom_interval_unit: 'hours',
        case_sensitive: false,
      }),
    ).toEqual({
      frequency: 'custom',
      group_by_columns: ['speaker'],
      column_type: 'datetime',
      numeric_origin: null,
      numeric_interval: null,
      custom_interval_value: 2,
      custom_interval_unit: 'hours',
      case_sensitive: false,
    });
  });
});

describe('useSequentialAnalysisParameters', () => {
  it('caps group-by slots at three and updates slots immutably', () => {
    const { result } = renderHook(() => useSequentialAnalysisParameters());

    act(() => {
      result.current.addGroupByColumn();
      result.current.addGroupByColumn();
      result.current.addGroupByColumn();
      result.current.addGroupByColumn();
      result.current.changeGroupByColumn(1, 'speaker');
    });

    expect(result.current.groupByColumns).toEqual(['', 'speaker', '']);

    act(() => {
      result.current.removeGroupByColumn(0);
    });

    expect(result.current.groupByColumns).toEqual(['speaker', '']);
  });

  it('restores numeric request parameters into editable form state', () => {
    const { result } = renderHook(() => useSequentialAnalysisParameters());
    let hydrated: ReturnType<typeof result.current.applyHydratedRequest> | undefined;

    act(() => {
      hydrated = result.current.applyHydratedRequest({
        node_id: 'node-1',
        time_column: 'year',
        column_type: 'numeric',
        numeric_origin: 1800,
        numeric_interval: 25,
        group_by_columns: ['region'],
        frequency: 'monthly',
        case_sensitive: false,
      });
    });

    expect(result.current.timeColumn).toBe('year');
    expect(result.current.groupByColumns).toEqual(['region']);
    expect(result.current.numericOriginInput).toBe('1800');
    expect(result.current.numericIntervalInput).toBe('25');
    expect(result.current.caseSensitive).toBe(false);
    expect(hydrated?.nodeId).toBe('node-1');
    expect(hydrated?.hydratedParams).toMatchObject({
      timeColumn: 'year',
      columnType: 'numeric',
      numericOrigin: 1800,
      numericInterval: 25,
    });
  });

  it('requires the current node_id request field when hydrating selection', () => {
    const { result } = renderHook(() => useSequentialAnalysisParameters());
    let hydrated: ReturnType<typeof result.current.applyHydratedRequest> | undefined;

    act(() => {
      hydrated = result.current.applyHydratedRequest({
        nodeId: 'old-node',
        time_column: 'year',
      });
    });

    expect(hydrated?.nodeId).toBe('');
  });

  it('resets only non-selection fields after clear', () => {
    const { result } = renderHook(() => useSequentialAnalysisParameters());

    act(() => {
      result.current.setFrequency('weekly');
      result.current.setTimeColumn('date');
      result.current.setGroupByColumns(['speaker']);
      result.current.setCaseSensitive(false);
      result.current.setNumericOriginInput('1990');
      result.current.setNumericIntervalInput('5');
      result.current.setCustomIntervalValueInput('4');
      result.current.setCustomIntervalUnit('hours');
      result.current.resetAfterClear();
    });

    expect(result.current.frequency).toBe('weekly');
    expect(result.current.timeColumn).toBe('date');
    expect(result.current.groupByColumns).toEqual(['speaker']);
    expect(result.current.caseSensitive).toBe(true);
    expect(result.current.numericOriginInput).toBe('');
    expect(result.current.numericIntervalInput).toBe('1');
    expect(result.current.customIntervalValueInput).toBe('1');
    expect(result.current.customIntervalUnit).toBe('minutes');
  });
});
