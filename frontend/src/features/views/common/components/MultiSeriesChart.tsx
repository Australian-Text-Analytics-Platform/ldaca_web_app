import type { ReactNode, RefObject } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import type { XAxisComponentOption, YAxisComponentOption } from 'echarts/types/dist/option';

import { EChartsView } from './EChartsView';

type MultiSeriesChartType = 'line' | 'bar' | 'area';

export interface MultiSeriesChartSeries {
  /** Data key in each row of `data`. */
  key: string;
  /** Stroke (line/area) or fill (bar/area) color. */
  color: string;
  /** Human-readable label; defaults to `key`. */
  label?: string;
}

interface MultiSeriesChartTooltipConfig {
  labelFormatter?: (label: string | number) => unknown;
}

interface MultiSeriesChartSelectionConfig {
  selectedIndices: ReadonlySet<number>;
  onSelect: (index: number, shiftHeld: boolean) => void;
  onSelectRange?: (startIndex: number, endIndex: number, shiftHeld: boolean) => void;
}

export interface MultiSeriesChartProps {
  data: readonly Record<string, unknown>[];
  /** Field in each row whose value forms the X axis. */
  xKey: string;
  series: readonly MultiSeriesChartSeries[];
  /** Default 'line'. */
  chartType?: MultiSeriesChartType;
  xAxis?: XAxisComponentOption;
  yAxis?: YAxisComponentOption;
  tooltip?: MultiSeriesChartTooltipConfig;
  selection?: MultiSeriesChartSelectionConfig;
  /** Container height in pixels. */
  height?: number;
  /** Forwarded to the outer container so callers can locate the exported SVG. */
  containerRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  ariaLabel?: string;
  dataResetKey?: string;
  toolbarStart?: ReactNode;
}

const SELECTION_DIMENSION = '__wordflow_selected__';
const NON_FOCUSED_OPACITY = 0.45;

interface TooltipParam {
  value?: Record<string, unknown> | unknown[];
}

const tooltipValue = (value: Record<string, unknown> | unknown[] | undefined, key: string) => {
  if (Array.isArray(value)) return undefined;
  return value?.[key];
};

const displayChartValue = (value: unknown, fallback = '—'): string => {
  if (value == null) return fallback;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return fallback;
};

