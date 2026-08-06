import { useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { toast } from 'sonner';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ChartImageDownloadDialog } from '@/components/ui/ChartImageDownloadDialog';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  downloadChartAs,
  findSvgInContainer,
  type ChartExportHeaderItem,
  type ChartExportLegendItem,
  type ChartImageFormat,
} from '@/lib/chartExport';
import { VIZ_PALETTE } from '../../common/vizPalette';
import {
  CONCORDANCE_DISPERSION_CHART_MODES,
  buildDispersionBins,
  buildDispersionBinsFromDensitySeries,
  DISPERSION_DISPLAY_BIN_COUNTS,
  type ConcordanceDispersionChartMode,
  type ConcordanceDispersionRow,
  type DispersionDisplayBinCount,
  type ConcordanceDensitySeriesInput,
} from '../concordanceDispersionDomain';

interface Props {
  rows: ConcordanceDispersionRow[];
  textColumn: string;
  binCount: DispersionDisplayBinCount;
  splitBySource: boolean;
  /** Human-readable label for the data block (used in title and download filename). */
  dataBlockLabel: string;
  searchWord: string;
  /** Dispersion figure mode. Density shares per-bin counts across three renderers; cumulative is the running total. */
  chartMode?: ConcordanceDispersionChartMode;
  /** Change handler for the chart-mode selector in the header. */
  onChartModeChange?: (value: ConcordanceDispersionChartMode) => void;
  /** Change handler for the bin-count selector in the header. */
  onBinCountChange?: (value: DispersionDisplayBinCount) => void;
  /** Effective Node.color for a single-source aggregate chart. */
  sourceColor?: string;
  /** Click-to-select bins. Omitted = selection disabled. */
  selection?: {
    selectedIndices: ReadonlySet<number>;
    onSelect: (index: number, shiftHeld: boolean) => void;
    onSelectRange: (startIndex: number, endIndex: number, shiftHeld: boolean) => void;
    onClear: () => void;
  };
  densitySeries?: ConcordanceDensitySeriesInput[];
  termColors?: Record<string, string>;
  excludedMatchedTexts?: ReadonlySet<string>;
  onToggleMatchedText?: (matchedText: string) => void;
}

interface DispersionChartSeries {
  /** Data key in each row of the chart payload. */
  key: string;
  /** Stroke color, usually from matched-text color or Node.color. */
  color: string;
  /** Human-readable label for tooltip/export display. */
  label?: string;
  /** Recharts `strokeDasharray` string. Undefined = solid. */
  dash?: string;
  matchedText: string;
  hidden: boolean;
  countLabel: string;
}

interface ChartPointerState {
  activeTooltipIndex?: number | string;
}

interface ChartPointerEvent {
  shiftKey?: boolean;
}

interface DragSelection {
  startIndex: number;
  endIndex: number;
}

const AGGREGATE_DEFAULT_COLOR = '#0284c7';
const X_AXIS_TICKS = [0, 20, 40, 60, 80, 100];
const CHART_HEIGHT = 240;
const RESPONSIVE_CHART_INITIAL_WIDTH = 800;
const CHART_MODE_LABELS: Record<ConcordanceDispersionChartMode, string> = {
  'density-line': 'Density: line',
  'density-bar': 'Density: bar',
  'density-area': 'Density: area',
  cumulative: 'Cumulative',
};

/**
 * Used by: ConcordanceDispersionSummary axis and tooltip labels to format a bin range as a human-friendly string. For sufficiently wide bins.
 * (≥ 2 % each, i.e. binCount ≤ 50) we use non-overlapping integer ranges with
 * a +1 increment ("0-5%", "6-10%"). For narrower bins we fall back to
 * one-decimal fractional ranges so the labels stay accurate.
 * Flow: clamp bin count, derive the bin index and width from the center value, then return integer or one-decimal percentage ranges based on bin width.
 */
const formatBinRange = (binCenter: number, binCount: number): string => {
  const safeBinCount = Math.max(1, Math.floor(binCount));
  const width = 100 / safeBinCount;
  const idx = Math.min(safeBinCount - 1, Math.max(0, Math.floor((binCenter * safeBinCount) / 100)));
  if (width >= 2) {
    const lower = idx === 0 ? 0 : Math.round(idx * width) + 1;
    const upper = Math.round((idx + 1) * width);
    return `${String(lower)}-${String(upper)}%`;
  }
  const lower = idx * width;
  const upper = (idx + 1) * width;
  return `${lower.toFixed(1)}-${upper.toFixed(1)}%`;
};

