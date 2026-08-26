import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
    barChartProps: [] as Record<string, unknown>[],
    barProps: [] as Record<string, unknown>[],
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
  AreaChart: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Bar: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
    const { children, ...capturedProps } = props;
    chartProps.barProps.push(capturedProps);
    return <div data-testid="bar">{children}</div>;
  },
  BarChart: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
    const { children, ...capturedProps } = props;
    chartProps.barChartProps.push(capturedProps);
    return <div data-testid="bar-chart">{children}</div>;
  },
  Rectangle: () => <div data-testid="rectangle" />,
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
    chartProps.barChartProps.length = 0;
    chartProps.barProps.length = 0;
    chartProps.referenceAreaProps.length = 0;
    chartProps.referenceLineProps.length = 0;
  });

  it('renders chart controls with shadcn selects', () => {
    render(
      <ConcordanceDispersionSummary
        rows={baseRows}
        textColumn="text"
        binCount={20}
        splitBySource={false}
        dataBlockLabel="Corpus"
        searchWord="alpha"
        chartMode="density-line"
        onChartModeChange={vi.fn()}
        onBinCountChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Bin No.' })).toHaveAttribute(
      'data-state',
      'closed',
    );
    expect(screen.getByRole('combobox', { name: 'Chart' })).toHaveAttribute('data-state', 'closed');
    expect(screen.getByRole('combobox', { name: 'Chart' })).toHaveTextContent('Density: line');
    expect(screen.getByText('Density: line dispersion')).toBeInTheDocument();
  });

  it('hides the cumulative chart option behind an expandable menu row', () => {
    const onChartModeChange = vi.fn();
    render(
      <ConcordanceDispersionSummary
        rows={baseRows}
        textColumn="text"
        binCount={20}
        splitBySource={false}
        dataBlockLabel="Corpus"
        searchWord="alpha"
        chartMode="density-line"
        onChartModeChange={onChartModeChange}
      />,
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'Chart' }));
    expect(screen.queryByRole('button', { name: 'Cumulative' })).not.toBeInTheDocument();

    const moreButton = screen.getByRole('button', { name: 'More' });
    expect(moreButton).toHaveAttribute('data-state', 'closed');
    fireEvent.click(moreButton);
    expect(moreButton).toHaveAttribute('data-state', 'open');

    fireEvent.click(screen.getByRole('button', { name: 'Cumulative' }));
    expect(onChartModeChange).toHaveBeenCalledWith('cumulative');
  });

  it('renders density as line, bar, or area from the chart selector mode', () => {
    const props = {
      rows: baseRows,
      textColumn: 'text',
      binCount: 20 as const,
      splitBySource: false,
      dataBlockLabel: 'Corpus',
      searchWord: 'alpha',
    };
    const { rerender } = render(
      <ConcordanceDispersionSummary {...props} chartMode="density-line" />,
    );

    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(screen.getByTestId('line')).toBeInTheDocument();

    rerender(<ConcordanceDispersionSummary {...props} chartMode="density-bar" />);
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(screen.getByTestId('bar')).toBeInTheDocument();

    rerender(<ConcordanceDispersionSummary {...props} chartMode="density-area" />);
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    expect(screen.getByTestId('area')).toBeInTheDocument();
  });

  it.each([4, 5, 10] as const)(
    'groups bars closely and alternates bin backgrounds at %i bins',
    (binCount) => {
      render(
        <ConcordanceDispersionSummary
          rows={[]}
          textColumn="text"
          binCount={binCount}
          splitBySource={false}
          dataBlockLabel="Corpus"
          searchWord="jobs Jobs"
          chartMode="density-bar"
          densitySeries={[
            { label: 'jobs', counts: Array.from({ length: 100 }, () => 1) },
            { label: 'Jobs', counts: Array.from({ length: 100 }, () => 2) },
          ]}
        />,
      );

      expect(chartProps.barChartProps.at(-1)).toMatchObject({
        barGap: 1,
        barCategoryGap: '8%',
      });
      expect(chartProps.barProps).toHaveLength(2);
      expect(chartProps.barProps.every((props) => props.stackId === undefined)).toBe(true);
      expect(chartProps.barProps.every((props) => Array.isArray(props.radius))).toBe(true);
      expect(chartProps.referenceAreaProps).toHaveLength(Math.ceil(binCount / 2));
      expect(chartProps.referenceAreaProps[0]).toMatchObject({
        x1: 0,
        x2: 100 / binCount,
        fill: 'var(--muted)',
      });
    },
  );

  it.each([20, 25, 50, 100] as const)(
    'stacks bar series without alternating backgrounds at %i bins',
    (binCount) => {
      render(
        <ConcordanceDispersionSummary
          rows={[]}
          textColumn="text"
          binCount={binCount}
          splitBySource={false}
          dataBlockLabel="Corpus"
          searchWord="jobs Jobs"
          chartMode="density-bar"
          densitySeries={[
            { label: 'jobs', counts: Array.from({ length: 100 }, () => 1) },
            { label: 'Jobs', counts: Array.from({ length: 100 }, () => 2) },
          ]}
        />,
      );

      expect(chartProps.barProps).toHaveLength(2);
      expect(chartProps.barProps.every((props) => props.stackId === 'density')).toBe(true);
      expect(chartProps.barProps.every((props) => props.radius === 0)).toBe(true);
      expect(chartProps.referenceAreaProps).toHaveLength(0);
    },
  );

  it('keeps the chart card neutral without repeating the source description', () => {
    render(
      <ConcordanceDispersionSummary
        rows={baseRows}
        textColumn="text"
        binCount={20}
        splitBySource={false}
        dataBlockLabel="Corpus"
        searchWord="alpha"
        densitySeries={[{ label: 'alpha', counts: Array.from({ length: 100 }, () => 1) }]}
      />,
    );

    expect(
      screen.queryByText(
        'Corpus: exact-term matches at relative locations across the entire Result',
      ),
    ).not.toBeInTheDocument();
    const chart = screen.getByTestId('concordance-dispersion-chart');
    expect(chart.style.borderLeftWidth).toBe('');
    expect(chart.style.borderLeftColor).toBe('');
    expect(chart).not.toHaveClass('mt-4');
  });

  it('keeps match controls available when the optional chart is hidden', () => {
    render(
      <ConcordanceDispersionSummary
        rows={baseRows}
        textColumn="text"
        binCount={20}
        splitBySource={false}
        dataBlockLabel="Corpus"
        searchWord="alpha"
        showChart={false}
        onUncasedMatchedTextsChange={vi.fn()}
        onToggleMatchedTexts={vi.fn()}
      />,
    );

    expect(screen.getByTestId('concordance-dispersion-match-controls')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'alpha (1)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Uncased' })).toBeInTheDocument();
    expect(screen.queryByTestId('concordance-dispersion-chart')).not.toBeInTheDocument();
  });

  it('keeps hidden exact terms in the interactive legend with selected-bin counts', () => {
    const alphaCounts = Array.from({ length: 100 }, () => 0);
    alphaCounts[0] = 2;
    const lowerCounts = Array.from({ length: 100 }, () => 0);
    lowerCounts[1] = 1;
    const onToggle = vi.fn();
    render(
      <ConcordanceDispersionSummary
        rows={[]}
        textColumn="text"
        binCount={20}
        splitBySource={false}
        dataBlockLabel="Corpus"
        searchWord="alpha"
        densitySeries={[
          { label: 'Alpha', counts: alphaCounts },
          { label: 'alpha', counts: lowerCounts },
        ]}
        selection={{
          selectedIndices: new Set([0]),
          onSelect: vi.fn(),
          onSelectRange: vi.fn(),
          onClear: vi.fn(),
        }}
        excludedMatchedTexts={new Set(['alpha'])}
        onToggleMatchedTexts={onToggle}
      />,
    );

    const controls = screen.getByTestId('concordance-dispersion-match-controls');
    const chart = screen.getByTestId('concordance-dispersion-chart');
    expect(controls.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(chart).queryByRole('button', { name: 'Alpha (2/2)' })).not.toBeInTheDocument();
    expect(within(controls).getByRole('button', { name: 'Alpha (2/2)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    const hidden = within(controls).getByRole('button', { name: 'alpha (1/1)' });
    expect(hidden).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId('line')).toHaveLength(1);
    fireEvent.click(hidden);
    expect(onToggle).toHaveBeenCalledWith(['alpha']);
  });

  it('uses deterministic matched-term colors for chart series', () => {
    render(
      <ConcordanceDispersionSummary
        rows={baseRows}
        textColumn="text"
        binCount={20}
        splitBySource={false}
        dataBlockLabel="Corpus"
        searchWord="alpha"
        termColors={{ alpha: '#123456' }}
      />,
    );

    expect(chartProps.lineProps.at(-1)).toMatchObject({
      dataKey: 'term:alpha',
      stroke: 'var(--color-term-alpha)',
      type: 'natural',
    });
    expect(chartProps.lineProps.at(-1)?.dot).toEqual({
      fill: 'var(--color-term-alpha)',
    });
  });

  it('keeps case-sensitive term colors distinct between chart lines and the legend', () => {
    render(
      <ConcordanceDispersionSummary
        rows={[]}
        textColumn="text"
        binCount={20}
        splitBySource={false}
        dataBlockLabel="Corpus"
        searchWord="jobs Jobs"
        densitySeries={[
          { label: 'jobs', counts: Array.from({ length: 100 }, () => 1) },
          { label: 'Jobs', counts: Array.from({ length: 100 }, () => 2) },
        ]}
        termColors={{ jobs: '#123456', Jobs: '#abcdef' }}
      />,
    );

    expect(chartProps.lineProps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dataKey: 'term:jobs', stroke: 'var(--color-term-jobs)' }),
        expect.objectContaining({ dataKey: 'term:Jobs', stroke: 'var(--color-term-Jobs)' }),
      ]),
    );
  });

  it('merges case variants into one series and grouped legend when uncased is enabled', () => {
    const lowerCounts = Array.from({ length: 100 }, () => 0);
    lowerCounts[0] = 35;
    const titleCounts = Array.from({ length: 100 }, () => 0);
    titleCounts[0] = 2;
    const onToggle = vi.fn();
    const onUncasedChange = vi.fn();

    render(
      <ConcordanceDispersionSummary
        rows={[]}
        textColumn="text"
        binCount={20}
        splitBySource={false}
        dataBlockLabel="Corpus"
        searchWord="jobs"
        densitySeries={[
          { label: 'jobs', counts: lowerCounts },
          { label: 'Jobs', counts: titleCounts },
        ]}
        termColors={{ jobs: '#123456', Jobs: '#abcdef' }}
        uncasedMatchedTexts
        onUncasedMatchedTextsChange={onUncasedChange}
        onToggleMatchedTexts={onToggle}
      />,
    );

    expect(screen.getAllByTestId('line')).toHaveLength(1);
    expect(chartProps.lineProps[0]).toMatchObject({
      dataKey: 'term:jobs',
      stroke: 'var(--color-term-jobs)',
    });
    const groupedLegend = screen.getByRole('button', { name: 'jobs/Jobs (37)' });
    fireEvent.click(groupedLegend);
    expect(onToggle).toHaveBeenCalledWith(['jobs', 'Jobs']);

    const controls = screen.getByTestId('concordance-dispersion-match-controls');
    const chart = screen.getByTestId('concordance-dispersion-chart');
    const uncased = within(controls).getByRole('checkbox', { name: 'Uncased' });
    expect(within(chart).queryByRole('checkbox', { name: 'Uncased' })).not.toBeInTheDocument();
    expect(uncased).toBeChecked();
    fireEvent.click(uncased);
    expect(onUncasedChange).toHaveBeenCalledWith(false);
  });

  it('renders cumulative charts as stepped running totals pooled by exact term', () => {
    render(
      <ConcordanceDispersionSummary
        rows={[
          {
            text: 'x'.repeat(100),
            __source_node: 'Left Corpus',
            CONC_dispersion: [{ CONC_start_idx: 0, CONC_end_idx: 1, CONC_matched_text: 'alpha' }],
          },
          {
            text: 'x'.repeat(100),
            __source_node: 'Right Corpus',
            CONC_dispersion: [{ CONC_start_idx: 25, CONC_end_idx: 26, CONC_matched_text: 'alpha' }],
          },
        ]}
        textColumn="text"
        binCount={20}
        splitBySource
        dataBlockLabel="Combined"
        searchWord="alpha"
        chartMode="cumulative"
        termColors={{ alpha: '#aa0000' }}
      />,
    );

    expect(screen.getByText('Cumulative dispersion')).toBeInTheDocument();
    expect(chartProps.lineProps).toHaveLength(1);
    expect(chartProps.lineProps[0]).toMatchObject({
      dataKey: 'term:alpha',
      stroke: 'var(--color-term-alpha)',
      type: 'step',
      dot: false,
    });
    const chartData = chartProps.lineChartProps.at(-1)?.data;
    expect(chartData?.[0]).toMatchObject({
      binCenter: 2.5,
      'term:alpha': 1,
    });
    expect(chartData?.[5]).toMatchObject({
      binCenter: expect.closeTo(27.5),
      'term:alpha': 2,
    });
  });

  it('shows drag affordances while selecting and commits the dragged bin range', () => {
    const onSelect = vi.fn();
    const onSelectRange = vi.fn();

    render(
      <ConcordanceDispersionSummary
        rows={baseRows}
        textColumn="text"
        binCount={20}
        splitBySource={false}
        dataBlockLabel="Corpus"
        searchWord="alpha"
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
        splitBySource={false}
        dataBlockLabel="Corpus"
        searchWord="alpha"
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
