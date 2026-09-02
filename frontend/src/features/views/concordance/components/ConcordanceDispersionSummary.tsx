import { useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { toast } from 'sonner';
import type { EChartsCoreOption } from 'echarts/core';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartImageDownloadDialog } from '@/components/ui/ChartImageDownloadDialog';
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
import { buildEChartsSeriesStates } from '../../common/echartsSeriesStates';
import { EChartsView } from '../../common/components/EChartsView';
import { FilterableSeriesControls } from '../../common/components/FilterableSeriesControls';
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
  uncasedMatchedTexts?: boolean;
  onUncasedMatchedTextsChange?: (value: boolean) => void;
  onToggleMatchedTexts?: (matchedTexts: readonly string[]) => void;
  /** Keeps the shared match controls mounted when the optional density chart is hidden. */
  showChart?: boolean;
}

interface DispersionChartSeries {
  key: string;
  color: string;
  matchedTexts: string[];
  hidden: boolean;
  countLabel: string;
  /** Human-readable label for tooltip/export display. */
  label?: string;
}

const AGGREGATE_DEFAULT_COLOR = '#0284c7';
const CHART_HEIGHT = 240;
const GROUPED_BAR_MAX_BIN_COUNT = 10;
const SELECTION_DIMENSION = '__wordflow_selected__';
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

