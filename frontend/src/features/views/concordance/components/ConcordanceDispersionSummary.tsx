import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import {
  CartesianGrid,
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
import {
  CONCORDANCE_DISPERSION_CHART_MODES,
  buildDispersionBins,
  buildDispersionBinsFromBinned,
  DISPERSION_AGGREGATE_KEY,
  DISPERSION_DISPLAY_BIN_COUNTS,
  DISPERSION_SOURCE_DELIMITER,
  type ConcordanceDispersionChartMode,
  type ConcordanceDispersionRow,
  type DispersionDisplayBinCount,
  type TaggedBinRow,
} from '../concordanceViewModels';

interface Props {
  rows: ConcordanceDispersionRow[];
  textColumn: string;
  binCount: number;
  lowercaseMatches: boolean;
  splitBySource: boolean;
  allMatchedTexts: string[];
  matchedTextColors: Record<string, string>;
  hiddenMatchedTexts: Set<string>;
  /** Human-readable label for the data block (used in title and download filename). */
  dataBlockLabel: string;
  searchWord: string;
  /**
   * When provided (i.e. node is materialised and the server-side 100-bin
   * histogram has been fetched), the plot is re-aggregated from these counts
   * instead of from the current page rows.
   */
  materialisedBins?: TaggedBinRow[];
  /**
   * True once this block (or every underlying block, in combined view) has
   * been processed. Drives whether the scope dropdown can select
   * "whole data block" after the server-side histogram rows are available.
   */
  materialised?: boolean;
  /**
   * When true (i.e. "Colour matches" is off), all hits are plotted as a single
   * aggregate line in a default colour, with no per-matched-text breakdown.
   */
  aggregateAll?: boolean;
  /** Dispersion figure mode. Density is the per-bin count; cumulative is the running total. */
  chartMode?: ConcordanceDispersionChartMode;
  /** Change handler for the chart-mode selector in the header. */
  onChartModeChange?: (value: ConcordanceDispersionChartMode) => void;
  /** Change handler for the bin-count selector in the header. */
  onBinCountChange?: (value: DispersionDisplayBinCount) => void;
  /** Effective Node.color for a single-source aggregate chart. */
  sourceColor?: string;
  /** Effective source-label to Node.color map for source-split charts. */
  sourceColors?: Record<string, string>;
  /** Click-to-select bins. Omitted = selection disabled. */
  selection?: {
    selectedIndices: ReadonlySet<number>;
    onSelect: (index: number, shiftHeld: boolean) => void;
    onSelectRange: (startIndex: number, endIndex: number, shiftHeld: boolean) => void;
    onClear: () => void;
  };
  /**
   * Published whenever the bins / selection / source switch change. The
   * caller (``ConcordanceDispersionNodeBlock``) feeds these to its
   * standalone ``ConcordanceDispersionLegend`` so each legend row can
   * show ``(n)`` — or ``(m/n)`` when a bin selection is active — in the
   * same colour as the line. Owning the legend up there (instead of
   * inside this component) preserves the existing visual anchoring
   * between the legend row and the proportional-bars list above it.
   */
  onLegendCountsChange?: (counts: {
    totals: ReadonlyMap<string, number>;
    selectedTotals: ReadonlyMap<string, number> | null;
  }) => void;
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
const AGGREGATE_LINE_LABEL = 'All matches';
const X_AXIS_TICKS = [0, 20, 40, 60, 80, 100];
const CHART_HEIGHT = 240;
const RESPONSIVE_CHART_INITIAL_WIDTH = 800;
const CHART_MODE_LABELS: Record<ConcordanceDispersionChartMode, string> = {
  density: 'Density',
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

const SOURCE_DASH_STYLES: (string | undefined)[] = [undefined, '6 4'];

/** Used by: ConcordanceDispersionSummary chart axis to format ticks as relative-position percentages. */
const formatTickLabel = (value: number): string => {
  if (!Number.isFinite(value)) return '';
  return `${String(Math.round(value))}%`;
};

/** Used by: ConcordanceDispersionSummary legend/count derivation to split combined text/source series keys. */
const stripSeriesKey = (key: string): { text: string; source: string | null } => {
  const idx = key.indexOf(DISPERSION_SOURCE_DELIMITER);
  if (idx === -1) return { text: key, source: null };
  return { text: key.slice(0, idx), source: key.slice(idx + DISPERSION_SOURCE_DELIMITER.length) };
};

/** Resolves source-node chart colours from exact or normalized labels before falling back to the current aggregate colour. */
const resolveSourceColor = (
  sourceColors: Record<string, string> | undefined,
  source: string,
  fallback: string,
): string => sourceColors?.[source] ?? sourceColors?.[source.toLowerCase()] ?? fallback;

/** Mirrors ChartContainer's CSS-variable slug so lines can use shadcn chart theme variables. */
const chartColorVar = (key: string): string =>
  `var(--color-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')})`;

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
 * Rendered by: ConcordanceDispersionNodeBlock to build the dispersion chart and export payload because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
export function ConcordanceDispersionSummary({
  rows,
  textColumn,
  binCount,
  lowercaseMatches,
  splitBySource,
  allMatchedTexts,
  matchedTextColors,
  hiddenMatchedTexts,
  dataBlockLabel,
  searchWord,
  materialisedBins,
  materialised = false,
  aggregateAll = false,
  chartMode = 'density',
  onChartModeChange,
  onBinCountChange,
  sourceColor,
  sourceColors,
  selection,
  onLegendCountsChange,
}: Props) {
  const controlId = useId();
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const dragSelectionRef = useRef<DragSelection | null>(null);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [dragSelection, setDragSelection] = useState<DragSelection | null>(null);

  const materialisedBinsReady = !!materialisedBins;
  const [showAllProcessed, setShowAllProcessed] = useState<boolean>(materialisedBinsReady);
  // Auto-enable the scope dropdown the *first* time the corpus bins finish
  // loading (so a fresh materialisation immediately switches the plot to
  // whole-data-block mode once the data is actually ready). After that,
  // respect the user's manual choice — otherwise a transient false→true
  // flip in `materialisedBins` (e.g. workspace navigation) would re-select
  // an option the user had just deselected. React-blessed render-time
  // set-state pattern, gated by a sticky flag.
  const [hasAutoEnabledShowAll, setHasAutoEnabledShowAll] =
    useState<boolean>(materialisedBinsReady);
  if (materialisedBinsReady && !hasAutoEnabledShowAll) {
    setHasAutoEnabledShowAll(true);
    setShowAllProcessed(true);
  }

  // The plot only switches data sources once the server-side bin histogram
  // has been fetched. Until then, even with the scope set to whole-corpus,
  // we keep showing the current page.
  const useMaterialised = materialised && showAllProcessed && materialisedBinsReady;
  const materialisedScopeReady = materialised && materialisedBinsReady;

  const { bins, sources, totalsByKey } = useMemo(() => {
    if (useMaterialised) {
      return buildDispersionBinsFromBinned(materialisedBins, binCount, {
        lowercaseMatches,
        splitBySource,
        aggregateAll,
      });
    }
    return buildDispersionBins(rows, textColumn, binCount, {
      lowercaseMatches,
      splitBySource,
      aggregateAll,
    });
  }, [
    useMaterialised,
    materialisedBins,
    rows,
    textColumn,
    binCount,
    lowercaseMatches,
    splitBySource,
    aggregateAll,
  ]);

  /**
   * Per-matched-text totals across every bin in the displayed graph.
   * Folds the per-source split-key form back to per-text by stripping
   * the source delimiter, so users always see one number per legend
   * row regardless of whether ``splitBySource`` is on. Hidden items are
   * still included — toggling visibility doesn't recompute the total
   * (the user wants to see the weight of the filter they just turned
   * off).
   */
  const totalsByText = useMemo(() => {
    const out = new Map<string, number>();
    for (const [key, value] of Object.entries(totalsByKey)) {
      if (key === DISPERSION_AGGREGATE_KEY) continue;
      const { text } = stripSeriesKey(key);
      if (!text) continue;
      out.set(text, (out.get(text) ?? 0) + value);
    }
    return out;
  }, [totalsByKey]);

  /**
   * Per-matched-text totals across only the user-selected bins. ``null``
   * when no selection is active so the legend renders the plain
   * ``(n)`` form instead of ``(m/n)``. When a selection exists but a
   * given matched-text has zero hits inside it, the value is 0 (the
   * legend displays it as ``(0/n)`` so the user sees which items are
   * absent from their selected window).
   */
  const selectedTotalsByText = useMemo<Map<string, number> | null>(() => {
    if (!selection || selection.selectedIndices.size === 0) return null;
    const out = new Map<string, number>();
    // Seed every known text with 0 so missing-from-selection items
    // surface as ``0`` instead of being undefined.
    for (const text of totalsByText.keys()) out.set(text, 0);
    for (const idx of selection.selectedIndices) {
      const bin = bins[idx];
      if (!bin) continue;
      for (const [key, val] of Object.entries(bin)) {
        if (key === 'binCenter' || key === DISPERSION_AGGREGATE_KEY) continue;
        const { text } = stripSeriesKey(key);
        if (!text) continue;
        out.set(text, (out.get(text) ?? 0) + (val || 0));
      }
    }
    return out;
  }, [selection, bins, totalsByText]);

  // Publish the per-text counts up to the parent so its standalone
  // legend (kept above the chart for visual continuity with the
  // proportional-bars table) can show ``(n)`` / ``(m/n)`` next to each
  // label. One-frame lag is acceptable — the legend mounts before the
  // first chart paint and just re-renders once the totals land.
  useEffect(() => {
    if (!onLegendCountsChange) return;
    onLegendCountsChange({
      totals: totalsByText,
      selectedTotals: selectedTotalsByText,
    });
  }, [onLegendCountsChange, totalsByText, selectedTotalsByText]);

  const aggregationLabel = useMaterialised ? 'whole data block' : 'page above';
  const titleText = `${dataBlockLabel}: aggregated matches at relative locations of documents from ${aggregationLabel}`;
  const chartTitle = `${CHART_MODE_LABELS[chartMode]} dispersion`;

  const visibleTexts = useMemo(
    () => allMatchedTexts.filter((t) => !hiddenMatchedTexts.has(t)),
    [allMatchedTexts, hiddenMatchedTexts],
  );

  const series: DispersionChartSeries[] = useMemo(() => {
    const aggregateColor = sourceColor ?? AGGREGATE_DEFAULT_COLOR;
    if (aggregateAll) {
      // No matched-text differentiation. If the user wants split-by-source,
      // emit one aggregate line per source (solid/dashed); otherwise a
      // single overall line.
      if (splitBySource && sources.length > 0) {
        return sources.map((src, idx) => ({
          key: `${DISPERSION_AGGREGATE_KEY}${DISPERSION_SOURCE_DELIMITER}${src}`,
          color: resolveSourceColor(sourceColors, src, aggregateColor),
          dash: SOURCE_DASH_STYLES[idx % SOURCE_DASH_STYLES.length],
          label: `${AGGREGATE_LINE_LABEL} (${src})`,
        }));
      }
      return [
        {
          key: DISPERSION_AGGREGATE_KEY,
          color: aggregateColor,
          label: AGGREGATE_LINE_LABEL,
        },
      ];
    }
    const out: DispersionChartSeries[] = [];
    for (const text of visibleTexts) {
      const color = matchedTextColors[text] ?? AGGREGATE_DEFAULT_COLOR;
      if (splitBySource && sources.length > 0) {
        sources.forEach((src, idx) => {
          out.push({
            key: `${text}${DISPERSION_SOURCE_DELIMITER}${src}`,
            color,
            dash: SOURCE_DASH_STYLES[idx % SOURCE_DASH_STYLES.length],
            label: `${text} (${src})`,
          });
        });
      } else {
        out.push({ key: text, color, label: text });
      }
    }
    return out;
  }, [
    aggregateAll,
    sourceColor,
    sourceColors,
    visibleTexts,
    matchedTextColors,
    splitBySource,
    sources,
  ]);

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

  /** Derives the Recharts dot renderer for the active density/cumulative mode and selection state. */
  const dotFor = (item: DispersionChartSeries) => {
    const color = chartColorVar(item.key);
    if (selection) return renderDot(color, chartMode === 'density');
    if (chartMode === 'density') return { fill: color };
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
    const legend: ChartExportLegendItem[] = aggregateAll
      ? series.map((item) => ({
          label: item.label ?? AGGREGATE_LINE_LABEL,
          color: item.color,
          type: 'line' as const,
          hidden: false,
        }))
      : allMatchedTexts.map((text) => ({
          label: text,
          color: matchedTextColors[text] ?? AGGREGATE_DEFAULT_COLOR,
          type: 'line' as const,
          hidden: hiddenMatchedTexts.has(text),
        }));
    if (splitBySource && sources.length > 0) {
      sources.forEach((src, idx) => {
        legend.push({
          label: `${src}${idx === 0 ? ' (solid)' : ' (dashed)'}`,
          color: resolveSourceColor(sourceColors, src, '#374151'),
          type: 'line' as const,
          hidden: false,
        });
      });
    }
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
              <Select
                value={chartMode}
                onValueChange={(value) => {
                  onChartModeChange(value as ConcordanceDispersionChartMode);
                }}
              >
                <SelectTrigger
                  aria-labelledby={`${controlId}-chart-mode`}
                  className="h-8 w-36 px-2 py-1"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {CONCORDANCE_DISPERSION_CHART_MODES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {CHART_MODE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
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
            <LineChart
              accessibilityLayer
              data={chartData as never}
              margin={{ top: 10, right: 12, bottom: 4, left: 12 }}
              onMouseDown={handleDragStart as never}
              onMouseMove={handleDragMove as never}
              onMouseUp={handleDragEnd as never}
              onMouseLeave={handleDragCancel}
            >
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
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={36}
              />
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
              {series.map((item) => (
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
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2 text-foreground">
          <span>{dataBlockLabel}: aggregated matches at relative locations of documents from</span>
          <Select
            value={materialisedScopeReady && showAllProcessed ? 'whole' : 'page'}
            disabled={!materialisedScopeReady}
            onValueChange={(value) => {
              setShowAllProcessed(value === 'whole');
            }}
          >
            <SelectTrigger
              aria-label="Aggregation scope"
              className="h-8 w-48 px-2 py-1 font-medium"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="page">page above</SelectItem>
                {materialisedScopeReady && <SelectItem value="whole">whole data block</SelectItem>}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {splitBySource && sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            {sources.map((src, idx) => {
              const dash = SOURCE_DASH_STYLES[idx % SOURCE_DASH_STYLES.length];
              const color = resolveSourceColor(sourceColors, src, 'currentColor');
              return (
                <span key={src} className="flex items-center gap-2">
                  <svg width="22" height="6" aria-hidden="true">
                    <line
                      x1="0"
                      y1="3"
                      x2="22"
                      y2="3"
                      stroke={color}
                      strokeWidth="2"
                      strokeDasharray={dash}
                    />
                  </svg>
                  <span>{src}</span>
                </span>
              );
            })}
          </div>
        )}
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
