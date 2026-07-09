import React, { useState } from 'react';
import JSZip from 'jszip';
import { Download, Scan } from 'lucide-react';
import { toast } from 'sonner';
import { TopicSelectionPanel } from './TopicSelectionPanel';
import type { ZoomDomain } from '../../topicModelingAdapters';
import { ChartImageDownloadDialog } from '@/components/ui/ChartImageDownloadDialog';
import {
  buildChartBlob,
  findSvgInContainer,
  type ChartImageFormat,
  type ChartExportHeaderItem,
} from '@/lib/chartExport';
import { saveBlob } from '@/lib/download';

interface TopicLike {
  id: number;
  label: string;
  representative_words?: string[];
  size?: number[];
  total_size?: number | null;
  x?: number;
  y?: number;
}

interface Props {
  topics: TopicLike[];
  chartRef: React.RefObject<HTMLDivElement | null>;
  handleResetZoom: () => void;
  isAtGlobalZoom: boolean;
  bubbleElements: React.ReactNode;
  tooltip: { topic: TopicLike | null; x: number; y: number };
  renderSizeComposition: (size: number[] | undefined, totalSize?: number | null) => React.ReactNode;
  hoveredTopicId: number | null;
  setHoveredTopicId: React.Dispatch<React.SetStateAction<number | null>>;
  selectedTopicIds: Set<number>;
  onToggleTopicSelection: (id: number) => void;
  onClearSelection: () => void;
  topicSearchQuery: string;
  onTopicSearchQueryChange: (query: string) => void;
  activeDomain: ZoomDomain | null;
  nodeNames?: string[];
  topicSizeValue?: number;
  randomSeed?: number;
  /** Rendered between the bubble chart and the topic list. Hosts the
   * post-fit control row (topic count, re-aggregate
   * slider, Add to Workspace). */
  controlRowSlot?: React.ReactNode;
}

const OVERLAY_BTN =
  'flex items-center gap-1.5 rounded-md border border-border bg-white/95 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';

// Used by: buildTopicsCSV to escape topic labels and representative words for optional CSV export.
const escapeCsv = (v: string) => `"${v.replace(/"/g, '""')}"`;

// Used by: topic-modeling chart downloads because optional CSV bundles must mirror selected-topic ordering and visible corpus columns. Flow: sort selected topics first, build topic/corpus headers, escape cells, then join rows as CSV.
const buildTopicsCSV = (
  topics: TopicLike[],
  selectedTopicIds: Set<number>,
  nodeNames: string[],
): string => {
  const sorted = [...topics].sort((a, b) => {
    const aSelected = selectedTopicIds.has(a.id) ? 0 : 1;
    const bSelected = selectedTopicIds.has(b.id) ? 0 : 1;
    if (aSelected !== bSelected) return aSelected - bSelected;
    return a.id - b.id;
  });

  // Column layout mirrors the All Topics pane:
  //   Selected | Topic No | Representative Words | [NodeName...] | Total (multi-corpus only)
  const hasMultiCorpora = nodeNames.length >= 2;
  const headerCols = ['Selected', 'Topic No', 'Representative Words', ...nodeNames];
  if (hasMultiCorpora) headerCols.push('Total');

  const header = headerCols.map(escapeCsv).join(',');

  const rows = sorted.map((t) => {
    const cols = [
      escapeCsv(selectedTopicIds.has(t.id) ? 'Yes' : 'No'),
      escapeCsv(String(t.id)),
      escapeCsv((t.representative_words ?? []).join(', ')),
    ];
    // Per-node document counts
    for (let i = 0; i < nodeNames.length; i++) {
      cols.push(escapeCsv(String(t.size?.[i] ?? 0)));
    }
    // Total only when there are multiple corpora (otherwise it equals the single count)
    if (hasMultiCorpora) {
      cols.push(escapeCsv(String(t.total_size ?? 0)));
    }
    return cols.join(',');
  });

  return [header, ...rows].join('\r\n');
};

const TM_CSV_OPTION = {
  id: 'includeCSV',
  label: 'Include representative words (CSV)',
  defaultChecked: true,
} as const;