/** Builds a serializable ECharts option from the canonical multi-series model. */
// eslint-disable-next-line react-refresh/only-export-components -- pure option builder is exported for focused chart-contract tests.
export const buildMultiSeriesChartOption = ({
  data,
  xKey,
  series,
  chartType = 'line',
  xAxis,
  yAxis,
  tooltip,
  selection,
}: Pick<
  MultiSeriesChartProps,
  'data' | 'xKey' | 'series' | 'chartType' | 'xAxis' | 'yAxis' | 'tooltip' | 'selection'
>): EChartsCoreOption => {
  const hasSelection = !!selection && selection.selectedIndices.size > 0;
  const areaOpacity = hasSelection ? 0.2 : 0.35;
  const usesSelectionVisual = hasSelection && chartType === 'bar';
  const source = usesSelectionVisual
    ? data.map((row, index) => ({
        ...row,
        [SELECTION_DIMENSION]: selection.selectedIndices.has(index) ? 1 : 0,
      }))
    : data;
  const xAxisType = xAxis?.type ?? 'category';
  const chartSeries = series.map((item) => {
    const common = {
      id: item.key,
      name: item.label ?? item.key,
      encode: { x: xKey, y: item.key, tooltip: [item.key] },
      emphasis: { focus: 'series' as const },
    };
    if (chartType === 'bar') {
      return {
        ...common,
        type: 'bar' as const,
        itemStyle: { color: item.color, borderRadius: [6, 6, 0, 0] },
        blur: { itemStyle: { opacity: NON_FOCUSED_OPACITY } },
      };
    }
    return {
      ...common,
      type: 'line' as const,
      smooth: true,
      emphasis: { ...common.emphasis, scale: false },
      itemStyle: { color: item.color },
      blur: {
        itemStyle: { opacity: NON_FOCUSED_OPACITY },
        lineStyle: { opacity: NON_FOCUSED_OPACITY },
        ...(chartType === 'area'
          ? { areaStyle: { opacity: areaOpacity * NON_FOCUSED_OPACITY } }
          : {}),
      },
      ...(hasSelection
        ? {
            showSymbol: true,
            symbol: (_value: unknown, params: { dataIndex?: number }) =>
              selection.selectedIndices.has(params.dataIndex ?? -1) ? 'circle' : 'emptyCircle',
            symbolSize: 6,
          }
        : {}),
      lineStyle: { color: item.color, width: 2 },
      ...(chartType === 'area'
        ? {
            areaStyle: { color: item.color, opacity: areaOpacity },
            stack: 'wordflow-total',
          }
        : {}),
    };
  });

  return {
    dataset: {
      dimensions: [
        xKey,
        ...series.map((item) => item.key),
        ...(usesSelectionVisual ? [SELECTION_DIMENSION] : []),
      ],
      source,
    },
    grid: {
      containLabel: true,
      top: 20,
      right: 30,
      left: 20,
      // containLabel already reserves the axis-label height. This footer only
      // needs to leave room for the ECharts dataZoom slider.
      bottom: 32,
    },
    tooltip: tooltip
      ? {
          trigger: 'axis',
          renderMode: 'richText',
          confine: true,
          axisPointer: { type: chartType === 'bar' ? 'shadow' : 'line' },
          formatter: (rawParams: unknown) => {
            const params = Array.isArray(rawParams) ? (rawParams as TooltipParam[]) : [];
            const firstValue = Array.isArray(params[0]?.value) ? undefined : params[0]?.value;
            const rawLabel = firstValue?.[xKey];
            const label = tooltip.labelFormatter
              ? tooltip.labelFormatter(rawLabel as string | number)
              : rawLabel;
            const lines = [displayChartValue(label, '')];
            for (const item of series) {
              const value = tooltipValue(firstValue, item.key);
              lines.push(`${item.label ?? item.key}: ${displayChartValue(value)}`);
            }
            return lines.join('\n');
          },
        }
      : undefined,
    xAxis: {
      ...xAxis,
      type: xAxisType,
      axisLine: {
        lineStyle: { color: 'var(--vscode-charts-foreground)' },
        ...xAxis?.axisLine,
      },
      axisLabel: {
        color: 'var(--vscode-charts-foreground)',
        hideOverlap: true,
        margin: 8,
        ...xAxis?.axisLabel,
      },
      axisTick: { alignWithLabel: xAxisType === 'category', ...xAxis?.axisTick },
    },
    yAxis: {
      ...yAxis,
      type: yAxis?.type ?? 'value',
      axisLine: {
        lineStyle: { color: 'var(--vscode-charts-foreground)' },
        ...yAxis?.axisLine,
      },
      axisLabel: { color: 'var(--vscode-charts-foreground)', ...yAxis?.axisLabel },
      splitLine: {
        lineStyle: { color: 'var(--vscode-charts-lines)', type: 'dashed' },
        ...yAxis?.splitLine,
      },
    },
    // ECharts maps per-item bar opacity from the internal selection dimension.
    // Line and area modes show selection through their point symbols instead.
    ...(usesSelectionVisual
      ? {
          visualMap: {
            type: 'piecewise',
            show: false,
            dimension: SELECTION_DIMENSION,
            seriesIndex: chartSeries.map((_, index) => index),
            pieces: [
              { value: 1, opacity: 1 },
              { value: 0, opacity: 0.25 },
            ],
          },
        }
      : {}),
    series: chartSeries,
  };
};

/** Shared ECharts renderer for Trends-style multi-series analysis charts. */
export function MultiSeriesChart(props: MultiSeriesChartProps) {
  const {
    data,
    xKey,
    series,
    selection,
    height = 240,
    containerRef,
    className,
    ariaLabel = 'Interactive analysis chart',
    dataResetKey = JSON.stringify(data),
    toolbarStart,
  } = props;
  const option = buildMultiSeriesChartOption(props);
  const getPointSummary = (index: number) => {
    const row = data[index];
    if (!row) return `Point ${String(index + 1)}`;
    const values = series.map(
      (item) => `${item.label ?? item.key}: ${displayChartValue(row[item.key])}`,
    );
    const rawLabel = row[xKey];
    const label = props.tooltip?.labelFormatter
      ? props.tooltip.labelFormatter(rawLabel as string | number)
      : rawLabel;
    return `${displayChartValue(label, `Point ${String(index + 1)}`)}. ${values.join(', ')}`;
  };

  return (
    <div ref={containerRef}>
      <div className="w-full">
        <EChartsView
          option={option}
          height={height}
          pointCount={data.length}
          dataResetKey={dataResetKey}
          ariaLabel={ariaLabel}
          selectedIndices={selection?.selectedIndices}
          onSelect={selection?.onSelect}
          onSelectRange={selection?.onSelectRange}
          getPointSummary={getPointSummary}
          className={className}
          testId="multi-series-chart"
          toolbarStart={toolbarStart}
        />
      </div>
    </div>
  );
}
