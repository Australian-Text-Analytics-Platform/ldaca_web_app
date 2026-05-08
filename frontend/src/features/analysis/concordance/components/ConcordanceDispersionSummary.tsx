import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';

import { Button } from '../../../../components/ui/button';
import { ChartImageDownloadDialog } from '../../../../components/ui/ChartImageDownloadDialog';
import {
  downloadChartAs,
  findSvgInContainer,
  type ChartExportHeaderItem,
  type ChartExportLegendItem,
  type ChartImageFormat,
} from '../../../../lib/chartExport';

import {
  buildDispersionBins,
  buildDispersionBinsFromBinned,
  DISPERSION_AGGREGATE_KEY,
  DISPERSION_SOURCE_DELIMITER,
  type ConcordanceDispersionRow,
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
}) => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);

  const materialisedBinsReady = !!materialisedBins;
  const [showAllProcessed, setShowAllProcessed] = useState<boolean>(materialised);
  // Default to "all processed" once a block is materialised; revert to the
  // page view if materialisation goes away (e.g. user switches blocks).
  useEffect(() => {
    setShowAllProcessed(materialised);
  }, [materialised]);

  // The plot only switches data sources once the server-side bin histogram
  // has been fetched. Until then, even with the toggle on, we keep showing
  // the current page.
  const useMaterialised = materialised && showAllProcessed && materialisedBinsReady;
  const effectiveSplitBySource = aggregateAll ? false : splitBySource;

  const { bins, sources } = useMemo(() => {
    if (useMaterialised && materialisedBins) {
      return buildDispersionBinsFromBinned(materialisedBins, binCount, {
        lowercaseMatches,
        splitBySource: effectiveSplitBySource,
        aggregateAll,
      });
    }
    return buildDispersionBins(rows, textColumn, binCount, {
      lowercaseMatches,
      splitBySource: effectiveSplitBySource,
      aggregateAll,
    });
  }, [useMaterialised, materialisedBins, rows, textColumn, binCount, lowercaseMatches, effectiveSplitBySource, aggregateAll]);

  const title = useMaterialised
    ? `Aggregated matches of data block - ${dataBlockLabel}`
    : 'Aggregated matches of the documents above';

  const visibleTexts = useMemo(
    () => allMatchedTexts.filter((t) => !hiddenMatchedTexts.has(t)),
    [allMatchedTexts, hiddenMatchedTexts],
  );

  type SeriesConfig = {
    key: string;
    color: string;
    dash: string | undefined;
    name: string;
    text: string;
    source: string | null;
  };

  const series: SeriesConfig[] = useMemo(() => {
    if (aggregateAll) {
      return [
        {
          key: DISPERSION_AGGREGATE_KEY,
          color: AGGREGATE_DEFAULT_COLOR,
          dash: undefined,
          name: AGGREGATE_LINE_LABEL,
          text: AGGREGATE_LINE_LABEL,
          source: null,
        },
      ];
    }
    const out: SeriesConfig[] = [];
    for (const text of visibleTexts) {
      const color = matchedTextColors[text] ?? AGGREGATE_DEFAULT_COLOR;
      if (effectiveSplitBySource && sources.length > 0) {
        sources.forEach((src, idx) => {
          out.push({
            key: `${text}${DISPERSION_SOURCE_DELIMITER}${src}`,
            color,
            dash: SOURCE_DASH_STYLES[idx % SOURCE_DASH_STYLES.length],
            name: `${text} (${src})`,
            text,
            source: src,
          });
        });
      } else {
        out.push({ key: text, color, dash: undefined, name: text, text, source: null });
      }
    }
    return out;
  }, [aggregateAll, visibleTexts, matchedTextColors, effectiveSplitBySource, sources]);

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
      { label: 'Title', value: title },
      { label: 'Search', value: searchWord || '—' },
      { label: 'Bins', value: String(binCount) },
      ...(effectiveSplitBySource && sources.length > 0
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
    if (!aggregateAll && effectiveSplitBySource && sources.length > 0) {
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
      <div className="flex items-center justify-end gap-3">
        {materialised && (
          <label className="flex items-center gap-2 text-sm text-foreground" title={materialisedBinsReady ? undefined : 'Loading materialised bins…'}>
            <input
              type="checkbox"
              checked={showAllProcessed}
              onChange={(e) => setShowAllProcessed(e.target.checked)}
              className="h-4 w-4"
            />
            <span>All processed{showAllProcessed && !materialisedBinsReady ? ' (loading…)' : ''}</span>
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
      <div ref={chartContainerRef} className="w-full">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={bins} margin={{ top: 10, right: 24, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="binCenter"
              type="number"
              domain={[0, 100]}
              ticks={X_AXIS_TICKS}
              tickFormatter={formatTickLabel}
            />
            <YAxis allowDecimals={false} />
            <Tooltip
              formatter={(value, name) => {
                const rawName = String(name);
                if (rawName === DISPERSION_AGGREGATE_KEY) {
                  return [value as number, AGGREGATE_LINE_LABEL];
                }
                const { text, source } = stripSeriesKey(rawName);
                return [value as number, source ? `${text} (${source})` : text];
              }}
              labelFormatter={(label) => formatBinRange(Number(label), binCount)}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dash}
                dot={false}
                activeDot={{ r: 3 }}
                name={s.name}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="text-center text-sm font-medium text-foreground">{title}</div>
      {effectiveSplitBySource && sources.length > 0 && (
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