/** Used by: ConcordanceDispersionSummary chart axis to format ticks as relative-position percentages. */
const formatTickLabel = (value: number): string => {
  if (!Number.isFinite(value)) return '';
  return `${String(Math.round(value))}%`;
};

/** Mirrors ChartContainer's CSS-variable slug so lines can use shadcn chart theme variables. */
const chartColorVar = (key: string): string => `var(--color-${key.replace(/[^a-zA-Z0-9]+/g, '-')})`;

/** Builds cumulative running totals from the density-bin rows for the stepped cumulative figure. */
const buildCumulativeChartData = (
  bins: readonly Record<string, unknown>[],
  series: readonly DispersionChartSeries[],
): Record<string, unknown>[] => {
  const runningTotals = new Map<string, number>();
  for (const item of series) runningTotals.set(item.key, 0);
  return bins.map((bin) => {
    const next: Record<string, unknown> = { binCenter: bin.binCenter };
    for (const item of series) {
      const raw = bin[item.key];
      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
      const total = (runningTotals.get(item.key) ?? 0) + value;
      runningTotals.set(item.key, total);
      next[item.key] = total;
    }
    return next;
  });
};

/** Parses Recharts' active tooltip index and rejects pointer events outside the charted points. */
const parseActiveTooltipIndex = (
  rawIndex: number | string | undefined,
  pointCount: number,
): number | null => {
  const parsed =
    typeof rawIndex === 'number'
      ? rawIndex
      : typeof rawIndex === 'string'
        ? Number(rawIndex)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= pointCount) return null;
  return parsed;
};

/**
 * Rendered by: ConcordanceDispersionNodeBlock to build the dispersion chart and export payload.
 */
