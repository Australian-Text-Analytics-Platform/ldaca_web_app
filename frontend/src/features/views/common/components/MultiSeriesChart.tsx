import { useEffect, useRef, useState, type RefObject } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { EChartsCoreOption } from 'echarts/core';

import { EChartsView } from './EChartsView';

type MultiSeriesChartType = 'line' | 'bar' | 'area';

export interface MultiSeriesChartSeries {
  /** Data key in each row of `data`. */
  key: string;
  /** Stroke (line/area) or fill (bar/area) color. */
  color: string;
  /** Human-readable label; defaults to `key`. */
  label?: string;
  /** SVG dash pattern, e.g. '6 4'. Undefined = solid. */
  dash?: string;
  /** Show a point marker when this series contains a single point. */
  singlePoint?: boolean;
}

export interface MultiSeriesChartXAxisConfig {
  /** Default 'category' (string keys, even spacing). */
  type?: 'category' | 'number';
  /** Only meaningful when type='number'. */
  domain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax'];
  /** Fixed numeric tick positions. */
  ticks?: readonly (number | string)[];
  /** Target number of generated ticks on a numeric axis. */
  tickCount?: number;
  tickFormatter?: (value: never) => string;
  /** Tick rotation in degrees, e.g. -45. */
  angle?: number;
  /** Axis area height in pixels; needed when ticks are rotated. */
  height?: number;
  /** Minimum gap in px between rendered labels. */
  minTickGap?: number;
}

interface MultiSeriesChartTooltipConfig {
  labelFormatter?: (label: never) => unknown;
  valueFormatter?: (value: never, name: never) => [unknown, unknown];
  indicator?: 'line' | 'dot';
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
  xAxis?: MultiSeriesChartXAxisConfig;
  yAxis?: { allowDecimals?: boolean };
  tooltip?: MultiSeriesChartTooltipConfig;
  selection?: MultiSeriesChartSelectionConfig;
  /** Container height in pixels. */
  height?: number;
  margin?: { top?: number; right?: number; bottom?: number; left?: number };
  /** Forwarded to the outer container so callers can locate the exported SVG. */
  containerRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  /** Default true. */
  animate?: boolean;
  /** Connect missing values for line/area charts. Default false. */
  connectNulls?: boolean;
  /** When true, point and range selection controls are enabled. */
  interactive?: boolean;
  /** Suppress the narrow-width data-density warning. */
  suppressOverflowWarning?: boolean;
  ariaLabel?: string;
  dataResetKey?: string;
}

const DEFAULT_MARGIN = { top: 20, right: 30, left: 20, bottom: 20 } as const;
const SELECTION_DIMENSION = '__wordflow_selected__';

interface TooltipParam {
  value?: Record<string, unknown> | unknown[];
}

const axisBound = (value: number | 'auto' | 'dataMin' | 'dataMax' | undefined) =>
  value === 'auto' ? undefined : value;

const dashType = (dash: string | undefined): number[] | 'solid' => {
  if (!dash) return 'solid';
  const values = dash
    .split(/\s+/)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length > 0 ? values : 'solid';
};

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
  margin = DEFAULT_MARGIN,
  animate = true,
  connectNulls = false,
}: Pick<
  MultiSeriesChartProps,
  | 'data'
  | 'xKey'
  | 'series'
  | 'chartType'
  | 'xAxis'
  | 'yAxis'
  | 'tooltip'
  | 'selection'
  | 'margin'
  | 'animate'
  | 'connectNulls'