const displayChartValue = (value: unknown): string => {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return '0';
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
  selection,
  densitySeries,
  termColors = {},
  excludedMatchedTexts = new Set<string>(),
  uncasedMatchedTexts = false,
  onUncasedMatchedTextsChange,
  onToggleMatchedTexts,
  showChart = true,
}: Props) {
  const controlId = useId();
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [chartMenuOpen, setChartMenuOpen] = useState(false);
  const [cumulativeOptionOpen, setCumulativeOptionOpen] = useState(false);

  const { bins, totalsByKey, labelsByKey, matchedTextsByKey, sources } = useMemo(() => {
    if (densitySeries) {
      return buildDispersionBinsFromDensitySeries(densitySeries, binCount, {
        splitBySource,
        uncased: uncasedMatchedTexts,
      });
    }
    return buildDispersionBins(rows, textColumn, binCount, {
      splitBySource,
      uncased: uncasedMatchedTexts,
    });
  }, [rows, textColumn, binCount, splitBySource, densitySeries, uncasedMatchedTexts]);

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
        const matchedTexts = matchedTextsByKey[key] ?? [matchedText];
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
          matchedTexts,
          color:
            termColors[matchedTexts[0] ?? matchedText] ??
            VIZ_PALETTE[index % VIZ_PALETTE.length] ??
            AGGREGATE_DEFAULT_COLOR,
          label: matchedText,
          hidden: matchedTexts.every((value) => excludedMatchedTexts.has(value)),
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
    matchedTextsByKey,
    selection?.selectedIndices,
    termColors,
    totalsByKey,
  ]);
  const series = allSeries.filter((item) => !item.hidden);

  const chartData = useMemo(
    () => (chartMode === 'cumulative' ? buildCumulativeChartData(bins, series) : bins),
    [bins, chartMode, series],
  );

  const hasSelection = !!selection && selection.selectedIndices.size > 0;
  const areaOpacity = hasSelection ? 0.2 : 0.35;
  const usesGroupedBars = chartMode === 'density-bar' && binCount <= GROUPED_BAR_MAX_BIN_COUNT;
  const usesStackedBars = chartMode === 'density-bar' && !usesGroupedBars;
  const usesSelectionVisual = hasSelection && chartMode === 'density-bar';
  const source = usesSelectionVisual
    ? chartData.map((row, index) => ({
        ...row,
        [SELECTION_DIMENSION]: selection.selectedIndices.has(index) ? 1 : 0,
      }))
    : chartData;
  const seriesOptions = series.map((item) => {
    const common = {
      id: item.key,
      name: item.label ?? item.key,
      encode: { x: 'binCenter', y: item.key, tooltip: [item.key] },
      itemStyle: { color: item.color },
    };
    if (chartMode === 'density-bar') {
      return {
        ...common,
        ...buildEChartsSeriesStates({ chartType: 'bar' }),
        type: 'bar' as const,
        stack: usesStackedBars ? 'density' : undefined,
        barGap: usesGroupedBars ? '10%' : '0%',
        barCategoryGap: usesGroupedBars ? '8%' : '4%',
        itemStyle: {
          color: item.color,
          borderRadius: usesStackedBars ? 0 : [4, 4, 0, 0],
        },
      };
    }
    return {
      ...common,
      ...buildEChartsSeriesStates(
        chartMode === 'density-area'
          ? { chartType: 'area', areaOpacity, selectedIndices: selection?.selectedIndices }
          : { chartType: 'line', selectedIndices: selection?.selectedIndices },
      ),
      type: 'line' as const,
      ...(chartMode === 'cumulative' ? { step: 'middle' as const } : { smooth: true }),
      ...(chartMode === 'density-area' ? { stack: 'density' } : {}),
      showSymbol: chartMode === 'density-line' || hasSelection,
      lineStyle: { color: item.color, width: 2 },
      areaStyle:
        chartMode === 'density-area' ? { color: item.color, opacity: areaOpacity } : undefined,
    };
  });
  const chartOption: EChartsCoreOption = {
    dataset: {
      dimensions: [
        'binCenter',
        ...series.map((item) => item.key),
        ...(usesSelectionVisual ? [SELECTION_DIMENSION] : []),
      ],
      source,
    },
    grid: { containLabel: true, top: 10, right: 12, bottom: 32, left: 12 },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      axisPointer: { type: 'line' },
      formatter: (rawParams: unknown) => {
        const params = Array.isArray(rawParams)
          ? (rawParams as { value?: Record<string, unknown> }[])
          : [];
        const row = params[0]?.value;
        const lines = [formatBinRange(Number(row?.binCenter), binCount)];
        for (const item of series) {
          lines.push(`${item.label ?? item.key}: ${displayChartValue(row?.[item.key])}`);
        }
        return lines.join('\n');
      },
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: 100,
      interval: 20,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { formatter: (value: number) => formatTickLabel(value), margin: 8 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { margin: 8 },
      splitLine: { lineStyle: { color: 'var(--vscode-charts-lines)' } },
    },
    // Per-item opacity is encoded for bars. Line and area modes show selection
    // through their point symbols instead.
    ...(usesSelectionVisual
      ? {
          visualMap: {
            type: 'piecewise',
            show: false,
            dimension: SELECTION_DIMENSION,
            seriesIndex: seriesOptions.map((_, index) => index),
            pieces: [
              { value: 1, opacity: 1 },
              { value: 0, opacity: 0.25 },
            ],
          },
        }
      : {}),
    series: seriesOptions,
  };
  const getPointSummary = (index: number) => {
    const row = chartData[index];
    if (!row) return `Bin ${String(index + 1)}`;
    const values = series.map(
      (item) => `${item.label ?? item.key}: ${displayChartValue(row[item.key])}`,
    );
    return `${formatBinRange(Number(row.binCenter), binCount)}. ${values.join(', ')}`;
  };
  const dataResetKey = `${String(binCount)}:${JSON.stringify(bins)}`;

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

  return (
    <>
      <FilterableSeriesControls
        items={allSeries.map((item) => ({
          key: item.key,
          color: item.color,
          text: item.countLabel,
          label: item.countLabel,
          hidden: item.hidden,
        }))}
        ariaLabel="Matched terms"
        pressedWhenHidden
        uncased={uncasedMatchedTexts}
        onUncasedChange={onUncasedMatchedTextsChange}
        onClearSelection={selection?.onClear}
        clearSelectionDisabled={!selection || selection.selectedIndices.size === 0}
        onToggle={
          onToggleMatchedTexts
            ? (key) => {
                const item = allSeries.find((candidate) => candidate.key === key);
                if (item) onToggleMatchedTexts(item.matchedTexts);
              }
            : undefined
        }
      />
      {showChart ? (
        <Card data-testid="concordance-dispersion-chart">
          <CardHeader className="gap-3 pb-2 md:flex-row md:items-start md:justify-between">
            <CardTitle className="text-body">{chartTitle}</CardTitle>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {onBinCountChange && (
                <div className="flex items-center gap-2 text-body text-foreground">
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
                <div className="flex items-center gap-2 text-body text-foreground">
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
                            className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-body hover:bg-list-hover hover:text-foreground focus-visible:bg-list-hover focus-visible:text-foreground focus-visible:outline-hidden"
                            onClick={() => {
                              onChartModeChange(value);
                              setChartMenuOpen(false);
                            }}
                          >
                            {CHART_MODE_LABELS[value]}
                            {chartMode === value && <Check className="size-4" />}
                          </button>
                        ))}
                        <Collapsible
                          open={cumulativeOptionOpen}
                          onOpenChange={setCumulativeOptionOpen}
                        >
                          <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-body text-description hover:bg-list-hover hover:text-foreground focus-visible:bg-list-hover focus-visible:text-foreground focus-visible:outline-hidden">
                            More
                            <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
                          </CollapsibleTrigger>
                          <CollapsibleContent className="pt-0.5">
                            <button
                              type="button"
                              className="flex w-full items-center justify-between rounded-sm py-1.5 pr-2 pl-5 text-left text-body hover:bg-list-hover hover:text-foreground focus-visible:bg-list-hover focus-visible:text-foreground focus-visible:outline-hidden"
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
            <EChartsView
              option={chartOption}
              height={CHART_HEIGHT}
              pointCount={chartData.length}
              dataResetKey={dataResetKey}
              ariaLabel={`${chartTitle}. ${titleText}`}
              selectedIndices={selection?.selectedIndices}
              onSelect={selection?.onSelect}
              onSelectRange={selection?.onSelectRange}
              getPointSummary={getPointSummary}
              testId="concordance-echarts"
            />
          </CardContent>
          <ChartImageDownloadDialog
            open={downloadDialogOpen}
            onOpenChange={setDownloadDialogOpen}
            title="Download dispersion summary"
            onConfirm={(format) => {
              void handleDownload(format);
            }}
          />
        </Card>
      ) : null}
    </>
  );
}
