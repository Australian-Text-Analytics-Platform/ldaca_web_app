import React, { useMemo, useRef, useState } from 'react';
import { Download, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ChartImageDownloadDialog } from '@/components/ui/ChartImageDownloadDialog';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import {
  downloadChartAs,
  findSvgInContainer,
  type ChartExportHeaderItem,
  type ChartExportLegendItem,
  type ChartImageFormat,
} from '@/lib/chartExport';
import {
  MultiSeriesChart,
  type MultiSeriesChartSeries,
  type MultiSeriesChartType,
} from '@/features/analysis/common/components/MultiSeriesChart';

import {
  buildDispersionBins,
  buildDispersionBinsFromBinned,
  DISPERSION_AGGREGATE_KEY,
  DISPERSION_DISPLAY_BIN_COUNTS,
  DISPERSION_SOURCE_DELIMITER,
  type ConcordanceDispersionRow,
  type DispersionDisplayBinCount,
  type TaggedBinRow,
} from '../concordanceViewModels';

type Props = {
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
   * been processed. Drives the visibility of the "All processed" toggle —
   * decoupled from {@link positions} so the toggle appears as soon as
   * materialisation completes, even before the slim-positions fetch returns.
   */
  materialised?: boolean;
  /**
   * When true (i.e. "Colour matches" is off), all hits are plotted as a single
   * aggregate line in a default colour, with no per-matched-text breakdown.
   */
  aggregateAll?: boolean;
  /** Chart primitive. Default 'line'. */
  chartType?: MultiSeriesChartType;
  /** Change handler for the chart-type selector in the header. */
  onChartTypeChange?: (value: MultiSeriesChartType) => void;
  /** Change handler for the bin-count selector in the header. */
  onBinCountChange?: (value: DispersionDisplayBinCount) => void;
  /** Click-to-select bins. Omitted = selection disabled. */
  selection?: {
    selectedIndices: ReadonlySet<number>;
    onSelect: (index: number, shiftHeld: boolean) => void;
    onClear: () => void;
  };
  /**
   * Wires the per-document aggregated "Add to Workspace" button. The summary
   * passes the current selection (or `null` if empty) to the parent, which
   * resolves the source-node(s), names the result, and dispatches the detach.
   */
  detach?: {
    onClick: (selectedBins: ReadonlySet<number> | null) => void | Promise<void>;
    isLoading: boolean;
    disabled?: boolean;
  };
};

const AGGREGATE_DEFAULT_COLOR = '#0284c7';
const AGGREGATE_LINE_LABEL = 'All matches';
const X_AXIS_TICKS = [0, 20, 40, 60, 80, 100];

/**
 * Format a bin's range as a human-friendly string. For sufficiently wide bins
 * (≥ 2 % each, i.e. binCount ≤ 50) we use non-overlapping integer ranges with
 * a +1 increment ("0-5%", "6-10%"). For narrower bins we fall back to
 * one-decimal fractional ranges so the labels stay accurate.
 */
const formatBinRange = (binCenter: number, binCount: number): string => {
  const safeBinCount = Math.max(1, Math.floor(binCount));
  const width = 100 / safeBinCount;
  const idx = Math.min(
    safeBinCount - 1,
    Math.max(0, Math.floor((binCenter * safeBinCount) / 100)),
  );
  if (width >= 2) {
    const lower = idx === 0 ? 0 : Math.round(idx * width) + 1;
    const upper = Math.round((idx + 1) * width);
    return `${lower}-${upper}%`;
  }
  const lower = idx * width;
  const upper = (idx + 1) * width;
  return `${lower.toFixed(1)}-${upper.toFixed(1)}%`;
};

const SOURCE_DASH_STYLES: (string | undefined)[] = [undefined, '6 4'];

const formatTickLabel = (value: number): string => {
  if (!Number.isFinite(value)) return '';
  return `${Math.round(value)}%`;
};

const stripSeriesKey = (key: string): { text: string; source: string | null } => {
  const idx = key.indexOf(DISPERSION_SOURCE_DELIMITER);
  if (idx === -1) return { text: key, source: null };
  return { text: key.slice(0, idx), source: key.slice(idx + DISPERSION_SOURCE_DELIMITER.length) };
};

