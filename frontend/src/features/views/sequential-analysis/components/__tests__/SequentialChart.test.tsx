import { fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SequentialChart } from '../SequentialChart';
import { buildSequentialChartModel } from '../../hooks/sequentialChartModel';

vi.mock('@/features/views/common/components/EChartsView', () => ({
  EChartsView: () => <div data-testid="echarts-view" />,
}));

const model = buildSequentialChartModel({
  results: {
    data: [
      {
        time_period: '2024-01',
        period_index: 0,
        group_index: 0,
        period_start: '2024-01-01',
        period_end: '2024-02-01',
        sequential_count: 1,
      },
      {
        time_period: '2024-02',
        period_index: 1,
        group_index: 0,
        period_start: '2024-02-01',
        period_end: '2024-03-01',
        sequential_count: 2,
      },
    ],
  },
  parameters: { column_type: 'datetime' },
  fallbacks: {
    timeColumn: 'date',
    groupBy: [],
    columnType: 'datetime',
    numericOrigin: null,
    numericInterval: null,
    frequency: 'monthly',
    customIntervalValue: null,
    customIntervalUnit: null,
  },
  chartType: 'line',
  xAxisType: 'category',
  uncased: false,
  excludedGroupIndices: new Set(),
  selectedPeriodIndices: new Set([0]),
});

describe('SequentialChart', () => {
  it('renders canonical chart model metadata', () => {
    const containerRef = createRef<HTMLDivElement>();

    render(
      <SequentialChart
        model={model}
        onToggleGroupIndices={vi.fn()}
        onUncasedChange={vi.fn()}
        onPeriodClick={vi.fn()}
        onPeriodRangeSelect={vi.fn()}
        onClearSelection={vi.fn()}
        dataResetKey="task-1"
        containerRef={containerRef}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Sequential Count (1/3 · 100.0%)' }),
    ).toBeInTheDocument();
    expect(containerRef.current).toBeInstanceOf(HTMLDivElement);
    expect(
      within(screen.getByTestId('filterable-series-controls')).getByRole('button', {
        name: 'Clear Selection',
      }),
    ).toBeEnabled();
    expect(screen.queryByText(/data points but only/)).not.toBeInTheDocument();
  });

  it('shows the shared Uncased control for string-valued result groups', () => {
    const groupedModel = buildSequentialChartModel({
      results: {
        data: [
          {
            time_period: '2024-01',
            period_index: 0,
            group_index: 0,
            period_start: '2024-01-01',
            period_end: '2024-02-01',
            group: 'Jobs',
            sequential_count: 1,
          },
          {
            time_period: '2024-01',
            period_index: 0,
            group_index: 1,
            period_start: '2024-01-01',
            period_end: '2024-02-01',
            group: 'jobs',
            sequential_count: 2,
          },
        ],
      },
      parameters: { column_type: 'datetime', group_by_columns: ['group'] },
      fallbacks: {
        timeColumn: 'date',
        groupBy: ['group'],
        columnType: 'datetime',
        numericOrigin: null,
        numericInterval: null,
        frequency: 'monthly',
        customIntervalValue: null,
        customIntervalUnit: null,
      },
      chartType: 'line',
      xAxisType: 'category',
      uncased: true,
      excludedGroupIndices: new Set(),
      selectedPeriodIndices: new Set(),
    });

    const onToggleGroupIndices = vi.fn();
    render(
      <SequentialChart
        model={groupedModel}
        onToggleGroupIndices={onToggleGroupIndices}
        onUncasedChange={vi.fn()}
        onPeriodClick={vi.fn()}
        onPeriodRangeSelect={vi.fn()}
        onClearSelection={vi.fn()}
        dataResetKey="task-2"
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'Uncased' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'jobs/Jobs (3 · 100.0%)' }));
    expect(onToggleGroupIndices).toHaveBeenCalledWith([0, 1]);
  });
});
