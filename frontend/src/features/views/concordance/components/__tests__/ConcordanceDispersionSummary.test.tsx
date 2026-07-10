import { act, render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConcordanceDispersionSummary } from '../ConcordanceDispersionSummary';

const { chartProps } = vi.hoisted(() => ({
  chartProps: {
    lineChartProps: [] as {
      data?: Record<string, unknown>[];
      onMouseDown?: (
        state: { activeTooltipIndex?: number | string },
        event: { shiftKey?: boolean },
      ) => void;
      onMouseMove?: (state: { activeTooltipIndex?: number | string }) => void;
      onMouseUp?: (
        state: { activeTooltipIndex?: number | string },
        event: { shiftKey?: boolean },
      ) => void;
    }[],
    lineProps: [] as Record<string, unknown>[],
    referenceAreaProps: [] as Record<string, unknown>[],
    referenceLineProps: [] as Record<string, unknown>[],
  },
}));

vi.mock('recharts', () => ({
  // Used by: ConcordanceDispersionSummary tests because they inspect the
  // Recharts configuration without relying on SVG layout in jsdom.
  LineChart: (props: {
    data?: Record<string, unknown>[];
    children?: React.ReactNode;
    onMouseDown?: (
      state: { activeTooltipIndex?: number | string },
      event: { shiftKey?: boolean },
    ) => void;
    onMouseMove?: (state: { activeTooltipIndex?: number | string }) => void;
    onMouseUp?: (
      state: { activeTooltipIndex?: number | string },
      event: { shiftKey?: boolean },
    ) => void;
  }) => {
    const { data, onMouseDown, onMouseMove, onMouseUp } = props;
    chartProps.lineChartProps.push({ data, onMouseDown, onMouseMove, onMouseUp });
    return <div data-testid="line-chart">{props.children}</div>;
  },
  Line: (props: Record<string, unknown>) => {
    const { dataKey, dot, stroke, strokeDasharray, type } = props;
    chartProps.lineProps.push({ dataKey, dot, stroke, strokeDasharray, type });
    return <div data-testid="line" />;
  },
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  Tooltip: () => <div data-testid="chart-tooltip" />,
  ReferenceArea: (props: Record<string, unknown>) => {
    chartProps.referenceAreaProps.push(props);
    return <div data-testid="reference-area" />;
  },
  ReferenceLine: (props: Record<string, unknown>) => {
    chartProps.referenceLineProps.push(props);
    return <div data-testid="reference-line" />;
  },
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Area: () => <div data-testid="area" />,
  AreaChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Bar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Cell: () => <div data-testid="cell" />,
}));

const baseRows = [
  {
    text: 'alpha beta alpha',
    CONC_dispersion: [
      {
        CONC_start_idx: 0,
        CONC_end_idx: 5,
        CONC_matched_text: 'alpha',
      },
    ],
  },
];