export const ConcordanceDispersionSummary: React.FC<Props> = ({
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
  chartType = 'line',
  onChartTypeChange,
  onBinCountChange,
  selection,
  detach,
}) => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);

  const materialisedBinsReady = !!materialisedBins;
  const [showAllProcessed, setShowAllProcessed] = useState<boolean>(materialisedBinsReady);
  // Auto-enable the scope dropdown the *first* time the corpus bins finish
  // loading (so a fresh materialisation immediately switches the plot to
  // whole-data-block mode once the data is actually ready). After that,
  // respect the user's manual choice — otherwise a transient false→true
  // flip in `materialisedBins` (e.g. workspace navigation) would re-select
  // an option the user had just deselected. React-blessed render-time
  // set-state pattern, gated by a sticky flag.
  const [hasAutoEnabledShowAll, setHasAutoEnabledShowAll] = useState<boolean>(materialisedBinsReady);
  if (materialisedBinsReady && !hasAutoEnabledShowAll) {
    setHasAutoEnabledShowAll(true);
    setShowAllProcessed(true);
  }

  // The plot only switches data sources once the server-side bin histogram
  // has been fetched. Until then, even with the toggle on, we keep showing
  // the current page.
  const useMaterialised = materialised && showAllProcessed && materialisedBinsReady;

  const { bins, sources } = useMemo(() => {
    if (useMaterialised && materialisedBins) {
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
  }, [useMaterialised, materialisedBins, rows, textColumn, binCount, lowercaseMatches, splitBySource, aggregateAll]);

  const aggregationLabel = useMaterialised ? 'whole data block' : 'page above';
  const titleText = `${dataBlockLabel}: aggregated matches at relative locations of documents from ${aggregationLabel}`;

  const visibleTexts = useMemo(
    () => allMatchedTexts.filter((t) => !hiddenMatchedTexts.has(t)),
    [allMatchedTexts, hiddenMatchedTexts],
  );

  const series: MultiSeriesChartSeries[] = useMemo(() => {
    if (aggregateAll) {
      // No matched-text differentiation. If the user wants split-by-source,
      // emit one aggregate line per source (solid/dashed); otherwise a
      // single overall line.
      if (splitBySource && sources.length > 0) {
        return sources.map((src, idx) => ({
          key: `${DISPERSION_AGGREGATE_KEY}${DISPERSION_SOURCE_DELIMITER}${src}`,
          color: AGGREGATE_DEFAULT_COLOR,
          dash: SOURCE_DASH_STYLES[idx % SOURCE_DASH_STYLES.length],
          label: `${AGGREGATE_LINE_LABEL} (${src})`,
        }));
      }
      return [
        {
          key: DISPERSION_AGGREGATE_KEY,
          color: AGGREGATE_DEFAULT_COLOR,
          label: AGGREGATE_LINE_LABEL,
        },
      ];
    }
    const out: MultiSeriesChartSeries[] = [];
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
  }, [aggregateAll, visibleTexts, matchedTextColors, splitBySource, sources]);

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
      { label: 'Search', value: searchWord || '—' },
      { label: 'Bins', value: String(binCount) },
      ...(splitBySource && sources.length > 0
        ? [{ label: 'Sources', value: sources.join(' / ') }]
        : []),
    ];
    const legend: ChartExportLegendItem[] = aggregateAll
      ? [
          {
            label: AGGREGATE_LINE_LABEL,
            color: AGGREGATE_DEFAULT_COLOR,
            type: 'line' as const,
            hidden: false,
          },
        ]
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
          color: '#374151',
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
    } catch (err) {
      toast.error('Failed to export chart.');
      console.error(err);
    }
  };

  return (
    <div className="mt-4 space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {selection && selection.selectedIndices.size > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={selection.onClear}
          >
            Clear Selection ({selection.selectedIndices.size})
          </Button>
        )}
        {onBinCountChange && (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <span>Bin No.</span>
            <select
              value={binCount}
              onChange={(e) => {
                const parsed = Number.parseInt(
                  e.target.value,
                  10,
                ) as DispersionDisplayBinCount;
                if (
                  (DISPERSION_DISPLAY_BIN_COUNTS as readonly number[]).includes(
                    parsed,
                  )
                ) {
                  onBinCountChange(parsed);
                }
              }}
              className="h-7 rounded border border-input bg-background px-2 text-sm"
            >
              {DISPERSION_DISPLAY_BIN_COUNTS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}
        {onChartTypeChange && (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <span>Chart</span>
            <select
              value={chartType}
              onChange={(e) =>
                onChartTypeChange(e.target.value as MultiSeriesChartType)
              }
              className="h-7 rounded border border-input bg-background px-2 text-sm"
            >
              <option value="line">Line</option>
              <option value="bar">Bar</option>
              <option value="area">Area</option>
            </select>
          </label>
        )}
        <Button
          variant="outline"
          size="icon"
          aria-label="Download dispersion summary"
          onClick={() => setDownloadDialogOpen(true)}
          disabled={series.length === 0}
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>
      <MultiSeriesChart
        data={bins}
        xKey="binCenter"
        series={series}
        chartType={chartType}
        height={240}
        margin={{ top: 10, right: 24, bottom: 10, left: 0 }}
        xAxis={{
          type: 'number',
          domain: [0, 100],
          ticks: X_AXIS_TICKS,
          tickFormatter: formatTickLabel as never,
        }}
        yAxis={{ allowDecimals: false }}
        tooltip={{
          labelFormatter: ((label: unknown) =>
            formatBinRange(Number(label), binCount)) as never,
          valueFormatter: ((value: unknown, name: unknown) => {
            const rawName = String(name);
            const { text, source } = stripSeriesKey(rawName);
            const displayText =
              text === DISPERSION_AGGREGATE_KEY ? AGGREGATE_LINE_LABEL : text;
            return [
              value as number,
              source ? `${displayText} (${source})` : displayText,
            ];
          }) as never,
        }}
        selection={
          selection
            ? {
                selectedIndices: selection.selectedIndices,
                onSelect: selection.onSelect,
              }
            : undefined
        }
        interactive={!!selection}
        animate={false}
        connectNulls
        containerRef={chartContainerRef}
      />
      <div className="flex flex-wrap items-center justify-center gap-2 text-center text-sm font-medium text-foreground">
        <span>
          {dataBlockLabel}: aggregated matches at relative locations of documents from
        </span>
        <select
          value={showAllProcessed ? 'whole' : 'page'}
          disabled={!materialisedBinsReady}
          onChange={(e) => setShowAllProcessed(e.target.value === 'whole')}
          className="h-7 rounded border border-input bg-background px-2 text-sm font-medium"
          aria-label="Aggregation scope"
        >
          <option value="page">page above</option>
          {materialisedBinsReady && (
            <option value="whole">whole data block</option>
          )}
        </select>
      </div>
      {detach && (() => {
        const hasSelection = !!(
          selection && selection.selectedIndices.size > 0
        );
        // Selections made on the per-page plot can't be safely projected onto
        // a corpus-wide aggregation — the page distribution may differ from
        // the full-corpus one, so the user's chosen bins might not pick out
        // the same hits once we read the whole data block. Force them to
        // either switch the scope to "whole data block" (selection now
        // corresponds to the same data the detach will aggregate) or clear
        // the selection (detach all hits, no scope mismatch).
        const selectionFromPageOnly = hasSelection && !useMaterialised;
        const isDisabled =
          (detach.disabled ?? false) || detach.isLoading || selectionFromPageOnly;
        const disabledReason = detach.isLoading
          ? undefined
          : selectionFromPageOnly
            ? 'Selection was made on the page above, which may differ from the full corpus. Switch the scope to "whole data block" to detach this selection, or clear the selection to detach all hits.'
            : detach.disabled
              ? 'No source data block available to detach.'
              : undefined;
        return (
          <div className="flex justify-center">
            <DisabledReasonTooltip reason={isDisabled ? disabledReason : undefined}>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  void detach.onClick(
                    hasSelection ? selection!.selectedIndices : null,
                  );
                }}
                disabled={isDisabled}
                title={
                  isDisabled
                    ? undefined
                    : hasSelection
                      ? 'Add a per-document aggregation of the selected bin hits to the workspace'
                      : 'Add a per-document aggregation of all hits to the workspace'
                }
              >
                {detach.isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Add to Workspace
                    {hasSelection
                      ? ` (${selection!.selectedIndices.size} bin${
                          selection!.selectedIndices.size === 1 ? '' : 's'
                        })`
                      : ''}
                  </>
                )}
              </Button>
            </DisabledReasonTooltip>
          </div>
        );
      })()}
      {splitBySource && sources.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
          {sources.map((src, idx) => {
            const dash = SOURCE_DASH_STYLES[idx % SOURCE_DASH_STYLES.length];
            return (
              <span key={src} className="flex items-center gap-2">
                <svg width="22" height="6" aria-hidden="true">
                  <line
                    x1="0"
                    y1="3"
                    x2="22"
                    y2="3"
                    stroke="currentColor"
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
      <ChartImageDownloadDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        title="Download dispersion summary"
        onConfirm={(format) => {
          void handleDownload(format);
        }}
      />
    </div>
  );
};
