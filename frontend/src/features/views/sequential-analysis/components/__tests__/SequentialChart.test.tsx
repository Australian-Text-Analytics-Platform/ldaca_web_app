import { act, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SequentialChart } from '../SequentialChart';
import { buildSequentialChartModel } from '../../hooks/sequentialChartModel';

const model = buildSequentialChartModel({
  results: {
    data: [
      {
        time_period: '2024-01',
        period_start: '2024-01-01',
        period_end: '2024-02-01',
        sequential_count: 1,
      },
      {
        time_period: '2024-02',
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
  hiddenKeys: new Set(),
  selectedPeriodIndices: new Set([0]),
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SequentialChart', () => {
  it('renders canonical model metadata and keeps ResizeObserver warnings responsive', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let width = 1;
    const callbacks: ResizeObserverCallback[] = [];
    class TestResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {
        /* Triggered manually after render. */
      }
      unobserve() {
        /* no-op */
      }
      disconnect() {
        /* no-op */
      }
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    const containerRef = createRef<HTMLDivElement>();

    render(
      <SequentialChart
        model={model}
        isAddingToWorkspace={false}
        onToggleKey={vi.fn()}
        onPeriodClick={vi.fn()}
        onClearSelection={vi.fn()}
        containerRef={containerRef}
      />,
    );

    expect(screen.getByRole('button', { name: 'Hide Sequential Count' })).toBeInTheDocument();
    expect(containerRef.current).toBeInstanceOf(HTMLDivElement);
    expect(screen.getByRole('button', { name: 'Clear Selection' })).toBeEnabled();
    expect(screen.getByText(/2 data points but only 1 px/)).toBeInTheDocument();

    width = 100;
    act(() => {
      callbacks.forEach((callback) => {
        callback([], {} as ResizeObserver);
      });
    });
    expect(screen.queryByText(/data points but only/)).not.toBeInTheDocument();
  });
});
