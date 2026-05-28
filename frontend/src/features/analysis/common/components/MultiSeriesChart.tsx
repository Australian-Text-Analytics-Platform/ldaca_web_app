import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

export type MultiSeriesChartType = 'line' | 'bar' | 'area';

export interface MultiSeriesChartSeries {
  /** Data key in each row of `data`. */
  key: string;
  /** Stroke (line/area) or fill (bar/area) color, e.g. '#0284c7'. */
  color: string;
  /** Human-readable label; defaults to `key`. */
  label?: string;
  /** Recharts `strokeDasharray` string, e.g. '6 4'. Undefined = solid. */
  dash?: string;
  /**
   * When true, force a static dot to be rendered for every data point even
   * when no selection is active. Useful when a series has only one point that
   * would otherwise be invisible.
   */
  singlePoint?: boolean;
}

export interface MultiSeriesChartXAxisConfig {
  /** Recharts axis scale type. Default 'category' (string keys, even spacing). */
  type?: 'category' | 'number';
  /** Only meaningful when type='number'. */
  domain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax'];
  /** Fixed tick positions (number axis) or labels (category). */
  ticks?: ReadonlyArray<number | string>;
  /**
   * Target number of auto-generated ticks (number axis only). Recharts snaps
   * to round-number positions, so the actual count may differ slightly. Has
   * no effect when `ticks` is provided. Defaults to Recharts' built-in 5.
   */
  tickCount?: number;
  tickFormatter?: (value: never) => string;
  /** Tick rotation in degrees, e.g. -45. */
  angle?: number;
  /** Axis area height in pixels; needed when ticks are rotated. */
  height?: number;
  /** Minimum gap in px between rendered ticks. */
  minTickGap?: number;
}

export interface MultiSeriesChartTooltipConfig {
  /** If set, used as Recharts <Tooltip> content; overrides every other field. */
  content?: React.ReactElement;
  labelFormatter?: (label: never, payload?: never) => React.ReactNode;
  /** Only used when `shadcn` is false (default). */
  valueFormatter?: (
    value: never,
    name: never,
  ) => [React.ReactNode, React.ReactNode];
  /** Use shadcn ChartTooltipContent. Default false (= plain Recharts Tooltip). */
  shadcn?: boolean;
  /** Only used with `shadcn=true`. */
  indicator?: 'line' | 'dot';
  /** Only used with `shadcn=true`. */
  className?: string;
}

export interface MultiSeriesChartSelectionConfig {
  selectedIndices: ReadonlySet<number>;
  onSelect: (index: number, shiftHeld: boolean) => void;
}

export interface MultiSeriesChartProps {
  data: ReadonlyArray<Record<string, unknown>>;
  /** Field in each row whose value forms the X axis. */
  xKey: string;
  series: ReadonlyArray<MultiSeriesChartSeries>;
  /** Default 'line'. */
  chartType?: MultiSeriesChartType;
  xAxis?: MultiSeriesChartXAxisConfig;
  yAxis?: { allowDecimals?: boolean };
  tooltip?: MultiSeriesChartTooltipConfig;
  /** Opt-in click-to-select. Triggers cell fading + selection-aware dots. */
  selection?: MultiSeriesChartSelectionConfig;
  /** Container height. Number → pixels; string → CSS height value. */
  height?: number | string;
  margin?: { top?: number; right?: number; bottom?: number; left?: number };
  /** Forwarded to outer container — lets parents grab the SVG for download. */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
  /** Recharts `isAnimationActive`. Default true. */
  animate?: boolean;
  /** Recharts `connectNulls` (line/area only). Default false. */
  connectNulls?: boolean;
  /** When true, the chart shows a pointer cursor (for clickable charts). */
  interactive?: boolean;
  /**
   * Suppress the "too many data points for the current chart width" warning.
   * Defaults to false (warning is shown when `data.length > pixelWidth`).
   */
  suppressOverflowWarning?: boolean;
}