describe('ConcordanceDispersionSummary', () => {
  afterEach(() => {
    chartProps.lineChartProps.length = 0;
    chartProps.lineProps.length = 0;
    chartProps.referenceAreaProps.length = 0;
    chartProps.referenceLineProps.length = 0;
  });

  it('renders chart controls with shadcn selects and keeps the unprocessed scope disabled', () => {
    render(
      <ConcordanceDispersionSummary
        rows={baseRows}
        textColumn="text"
        binCount={20}
        lowercaseMatches={false}
        splitBySource={false}
        allMatchedTexts={[]}
        matchedTextColors={{}}
        hiddenMatchedTexts={new Set()}
        dataBlockLabel="Corpus"
        searchWord="alpha"
        aggregateAll
        chartMode="density"
        onChartModeChange={vi.fn()}
        onBinCountChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Bin No.' })).toHaveAttribute(
      'data-state',
      'closed',
    );
    expect(screen.getByRole('combobox', { name: 'Chart' })).toHaveAttribute('data-state', 'closed');
    expect(screen.getByRole('combobox', { name: 'Chart' })).toHaveTextContent('Density');
    expect(screen.getByText('Density dispersion')).toBeInTheDocument();
    const scopeSelect = screen.getByRole('combobox', { name: 'Aggregation scope' });
    expect(scopeSelect).toHaveAttribute('data-state', 'closed');
    expect(scopeSelect).toBeDisabled();
    expect(scopeSelect).toHaveTextContent('page above');
  });

  it('uses node colors for aggregate and source-split chart series', () => {
    render(
      <ConcordanceDispersionSummary
        rows={baseRows}
        textColumn="text"
        binCount={20}
        lowercaseMatches={false}
        splitBySource={false}
        allMatchedTexts={[]}
        matchedTextColors={{}}
        hiddenMatchedTexts={new Set()}
        dataBlockLabel="Corpus"
        searchWord="alpha"
        aggregateAll
        sourceColor="#123456"
      />,
    );

    expect(chartProps.lineProps.at(-1)).toMatchObject({
      dataKey: '__dispersion_total__',
      stroke: 'var(--color--dispersion-total-)',
      type: 'natural',
    });
    expect(chartProps.lineProps.at(-1)?.dot).toEqual({
      fill: 'var(--color--dispersion-total-)',
    });
  });

  it('renders cumulative charts as stepped running totals with source colors', () => {
    render(
      <ConcordanceDispersionSummary
        rows={[]}
        textColumn="text"
        binCount={20}
        lowercaseMatches={false}
        splitBySource
        allMatchedTexts={[]}
        matchedTextColors={{}}
        hiddenMatchedTexts={new Set()}
        dataBlockLabel="Combined"
        searchWord="alpha"
        aggregateAll
        chartMode="cumulative"
        materialised
        materialisedBins={[
          { bin_idx: 0, matched_text: 'alpha', count: 2, __source_node: 'Left Corpus' },
          { bin_idx: 5, matched_text: 'alpha', count: 3, __source_node: 'Right Corpus' },
        ]}
        sourceColors={{
          'left corpus': '#aa0000',
          'right corpus': '#00aa00',
        }}
      />,
    );

    expect(screen.getByText('Cumulative dispersion')).toBeInTheDocument();
    expect(chartProps.lineProps).toHaveLength(2);
    expect(chartProps.lineProps[0]).toMatchObject({
      dataKey: '__dispersion_total__\0Left Corpus',
      stroke: 'var(--color--dispersion-total-left-corpus)',
      type: 'step',
      dot: false,
    });
    expect(chartProps.lineProps[1]).toMatchObject({
      dataKey: '__dispersion_total__\0Right Corpus',
      stroke: 'var(--color--dispersion-total-right-corpus)',
      strokeDasharray: '6 4',
      type: 'step',
      dot: false,
    });
    expect(chartProps.lineChartProps.at(-1)?.data?.slice(0, 2)).toEqual([
      {
        binCenter: 2.5,
        '__dispersion_total__\0Left Corpus': 2,
        '__dispersion_total__\0Right Corpus': 0,
      },
      {
        binCenter: 7.5,
        '__dispersion_total__\0Left Corpus': 2,
        '__dispersion_total__\0Right Corpus': 3,
      },
    ]);
  });

  it('shows drag affordances while selecting and commits the dragged bin range', () => {
    const onSelect = vi.fn();
    const onSelectRange = vi.fn();

    render(
      <ConcordanceDispersionSummary
        rows={baseRows}
        textColumn="text"
        binCount={20}
        lowercaseMatches={false}
        splitBySource={false}
        allMatchedTexts={[]}
        matchedTextColors={{}}
        hiddenMatchedTexts={new Set()}
        dataBlockLabel="Corpus"
        searchWord="alpha"
        aggregateAll
        selection={{
          selectedIndices: new Set(),
          onSelect,
          onSelectRange,
          onClear: vi.fn(),
        }}
      />,
    );

    act(() => {
      chartProps.lineChartProps.at(-1)?.onMouseDown?.({ activeTooltipIndex: 1 }, {});
    });

    expect(chartProps.referenceLineProps.at(-1)).toMatchObject({
      x: 7.5,
    });

    act(() => {
      chartProps.lineChartProps.at(-1)?.onMouseMove?.({ activeTooltipIndex: 4 });
    });

    expect(chartProps.referenceAreaProps.at(-1)).toMatchObject({
      x1: 5,
      x2: 25,
    });

    act(() => {
      chartProps.lineChartProps.at(-1)?.onMouseUp?.({ activeTooltipIndex: 4 }, {});
    });

    expect(onSelectRange).toHaveBeenCalledWith(1, 4, false);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId('reference-line')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reference-area')).not.toBeInTheDocument();
  });

  it('keeps single-bin click selection when mouse down and up stay on one point', () => {
    const onSelect = vi.fn();
    const onSelectRange = vi.fn();

    render(
      <ConcordanceDispersionSummary
        rows={baseRows}
        textColumn="text"
        binCount={20}
        lowercaseMatches={false}
        splitBySource={false}
        allMatchedTexts={[]}
        matchedTextColors={{}}
        hiddenMatchedTexts={new Set()}
        dataBlockLabel="Corpus"
        searchWord="alpha"
        aggregateAll
        selection={{
          selectedIndices: new Set(),
          onSelect,
          onSelectRange,
          onClear: vi.fn(),
        }}
      />,
    );

    act(() => {
      chartProps.lineChartProps.at(-1)?.onMouseDown?.({ activeTooltipIndex: 3 }, {});
      chartProps.lineChartProps.at(-1)?.onMouseUp?.({ activeTooltipIndex: 3 }, {});
    });

    expect(onSelect).toHaveBeenCalledWith(3, false);
    expect(onSelectRange).not.toHaveBeenCalled();
  });
});