export function ConcordanceDispersionSummary({
  rows,
  textColumn,
  binCount,
  splitBySource,
  dataBlockLabel,
  searchWord,
  chartMode = 'density-line',
  onChartModeChange,
  onBinCountChange,
  sourceColor,
  selection,
  densitySeries,
  termColors = {},
  excludedMatchedTexts = new Set<string>(),
  onToggleMatchedText,
}: Props) {
  const controlId = useId();
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const dragSelectionRef = useRef<DragSelection | null>(null);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [dragSelection, setDragSelection] = useState<DragSelection | null>(null);
  const [chartMenuOpen, setChartMenuOpen] = useState(false);
  const [cumulativeOptionOpen, setCumulativeOptionOpen] = useState(false);

  const { bins, totalsByKey, labelsByKey, sources } = useMemo(() => {
    if (densitySeries) {
      return buildDispersionBinsFromDensitySeries(densitySeries, binCount, {
        splitBySource,
      });
    }
    return buildDispersionBins(rows, textColumn, binCount, {
      splitBySource,
    });
  }, [rows, textColumn, binCount, splitBySource, densitySeries]);

  const scopeText = densitySeries
    ? 'exact-term matches at relative locations across the entire Result'
    : 'exact-term matches at relative locations of documents from page above';
  const titleText = `${dataBlockLabel}: ${scopeText}`;
  const chartTitle = `${CHART_MODE_LABELS[chartMode]} dispersion`;

  const allSeries: DispersionChartSeries[] = useMemo(() => {
    const selected = selection?.selectedIndices ?? new Set<number>();
    return Object.entries(labelsByKey)
      .sort((left, right) => left[1].localeCompare(right[1]))
      .map(([key, matchedText], index) => {
        const total = totalsByKey[key] ?? 0;
        const selectedTotal =
          selected.size === 0
            ? total
            : bins.reduce(
                (sum, bin, binIndex) => (selected.has(binIndex) ? sum + (bin[key] ?? 0) : sum),
                0,
              );
        return {
          key,
          matchedText,
          color:
            termColors[matchedText] ??
            VIZ_PALETTE[index % VIZ_PALETTE.length] ??
            sourceColor ??
            AGGREGATE_DEFAULT_COLOR,
          label: matchedText,
          hidden: excludedMatchedTexts.has(matchedText),
          countLabel:
            selected.size === 0
              ? `${matchedText} (${String(total)})`
              : `${matchedText} (${String(selectedTotal)}/${String(total)})`,
        };
      });
  }, [
    bins,
    excludedMatchedTexts,
    labelsByKey,
    selection?.selectedIndices,
    sourceColor,
    termColors,
    totalsByKey,
  ]);
  const series = allSeries.filter((item) => !item.hidden);

  const chartData = useMemo(
    () => (chartMode === 'cumulative' ? buildCumulativeChartData(bins, series) : bins),
    [bins, chartMode, series],
  );

  const chartConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = {};
    for (const item of series) {
      config[item.key] = {
        label: item.label ?? item.key,
        color: item.color,
      };
    }
    return config;
  }, [series]);

  const lineType = chartMode === 'cumulative' ? 'step' : 'natural';
  const hasSelection = !!selection && selection.selectedIndices.size > 0;

  /** Starts a chart drag-selection from the nearest Recharts tooltip point. */
  const handleDragStart = selection
    ? (nextState: ChartPointerState | null | undefined) => {
        const index = parseActiveTooltipIndex(nextState?.activeTooltipIndex, chartData.length);
        if (index == null) return;
        const next = { startIndex: index, endIndex: index };
        dragSelectionRef.current = next;
        setDragSelection(next);
      }
    : undefined;

  /** Updates the visual drag-selection range while the pointer moves across chart points. */
  const handleDragMove = selection
    ? (nextState: ChartPointerState | null | undefined) => {
        const index = parseActiveTooltipIndex(nextState?.activeTooltipIndex, chartData.length);
        if (index == null) return;
        const current = dragSelectionRef.current;
        if (!current || current.endIndex === index) return;
        const next = { ...current, endIndex: index };
        dragSelectionRef.current = next;
        setDragSelection(next);
      }
    : undefined;

  /** Commits a drag range, preserving single-point click selection when start and end match. */
  const handleDragEnd = selection
    ? (nextState: ChartPointerState | null | undefined, event?: ChartPointerEvent) => {
        const current = dragSelectionRef.current;
        if (!current) return;
        const endIndex =
          parseActiveTooltipIndex(nextState?.activeTooltipIndex, chartData.length) ??
          current.endIndex;
        const shiftHeld = !!event?.shiftKey;
        if (current.startIndex === endIndex) {
          selection.onSelect(endIndex, shiftHeld);
        } else {
          selection.onSelectRange(current.startIndex, endIndex, shiftHeld);
        }
        dragSelectionRef.current = null;
        setDragSelection(null);
      }
    : undefined;

  /** Cancels incomplete drag affordances if the pointer leaves the chart before release. */
  const handleDragCancel = selection
    ? () => {
        dragSelectionRef.current = null;
        setDragSelection(null);
      }
    : undefined;

  interface DotProps {
    cx?: number;
    cy?: number;
    index?: number;
  }

  /** Renders density dots by default and switches to selection-aware dots when bins are selected. */
  const renderDot = (color: string, showDefaultDot: boolean) => (props: DotProps) => {
    const { cx, cy, index } = props;
    if (typeof cx !== 'number' || typeof cy !== 'number' || typeof index !== 'number') {
      return null;
    }
    if (!hasSelection) {
      return showDefaultDot ? <circle cx={cx} cy={cy} r={3} fill={color} /> : null;
    }
    if (selection.selectedIndices.has(index)) {
      return <circle cx={cx} cy={cy} r={5} fill={color} stroke="white" strokeWidth={1.5} />;
    }
    return <circle cx={cx} cy={cy} r={3} fill={color} fillOpacity={0.25} />;
  };

  /** Derives the Recharts dot renderer for line/area modes and selection state. */
  const dotFor = (item: DispersionChartSeries) => {
    const color = chartColorVar(item.key);
    if (selection) return renderDot(color, chartMode === 'density-line');
    if (chartMode === 'density-line') return { fill: color };
    return false;
  };

  const binCenterForIndex = (index: number): number | null => {
    const raw = chartData[index]?.binCenter;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  };

  const dragStartX = dragSelection ? binCenterForIndex(dragSelection.startIndex) : null;
  const dragEndX = dragSelection ? binCenterForIndex(dragSelection.endIndex) : null;
  const dragRange =
    dragStartX != null && dragEndX != null
      ? {
          x1: Math.max(0, Math.min(dragStartX, dragEndX) - 100 / Math.max(1, binCount) / 2),
          x2: Math.min(100, Math.max(dragStartX, dragEndX) + 100 / Math.max(1, binCount) / 2),
        }
      : null;

  /**
   * Called by: ConcordanceDispersionSummary download dialog to export the rendered chart.
   * Flow: verify the chart SVG exists, assemble export header and legend metadata, then download the dispersion chart or show a toast error.
   */
  const handleDownload = async (format: ChartImageFormat) => {
    if (!chartContainerRef.current) {
      toast.error('Chart not available for export.');
      return;
    }
    const svg = findSvgInContainer(chartContainerRef.current);
    if (!svg) {
      toast.error('Chart SVG not found.');
      return;
    }
    const header: ChartExportHeaderItem[] = [
      { label: 'Title', value: titleText },
      { label: 'Mode', value: CHART_MODE_LABELS[chartMode] },
      { label: 'Search', value: searchWord || '—' },
      { label: 'Bins', value: String(binCount) },
      ...(splitBySource && sources.length > 0
        ? [{ label: 'Sources', value: sources.join(' / ') }]
        : []),
    ];
    const legendType: ChartExportLegendItem['type'] =
      chartMode === 'density-bar' ? 'bar' : chartMode === 'density-area' ? 'area' : 'line';
    const legend: ChartExportLegendItem[] = allSeries.map((item) => ({
      label: item.countLabel,
      color: item.color,
      type: legendType,
      hidden: item.hidden,
    }));
    try {
      await downloadChartAs(svg, {
        nodeName: dataBlockLabel,
        toolSuffix: 'concordance_dispersion',
        format,
        header,
        legend,
      });
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      toast.error('Failed to export chart.', { description });
    }
  };

  const chartContents = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey="binCenter"
        type="number"
        domain={[0, 100]}
        ticks={X_AXIS_TICKS}
        tickFormatter={formatTickLabel}
        tickLine={false}
        axisLine={false}
        tickMargin={8}
      />
      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tickMargin={8} width={36} />
      <ChartTooltip
        cursor={false}
        content={
          <ChartTooltipContent
            indicator="line"
            labelFormatter={(label) => formatBinRange(Number(label), binCount)}
          />
        }
      />
      {dragRange && (
        <ReferenceArea
          x1={dragRange.x1}
          x2={dragRange.x2}
          fill="var(--primary)"
          fillOpacity={0.12}
          strokeOpacity={0}
        />
      )}
      {dragStartX != null && (
        <ReferenceLine
          x={dragStartX}
          stroke="var(--primary)"
          strokeDasharray="4 4"
          strokeWidth={2}
        />
      )}
      {chartMode === 'density-bar'
        ? series.map((item) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.label ?? item.key}
              fill={chartColorVar(item.key)}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            >
              {selection
                ? chartData.map((_, index) => (
                    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Recharts Cell is its documented per-bar opacity API.
                    <Cell
                      key={`${item.key}-${String(index)}`}
                      fillOpacity={!hasSelection || selection.selectedIndices.has(index) ? 1 : 0.25}
                    />
                  ))
                : null}
            </Bar>
          ))
        : chartMode === 'density-area'
          ? series.map((item) => (
              <Area
                key={item.key}
                dataKey={item.key}
                name={item.label ?? item.key}
                type="natural"
                stackId="density"
                stroke={chartColorVar(item.key)}
                strokeDasharray={item.dash}
                fill={chartColorVar(item.key)}
                fillOpacity={hasSelection ? 0.2 : 0.35}
                dot={dotFor(item)}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
                connectNulls
              />
            ))
          : series.map((item) => (
              <Line
                key={item.key}
                dataKey={item.key}
                name={item.label ?? item.key}
                type={lineType}
                stroke={chartColorVar(item.key)}
                strokeDasharray={item.dash}
                strokeWidth={2}
                dot={dotFor(item)}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
    </>
  );

  const chartProps = {
    accessibilityLayer: true,
    data: chartData as never,
    margin: { top: 10, right: 12, bottom: 4, left: 12 },
    onMouseDown: handleDragStart as never,
    onMouseMove: handleDragMove as never,
    onMouseUp: handleDragEnd as never,
    onMouseLeave: handleDragCancel,
  };

  return (
    <Card className="mt-4 shadow-sm">
      <CardHeader className="gap-3 pb-2 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base">{chartTitle}</CardTitle>
          <CardDescription>{titleText}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {selection && selection.selectedIndices.size > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={selection.onClear}>
              Clear Selection ({selection.selectedIndices.size})
            </Button>
          )}
          {onBinCountChange && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <span id={`${controlId}-bin-count`}>Bin No.</span>
              <Select
                value={String(binCount)}
                onValueChange={(value) => {
                  const parsed = Number.parseInt(value, 10) as DispersionDisplayBinCount;
                  if ((DISPERSION_DISPLAY_BIN_COUNTS as readonly number[]).includes(parsed)) {
                    onBinCountChange(parsed);
                  }
                }}
              >
                <SelectTrigger
                  aria-labelledby={`${controlId}-bin-count`}
                  className="h-8 w-24 px-2 py-1"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {DISPERSION_DISPLAY_BIN_COUNTS.map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}
          {onChartModeChange && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <span id={`${controlId}-chart-mode`}>Chart</span>
              <Popover
                open={chartMenuOpen}
                onOpenChange={(open) => {
                  setChartMenuOpen(open);
                  if (!open) setCumulativeOptionOpen(false);
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-labelledby={`${controlId}-chart-mode`}
                    aria-expanded={chartMenuOpen}
                    className="h-8 w-36 justify-between px-2 py-1 font-normal"
                  >
                    <span className="truncate">{CHART_MODE_LABELS[chartMode]}</span>
                    <ChevronDown className="size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-44 p-1">
                  <div className="space-y-0.5">
                    {CONCORDANCE_DISPERSION_CHART_MODES.filter(
                      (value) => value !== 'cumulative',
                    ).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-hidden"
                        onClick={() => {
                          onChartModeChange(value);
                          setChartMenuOpen(false);
                        }}
                      >
                        {CHART_MODE_LABELS[value]}
                        {chartMode === value && <Check className="size-4" />}
                      </button>
                    ))}
                    <Collapsible open={cumulativeOptionOpen} onOpenChange={setCumulativeOptionOpen}>
                      <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-hidden">
                        More
                        <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-0.5">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded-sm py-1.5 pr-2 pl-5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-hidden"
                          onClick={() => {
                            onChartModeChange('cumulative');
                            setChartMenuOpen(false);
                          }}
                        >
                          Cumulative
                          {chartMode === 'cumulative' && <Check className="size-4" />}
                        </button>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label="Download dispersion summary"
            onClick={() => {
              setDownloadDialogOpen(true);
            }}
            disabled={series.length === 0}
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent ref={chartContainerRef} className="pb-2">
        <ChartContainer
          config={chartConfig}
          className={selection ? 'h-[240px] w-full cursor-pointer' : 'h-[240px] w-full'}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            initialDimension={{
              width: RESPONSIVE_CHART_INITIAL_WIDTH,
              height: CHART_HEIGHT,
            }}
          >
            {chartMode === 'density-bar' ? (
              <BarChart {...chartProps}>{chartContents}</BarChart>
            ) : chartMode === 'density-area' ? (
              <AreaChart {...chartProps}>{chartContents}</AreaChart>
            ) : (
              <LineChart {...chartProps}>{chartContents}</LineChart>
            )}
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2 text-foreground">
          <span>{titleText}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {allSeries.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`flex items-center gap-2 rounded px-1 py-0.5 ${
                item.hidden ? 'opacity-50 line-through' : ''
              }`}
              disabled={!onToggleMatchedText}
              aria-pressed={item.hidden}
              onClick={() => {
                onToggleMatchedText?.(item.matchedText);
              }}
            >
              <span
                className="inline-block h-0.5 w-5"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              <span>{item.countLabel}</span>
            </button>
          ))}
        </div>
      </CardFooter>
      <ChartImageDownloadDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        title="Download dispersion summary"
        onConfirm={(format) => {
          void handleDownload(format);
        }}
      />
    </Card>
  );
}