/** Default chart margins keep axes readable across compact analysis cards. */
const DEFAULT_MARGIN = { top: 20, right: 30, left: 20, bottom: 20 } as const;
/** Active-dot radius shared by selectable line and area chart variants. */
const ACTIVE_DOT_RADIUS = 5;

/**
 * Wraps the project's Recharts usage for analysis trend/result charts so line,
 * bar, area, tooltip, and point-selection behavior stay consistent.
 * Used by: concordance dispersion and sequential analysis chart panels because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
export const MultiSeriesChart: React.FC<MultiSeriesChartProps> = ({
  data,
  xKey,
  series,
  chartType = 'line',
  xAxis,
  yAxis,
  tooltip,
  selection,
  height = 240,
  margin = DEFAULT_MARGIN,
  containerRef,
  className,
  animate = true,
  connectNulls = false,
  interactive = false,
  suppressOverflowWarning = false,
}) => {
  const chartConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    for (const s of series) {
      cfg[s.key] = { label: s.label ?? s.key, color: s.color };
    }
    return cfg;
  }, [series]);

  // Measure the plot's rendered width so we can warn when each data point
  // gets less than ~1 px of horizontal real-estate — anything beyond that
  // is invisible to the user and forces Recharts to render thousands of
  // overlapping marks. Uses a ResizeObserver so resizing the panel keeps
  // the warning in sync.
  const plotMeasureRef = useRef<HTMLDivElement | null>(null);
  const [chartPixelWidth, setChartPixelWidth] = useState(0);
  useEffect(() => {
    const el = plotMeasureRef.current;
    if (!el) return;
    /** Called by: ResizeObserver and initial chart mount for overflow warnings because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    const update = () => setChartPixelWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const showOverflowWarning =
    !suppressOverflowWarning &&
    chartPixelWidth > 0 &&
    data.length > chartPixelWidth;

  const xAxisType = xAxis?.type ?? 'category';
  const hasSelection = !!selection && selection.selectedIndices.size > 0;

  /** Converts Recharts click payloads into the index-selection API used by charts. */
  const handleChartClick = selection
    ? (
        nextState: { activeTooltipIndex?: number | string } | null | undefined,
        event: { shiftKey?: boolean },
      ) => {
        const raw = nextState?.activeTooltipIndex;
        const shiftHeld = !!event.shiftKey;
        if (typeof raw === 'number') {
          selection.onSelect(raw, shiftHeld);
          return;
        }
        if (typeof raw === 'string') {
          const parsed = Number(raw);
          if (Number.isInteger(parsed)) selection.onSelect(parsed, shiftHeld);
        }
      }
    : undefined;

  type DotProps = { cx?: number; cy?: number; index?: number };

    /**
   * Called by: dotFor when line/area series need custom point rendering because selection state must alter point visibility without duplicating Recharts dot branches.
   * Flow: reject incomplete Recharts point props, draw the single-point marker when no selection exists, then emphasize selected indices and fade other points.
   */
  const renderDot = (color: string, singlePoint: boolean) => (props: DotProps) => {
    const { cx, cy, index } = props;
    if (typeof cx !== 'number' || typeof cy !== 'number' || typeof index !== 'number') {
      return null;
    }
    if (!hasSelection) {
      return singlePoint ? <circle cx={cx} cy={cy} r={4} fill={color} /> : null;
    }
    if (selection!.selectedIndices.has(index)) {
      return (
        <circle cx={cx} cy={cy} r={5} fill={color} stroke="white" strokeWidth={1.5} />
      );
    }
    return <circle cx={cx} cy={cy} r={3} fill={color} fillOpacity={0.25} />;
  };

  /** Called by: Recharts line and area series configuration because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
  const dotFor = (s: MultiSeriesChartSeries) => {
    if (!hasSelection && !s.singlePoint) return false;
    return renderDot(s.color, !!s.singlePoint);
  };

  /** Builds the requested tooltip implementation once for the selected chart flavor. */
  const tooltipElement = ((): React.ReactElement | null => {
    if (!tooltip) return null;
    if (tooltip.content) return <ChartTooltip content={tooltip.content} />;
    if (tooltip.shadcn) {
      return (
        <ChartTooltip
          content={
            <ChartTooltipContent
              className={tooltip.className}
              indicator={tooltip.indicator}
              labelFormatter={tooltip.labelFormatter as never}
            />
          }
        />
      );
    }
    return (
      <RechartsTooltip
        formatter={tooltip.valueFormatter as never}
        labelFormatter={tooltip.labelFormatter as never}
      />
    );
  })();

  const xAxisElement = (
    <XAxis
      dataKey={xKey}
      type={xAxisType}
      domain={xAxis?.domain as never}
      ticks={xAxis?.ticks as never}
      tickCount={xAxis?.tickCount}
      tickFormatter={xAxis?.tickFormatter as never}
      angle={xAxis?.angle}
      textAnchor={xAxis?.angle != null ? 'end' : undefined}
      height={xAxis?.height}
      minTickGap={xAxis?.minTickGap}
    />
  );
  const yAxisElement = <YAxis allowDecimals={yAxis?.allowDecimals} />;

  const heightStyle = typeof height === 'number' ? { height: `${height}px` } : { height };
  const containerClass = ['w-full', interactive ? 'cursor-pointer' : null, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={containerRef}>
      <ChartContainer config={chartConfig} className={containerClass}>
        {showOverflowWarning && (
          <div
            className="mb-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
            role="status"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {data.length.toLocaleString()} data points but only {chartPixelWidth} px of
              chart width — points will overlap and rendering may be slow. Consider
              increasing the bin size or aggregation granularity for a clearer view.
            </span>
          </div>
        )}
        <div ref={plotMeasureRef} className="w-full" style={heightStyle}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            {chartType === 'bar' ? (
              <BarChart
                data={data as never}
                margin={margin}
                onClick={handleChartClick as never}
              >
                <CartesianGrid strokeDasharray="3 3" />
                {xAxisElement}
                {yAxisElement}
                {tooltipElement}
                {series.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    fill={s.color}
                    radius={[6, 6, 0, 0]}
                    name={s.label ?? s.key}
                    isAnimationActive={animate}
                  >
                    {selection
                      ? data.map((_, i) => (
                          <Cell
                            key={`${s.key}-${i}`}
                            fillOpacity={
                              !hasSelection || selection.selectedIndices.has(i) ? 1 : 0.25
                            }
                          />
                        ))
                      : null}
                  </Bar>
                ))}
              </BarChart>
            ) : chartType === 'area' ? (
              <AreaChart
                data={data as never}
                margin={margin}
                onClick={handleChartClick as never}
              >
                <CartesianGrid strokeDasharray="3 3" />
                {xAxisElement}
                {yAxisElement}
                {tooltipElement}
                {series.map((s) => (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    stackId="1"
                    stroke={s.color}
                    strokeDasharray={s.dash}
                    fill={s.color}
                    fillOpacity={hasSelection ? 0.2 : 0.35}
                    dot={dotFor(s)}
                    activeDot={{ r: ACTIVE_DOT_RADIUS }}
                    name={s.label ?? s.key}
                    isAnimationActive={animate}
                    connectNulls={connectNulls}
                  />
                ))}
              </AreaChart>
            ) : (
              <LineChart
                data={data as never}
                margin={margin}
                onClick={handleChartClick as never}
              >
                <CartesianGrid strokeDasharray="3 3" />
                {xAxisElement}
                {yAxisElement}
                {tooltipElement}
                {series.map((s) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    stroke={s.color}
                    strokeDasharray={s.dash}
                    strokeWidth={2}
                    dot={dotFor(s)}
                    activeDot={{ r: ACTIVE_DOT_RADIUS }}
                    name={s.label ?? s.key}
                    isAnimationActive={animate}
                    connectNulls={connectNulls}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </ChartContainer>
    </div>
  );
};
