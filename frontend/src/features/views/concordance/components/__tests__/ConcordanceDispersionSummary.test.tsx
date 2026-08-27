import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConcordanceDispersionSummary } from '../ConcordanceDispersionSummary';

interface CapturedChart {
  option: Record<string, unknown>;
  onSelect?: (index: number, shiftHeld: boolean) => void;
  onSelectRange?: (startIndex: number, endIndex: number, shiftHeld: boolean) => void;
}

const { charts } = vi.hoisted(() => ({ charts: [] as CapturedChart[] }));

vi.mock('@/features/views/common/components/EChartsView', () => ({
  EChartsView: (props: CapturedChart) => {
    charts.push(props);
    return <div data-testid="concordance-echarts" />;
  },
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

const lastOption = () => charts.at(-1)?.option;
const optionSeries = () => (lastOption()?.series ?? []) as Record<string, unknown>[];
const optionSource = () => {
  const dataset = lastOption()?.dataset as { source?: Record<string, unknown>[] } | undefined;
  return dataset?.source ?? [];
};

describe('ConcordanceDispersionSummary', () => {
  afterEach(() => {
    charts.length = 0;
  });

  it('renders chart controls and the ECharts boundary', () => {
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
    expect(screen.getByRole('combobox', { name: 'Chart' })).toHaveTextContent('Density: line');
    expect(screen.getByText('Density: line dispersion')).toBeInTheDocument();
    expect(screen.getByTestId('concordance-echarts')).toBeInTheDocument();
  });

  it('keeps cumulative behind More and forwards the selected chart mode', () => {
    const onChartModeChange = vi.fn();
    render(
      <ConcordanceDispersionSummary
        rows={baseRows}
        textColumn="text"
        binCount={20}
        splitBySource={false}
        dataBlockLabel="Corpus"
        searchWord="alpha"
        onChartModeChange={onChartModeChange}
      />,
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'Chart' }));
    expect(screen.queryByRole('button', { name: 'Cumulative' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cumulative' }));
    expect(onChartModeChange).toHaveBeenCalledWith('cumulative');
  });

  it('maps density line, bar, and area modes to ECharts series', () => {
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
    expect(optionSeries()[0]).toMatchObject({ type: 'line', showSymbol: true });
    expect(optionSeries()[0]).toMatchObject({ smooth: true });

    rerender(<ConcordanceDispersionSummary {...props} chartMode="density-bar" />);
    expect(optionSeries()[0]).toMatchObject({ type: 'bar', stack: 'density' });

    rerender(<ConcordanceDispersionSummary {...props} chartMode="density-area" />);
    expect(optionSeries()[0]).toMatchObject({ type: 'line', stack: 'density' });
    expect(optionSeries()[0]?.areaStyle).toBeTruthy();
  });

  it.each([4, 5, 10] as const)(
    'groups bars at %i bins without extra background components',
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

      expect(optionSeries()).toHaveLength(2);
      expect(optionSeries().every((item) => item.stack === undefined)).toBe(true);
      expect(optionSeries()[0]).toMatchObject({ barGap: '10%', barCategoryGap: '8%' });
      expect(optionSeries()[0]?.markArea).toBeUndefined();
    },
  );

  it.each([20, 25, 50, 100] as const)('stacks bar series at %i bins', (binCount) => {
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

    expect(optionSeries().every((item) => item.stack === 'density')).toBe(true);
    expect(optionSeries()[0]?.markArea).toBeUndefined();
  });

  it('keeps shared match controls mounted when the chart is hidden', () => {
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

  it('keeps hidden terms in the legend and removes them from the ECharts series', () => {
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
          { label: 'Alpha', counts: Array.from({ length: 100 }, () => 2) },
          { label: 'alpha', counts: Array.from({ length: 100 }, () => 1) },
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
    const hidden = within(controls).getByRole('button', { name: 'alpha (5/100)' });
    expect(hidden).toHaveAttribute('aria-pressed', 'true');
    expect(optionSeries()).toHaveLength(1);
    fireEvent.click(hidden);
    expect(onToggle).toHaveBeenCalledWith(['alpha']);
  });

  it('uses exact matched-term colors and merges case variants when uncased', () => {
    const onToggle = vi.fn();
    render(
      <ConcordanceDispersionSummary
        rows={[]}
        textColumn="text"
        binCount={20}
        splitBySource={false}
        dataBlockLabel="Corpus"
        searchWord="jobs"
        densitySeries={[
          { label: 'jobs', counts: Array.from({ length: 100 }, () => 1) },
          { label: 'Jobs', counts: Array.from({ length: 100 }, () => 2) },
        ]}
        termColors={{ jobs: '#123456', Jobs: '#abcdef' }}
        uncasedMatchedTexts
        onToggleMatchedTexts={onToggle}
      />,
    );

    expect(optionSeries()).toHaveLength(1);
    expect(optionSeries()[0]).toMatchObject({
      id: 'term:jobs',
      itemStyle: { color: '#123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'jobs/Jobs (300)' }));
    expect(onToggle).toHaveBeenCalledWith(['jobs', 'Jobs']);
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

    expect(optionSeries()[0]).toMatchObject({ type: 'line', step: 'middle', showSymbol: false });
    expect(optionSeries()[0]).not.toHaveProperty('smooth');
    expect(optionSource()[0]).toMatchObject({ binCenter: 2.5, 'term:alpha': 1 });
    expect(optionSource()[5]).toMatchObject({
      binCenter: expect.closeTo(27.5),
      'term:alpha': 2,
    });
  });

  it('forwards point and brush-range selection callbacks to the ECharts boundary', () => {
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
        selection={{ selectedIndices: new Set(), onSelect, onSelectRange, onClear: vi.fn() }}
      />,
    );

    charts.at(-1)?.onSelect?.(3, true);
    charts.at(-1)?.onSelectRange?.(1, 4, false);
    expect(onSelect).toHaveBeenCalledWith(3, true);
    expect(onSelectRange).toHaveBeenCalledWith(1, 4, false);
  });
});