>): EChartsCoreOption => {
  const hasSelection = !!selection && selection.selectedIndices.size > 0;
  const source = data.map((row, index) => ({
    ...row,
    [SELECTION_DIMENSION]: hasSelection && !selection.selectedIndices.has(index) ? 0 : 1,
  }));
  const xAxisType = xAxis?.type === 'number' ? 'value' : 'category';
  const tickFormatter = xAxis?.tickFormatter;
  const regularTickInterval =
    xAxis?.ticks && xAxis.ticks.length > 1 && xAxis.ticks.every((tick) => typeof tick === 'number')
      ? Number(xAxis.ticks[1]) - Number(xAxis.ticks[0])
      : undefined;
  const chartSeries = series.map((item) => {
    const common = {
      id: item.key,
      name: item.label ?? item.key,
      type: chartType === 'bar' ? ('bar' as const) : ('line' as const),
      encode: { x: xKey, y: item.key, tooltip: [item.key] },
      itemStyle: {
        color: item.color,
        borderRadius: chartType === 'bar' ? [6, 6, 0, 0] : undefined,
      },
      emphasis: { focus: 'series' as const },
      animation: animate,
    };
    if (chartType === 'bar') return common;
    return {
      ...common,
      smooth: 0.35,
      connectNulls,
      showSymbol: hasSelection || !!item.singlePoint,
      symbolSize: (_value: unknown, params: { dataIndex?: number }) => {
        if (!hasSelection) return item.singlePoint ? 8 : 0;
        return selection.selectedIndices.has(params.dataIndex ?? -1) ? 10 : 6;
      },
      lineStyle: { color: item.color, width: 2, type: dashType(item.dash) },
      areaStyle:
        chartType === 'area'
          ? { color: item.color, opacity: hasSelection ? 0.2 : 0.35 }
          : undefined,
      stack: chartType === 'area' ? 'wordflow-total' : undefined,
    };
  });

  return {
    animation: animate,
    dataset: {
      dimensions: [xKey, ...series.map((item) => item.key), SELECTION_DIMENSION],
      source,
    },
    grid: {
      containLabel: true,
      top: margin.top ?? DEFAULT_MARGIN.top,
      right: margin.right ?? DEFAULT_MARGIN.right,
      left: margin.left ?? DEFAULT_MARGIN.left,
      bottom: Math.max(margin.bottom ?? DEFAULT_MARGIN.bottom, (xAxis?.height ?? 42) + 34),
    },
    tooltip: tooltip
      ? {
          trigger: 'axis',
          renderMode: 'richText',
          confine: true,
          axisPointer: { type: tooltip.indicator === 'line' ? 'line' : 'shadow' },
          formatter: (rawParams: unknown) => {
            const params = Array.isArray(rawParams) ? (rawParams as TooltipParam[]) : [];
            const firstValue = Array.isArray(params[0]?.value) ? undefined : params[0]?.value;
            const rawLabel = firstValue?.[xKey];
            const label = tooltip.labelFormatter
              ? tooltip.labelFormatter(rawLabel as never)
              : rawLabel;
            const lines = [displayChartValue(label, '')];
            for (const item of series) {
              const value = tooltipValue(firstValue, item.key);
              const formatted = tooltip.valueFormatter
                ? tooltip.valueFormatter(value as never, (item.label ?? item.key) as never)
                : [value, item.label ?? item.key];
              lines.push(
                `${displayChartValue(formatted[1], item.label ?? item.key)}: ${displayChartValue(formatted[0])}`,
              );
            }
            return lines.join('\n');
          },
        }
      : undefined,
    xAxis: {
      type: xAxisType,
      min: axisBound(xAxis?.domain?.[0]),
      max: axisBound(xAxis?.domain?.[1]),
      interval:
        typeof regularTickInterval === 'number' && regularTickInterval > 0
          ? regularTickInterval
          : undefined,
      splitNumber: xAxis?.tickCount,
      axisLine: { lineStyle: { color: 'var(--vscode-charts-foreground)' } },
      axisLabel: {
        color: 'var(--vscode-charts-foreground)',
        rotate: Math.abs(xAxis?.angle ?? 0),
        hideOverlap: true,
        margin: Math.max(8, xAxis?.minTickGap ?? 8),
        formatter: tickFormatter
          ? (value: string | number) => tickFormatter(value as never)
          : undefined,
      },
      axisTick: { alignWithLabel: xAxisType === 'category' },
    },
    yAxis: {
      type: 'value',
      minInterval: yAxis?.allowDecimals === false ? 1 : undefined,
      axisLine: { lineStyle: { color: 'var(--vscode-charts-foreground)' } },
      axisLabel: { color: 'var(--vscode-charts-foreground)' },
      splitLine: { lineStyle: { color: 'var(--vscode-charts-lines)', type: 'dashed' } },
    },
    // ECharts can map opacity per bar from the selection dimension. Applying
    // that visual encoding to a line series also targets its stroke and emits
    // a runtime warning because the selection flag is not an axis dimension;
    // line and area modes retain the prior selection-aware symbol sizing.
    ...(hasSelection && chartType === 'bar'
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
    interactive = false,
    suppressOverflowWarning = false,
    ariaLabel = 'Interactive analysis chart',
    dataResetKey = data.map((row) => displayChartValue(row[xKey], '')).join('|'),
  } = props;
  const plotMeasureRef = useRef<HTMLDivElement | null>(null);
  const [chartPixelWidth, setChartPixelWidth] = useState(0);

  useEffect(() => {
    const element = plotMeasureRef.current;
    if (!element) return;
    const update = () => {
      setChartPixelWidth(element.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const showOverflowWarning =
    !suppressOverflowWarning && chartPixelWidth > 0 && data.length > chartPixelWidth;
  const option = buildMultiSeriesChartOption(props);
  const getPointSummary = (index: number) => {
    const row = data[index];
    if (!row) return `Point ${String(index + 1)}`;
    const values = series.map(
      (item) => `${item.label ?? item.key}: ${displayChartValue(row[item.key])}`,
    );
    return `${displayChartValue(row[xKey], `Point ${String(index + 1)}`)}. ${values.join(', ')}`;
  };

  return (
    <div ref={containerRef}>
      {showOverflowWarning ? (
        <div
          className="mb-2 flex items-start gap-2 rounded-md border border-warning bg-warning-background px-3 py-2 text-label-secondary text-warning"
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {data.length.toLocaleString()} data points but only {chartPixelWidth} px of chart width
            — points will overlap and rendering may be slow. Consider increasing the bin size or
            aggregation granularity for a clearer view.
          </span>
        </div>
      ) : null}
      <div ref={plotMeasureRef} className="w-full">
        <EChartsView
          option={option}
          height={height}
          pointCount={data.length}
          dataResetKey={dataResetKey}
          ariaLabel={ariaLabel}
          selectedIndices={selection?.selectedIndices}
          onSelect={interactive ? selection?.onSelect : undefined}
          onSelectRange={interactive ? selection?.onSelectRange : undefined}
          getPointSummary={getPointSummary}
          className={className}
          testId="multi-series-chart"
        />
      </div>
    </div>
  );
}