/**
 * Rendered by: TopicModelingResultsPanel to show the topic bubble chart and export controls because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
export function TopicModelingBubbleChartSection({
  topics,
  chartRef,
  handleResetZoom,
  isAtGlobalZoom,
  bubbleElements,
  tooltip,
  renderSizeComposition,
  hoveredTopicId,
  setHoveredTopicId,
  selectedTopicIds,
  onToggleTopicSelection,
  onClearSelection,
  topicSearchQuery,
  onTopicSearchQueryChange,
  activeDomain,
  nodeNames,
  topicSizeValue,
  randomSeed,
  controlRowSlot,
}: Props) {
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);

  const downloadExtraOptions = [TM_CSV_OPTION];

  // Called by: TopicModelingBubbleChartSection download menu because chart exports may include SVG/bitmap, topic CSV, and active stopword lists. Flow: verify the chart SVG, build header and extra files, then download the chart bundle or show toast errors.
  const handleDownloadChart = async (format: ChartImageFormat, extras: Record<string, boolean>) => {
    if (!chartRef.current) {
      toast.error('Chart not available for export.');
      return;
    }
    const svg = findSvgInContainer(chartRef.current);
    if (!svg) {
      toast.error('Chart SVG not found.');
      return;
    }

    // Join all node names with '_' so the filename reflects both data blocks
    const nodeName = (nodeNames ?? []).filter(Boolean).join('_') || 'data';
    const header: ChartExportHeaderItem[] = [
      { label: 'Data Block', value: nodeNames?.join(', ') ?? 'data' },
      {
        label: 'Minimum topic size',
        value: topicSizeValue != null ? String(topicSizeValue) : '—',
      },
      { label: 'Random Seed', value: randomSeed != null ? String(randomSeed) : '—' },
      { label: 'Topics', value: String(topics.length) },
    ];

    const includeCSV = extras.includeCSV ?? false;

    try {
      // Anything beyond the image alone forces the zip path so the
      // user gets one archive instead of N concurrent saveBlobs.
      const wantsZip = includeCSV;

      if (wantsZip) {
        const { blob: imageBlob, filename: imageFilename } = await buildChartBlob(svg, {
          nodeName,
          toolSuffix: 'tm',
          format,
          header,
          legend: [],
        });

        const safeBaseName = nodeName.replace(/[<>:"\\|?*/\s]+/g, '_').slice(0, 60) || 'data';

        const zip = new JSZip();
        zip.file(imageFilename, imageBlob);

        const csvContent = buildTopicsCSV(topics, selectedTopicIds, nodeNames ?? []);
        zip.file(
          `${safeBaseName}_tm_topics.csv`,
          new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }),
        );

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        await saveBlob(zipBlob, `${safeBaseName}_tm.zip`);
      } else {
        // Image only — use the same path as Trends
        await buildChartBlob(svg, {
          nodeName,
          toolSuffix: 'tm',
          format,
          header,
          legend: [],
        }).then(({ blob, filename }) => saveBlob(blob, filename));
      }
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      toast.error('Failed to export chart.', { description });
    }
  };

  return (
    <>
      <div className="relative w-full" ref={chartRef}>
        <div
          className="overflow-hidden rounded-lg border border-muted-foreground/30 bg-background"
          data-testid="topic-bubble-chart-shell"
        >
          {/* Top-right overlay: Reset view + Download — grouped so Download sits to the right of Reset view */}
          <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5">
            <button
              type="button"
              className={OVERLAY_BTN}
              onClick={handleResetZoom}
              disabled={isAtGlobalZoom}
              title="Reset zoom to global view (or double-click chart)"
              aria-label="Reset zoom to global view"
            >
              <Scan className="h-3.5 w-3.5" />
              Reset view
            </button>
            <button
              type="button"
              className={OVERLAY_BTN}
              onClick={() => {
                setDownloadDialogOpen(true);
              }}
              title="Download chart"
              aria-label="Download chart"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
          {bubbleElements}
        </div>
        {tooltip.topic && (
          <div
            className="pointer-events-none absolute z-30 max-w-xs rounded-md border border-border bg-card p-3 text-xs shadow-lg"
            data-testid="topic-bubble-chart-tooltip"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <div className="text-sm font-semibold">Topic {tooltip.topic.id}</div>
            <div className="mt-1 wrap-break-word text-[10px] leading-snug text-muted-foreground">
              {tooltip.topic.label}
            </div>
            <div className="mt-2">
              {renderSizeComposition(tooltip.topic.size, tooltip.topic.total_size)}
            </div>
          </div>
        )}
      </div>

      {controlRowSlot ?? null}

      <TopicSelectionPanel
        topics={topics}
        selectedTopicIds={selectedTopicIds}
        onToggleTopicSelection={onToggleTopicSelection}
        onClearSelection={onClearSelection}
        topicSearchQuery={topicSearchQuery}
        onTopicSearchQueryChange={onTopicSearchQueryChange}
        activeDomain={activeDomain}
        isAtGlobalZoom={isAtGlobalZoom}
        renderSizeComposition={renderSizeComposition}
        hoveredTopicId={hoveredTopicId}
        setHoveredTopicId={setHoveredTopicId}
      />

      <ChartImageDownloadDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        title="Download Topic Model Chart"
        extraOptions={downloadExtraOptions}
        onConfirm={(format, extras) => {
          void handleDownloadChart(format, extras);
        }}
      />
    </>
  );
}
