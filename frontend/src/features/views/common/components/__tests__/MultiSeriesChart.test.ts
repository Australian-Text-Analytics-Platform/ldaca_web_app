import { describe, expect, it } from 'vitest';

import { buildMultiSeriesChartOption } from '../MultiSeriesChart';

const data = [
  { period: '2024-01', alpha: 2, beta: 1 },
  { period: '2024-02', alpha: 3, beta: 4 },
];
const series = [
  { key: 'alpha', label: 'Alpha', color: '#123456' },
  { key: 'beta', label: 'Beta', color: '#abcdef' },
];

describe('buildMultiSeriesChartOption', () => {
  it('uses an ECharts dataset and explicit dimension encoding', () => {
    const option = buildMultiSeriesChartOption({ data, xKey: 'period', series });
    expect(option.dataset).toMatchObject({
      dimensions: ['period', 'alpha', 'beta'],
    });
    expect(option.series).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'alpha',
          type: 'line',
          encode: { x: 'period', y: 'alpha', tooltip: ['alpha'] },
        }),
      ]),
    );
    expect(option.grid).toMatchObject({ containLabel: true, bottom: 32 });
    expect((option.series as Record<string, unknown>[])[0]).toMatchObject({ smooth: true });
  });

  it('maps bar and stacked area modes without changing the input rows', () => {
    const bar = buildMultiSeriesChartOption({ data, xKey: 'period', series, chartType: 'bar' });
    expect((bar.series as Record<string, unknown>[])[0]).toMatchObject({
      type: 'bar',
      itemStyle: { color: '#123456', borderRadius: [6, 6, 0, 0] },
    });

    const area = buildMultiSeriesChartOption({ data, xKey: 'period', series, chartType: 'area' });
    expect((area.series as Record<string, unknown>[])[0]).toMatchObject({
      type: 'line',
      smooth: true,
      stack: 'wordflow-total',
    });
    expect((area.series as Record<string, unknown>[])[0]?.areaStyle).toBeTruthy();
    expect(data[0]).not.toHaveProperty('__wordflow_selected__');
  });

  it('uses native ECharts states to soften focused-series fading', () => {
    const line = buildMultiSeriesChartOption({ data, xKey: 'period', series });
    expect((line.series as Record<string, unknown>[])[0]).toMatchObject({
      emphasis: { focus: 'series', scale: false },
      blur: {
        itemStyle: { opacity: 0.45 },
        lineStyle: { opacity: 0.45 },
      },
    });

    const bar = buildMultiSeriesChartOption({ data, xKey: 'period', series, chartType: 'bar' });
    expect((bar.series as Record<string, unknown>[])[0]).toMatchObject({
      emphasis: { focus: 'series' },
      blur: { itemStyle: { opacity: 0.45 } },
    });

    const area = buildMultiSeriesChartOption({ data, xKey: 'period', series, chartType: 'area' });
    expect((area.series as Record<string, unknown>[])[0]).toMatchObject({
      areaStyle: { opacity: 0.35 },
      blur: {
        itemStyle: { opacity: 0.45 },
        lineStyle: { opacity: 0.45 },
        areaStyle: { opacity: 0.1575 },
      },
    });
  });

  it('encodes bar selection opacity while retaining complete dataset indices', () => {
    const option = buildMultiSeriesChartOption({
      data,
      xKey: 'period',
      series,
      chartType: 'bar',
      selection: {
        selectedIndices: new Set([1]),
        onSelect: () => undefined,
      },
    });
    const dataset = option.dataset as { source: Record<string, unknown>[] };
    expect(dataset.source.map((row) => row.__wordflow_selected__)).toEqual([0, 1]);
    expect(option.visualMap).toMatchObject({
      type: 'piecewise',
      dimension: '__wordflow_selected__',
    });

    const line = buildMultiSeriesChartOption({
      data,
      xKey: 'period',
      series,
      selection: {
        selectedIndices: new Set([1]),
        onSelect: () => undefined,
      },
    });
    expect(line.visualMap).toBeUndefined();
    const lineSeries = (line.series as Record<string, unknown>[])[0];
    const symbol = lineSeries?.symbol as (value: unknown, params: { dataIndex?: number }) => string;
    expect(lineSeries).toMatchObject({ symbolSize: 6 });
    expect(symbol(undefined, { dataIndex: 0 })).toBe('emptyCircle');
    expect(symbol(undefined, { dataIndex: 1 })).toBe('circle');
  });

  it('accepts native ECharts axis options without compatibility translation', () => {
    const option = buildMultiSeriesChartOption({
      data,
      xKey: 'period',
      series,
      xAxis: {
        type: 'value',
        min: 'dataMin',
        max: 'dataMax',
        splitNumber: 10,
        axisLabel: { rotate: 45 },
      },
      yAxis: { minInterval: 1 },
    });

    expect(option.xAxis).toMatchObject({
      type: 'value',
      min: 'dataMin',
      max: 'dataMax',
      splitNumber: 10,
      axisLabel: { rotate: 45 },
    });
    expect(option.yAxis).toMatchObject({ type: 'value', minInterval: 1 });
  });
});
