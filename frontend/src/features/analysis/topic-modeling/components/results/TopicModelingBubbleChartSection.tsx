import React, { useState } from 'react';
import JSZip from 'jszip';
import { Download, Scan } from 'lucide-react';
import { toast } from 'sonner';
import { TopicSelectionPanel } from './TopicSelectionPanel';
import type { ZoomDomain } from '../../topicModelingAdapters';
import { ChartImageDownloadDialog } from '../../../../../components/ui/ChartImageDownloadDialog';
import {
  buildChartBlob,
  findSvgInContainer,
  type ChartImageFormat,
  type ChartExportHeaderItem,
} from '../../../../../lib/chartExport';
import { saveBlob } from '../../../../../lib/download';

type TopicLike = {
  id: number;
  label: string;
  representative_words?: string[];
  size?: number[];
  total_size?: number | null;
  x?: number;
  y?: number;
};

type Props = {
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
  topicSizeMode?: string;
  topicSizeValue?: number;
  randomSeed?: number;
};

const OVERLAY_BTN =
  'flex items-center gap-1.5 rounded-md border border-border bg-white/95 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';

const escapeCsv = (v: string) => `"${v.replace(/"/g, '""')}"`;

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
  topicSizeMode,
  topicSizeValue,
  randomSeed,
}: Props) {
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);

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
    const topicSizeLabel =
      topicSizeMode === 'min' ? 'Min Topic Size' :
      topicSizeMode === 'exact' ? 'Exact Topics' :
      'Target Topics';
    const header: ChartExportHeaderItem[] = [
      { label: 'Data Block',   value: nodeNames?.join(', ') ?? 'data' },
      { label: topicSizeLabel, value: topicSizeValue != null ? String(topicSizeValue) : '—' },
      { label: 'Random Seed',  value: randomSeed    != null ? String(randomSeed)    : '—' },
      { label: 'Topics',       value: String(topics.length) },
    ];

    const includeCSV = extras['includeCSV'] ?? false;

    try {
      if (includeCSV) {
        // Build image blob + CSV blob, then zip together
        const { blob: imageBlob, filename: imageFilename } = await buildChartBlob(svg, {
          nodeName,
          toolSuffix: 'tm',
          format,
          header,
          legend: [],
        });

        const csvContent = buildTopicsCSV(topics, selectedTopicIds, nodeNames ?? []);
        const csvBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const csvFilename = `${nodeName.replace(/[<>:"\\|?*/\s]+/g, '_').slice(0, 60) || 'data'}_tm_topics.csv`;

        const zip = new JSZip();
        zip.file(imageFilename, imageBlob);
        zip.file(csvFilename, csvBlob);

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipFilename = `${nodeName.replace(/[<>:"\\|?*/\s]+/g, '_').slice(0, 60) || 'data'}_tm.zip`;
        await saveBlob(zipBlob, zipFilename);
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
    } catch (err) {
      toast.error('Failed to export chart.');
      console.error(err);
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
              onClick={() => setDownloadDialogOpen(true)}
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
            <div className="mt-1 wrap-break-word text-[10px] leading-snug text-muted-foreground">{tooltip.topic.label}</div>
            <div className="mt-2">{renderSizeComposition(tooltip.topic.size, tooltip.topic.total_size)}</div>
          </div>
        )}
      </div>

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
        extraOptions={[TM_CSV_OPTION]}
        onConfirm={(format, extras) => { void handleDownloadChart(format, extras); }}
      />
    </>
  );
}
