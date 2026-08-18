import React, { useRef, useState } from 'react';
import type { TopicModelingTopic } from '@/api';
import JSZip from 'jszip';
import { toast } from 'sonner';
import { ChartImageDownloadDialog } from '@/components/ui/ChartImageDownloadDialog';
import { ResponsiveWordCloud } from '@/features/views/common/components/ResponsiveWordCloud';
import { getReadableTextColor } from '../../topicModelingAdapters';
import {
  buildChartBlob,
  type ChartExportHeaderItem,
  type ChartImageFormat,
} from '@/lib/chartExport';
import { saveBlob } from '@/lib/download';
import { buildTopicsCSV } from './topicModelingCsv';
import { TopicModelingFlowChart } from './TopicModelingFlowChart';
import { buildTopicBubbleModels, resolveTopicCorpusColor } from './topicModelingGraph';
import { TopicSelectionPanel } from './TopicSelectionPanel';

interface TooltipState {
  topic: TopicModelingTopic | null;
  x: number;
  y: number;
}

interface Props {
  topics: TopicModelingTopic[];
  exportTopics?: TopicModelingTopic[];
  tooltip: TooltipState;
  setTooltip: React.Dispatch<React.SetStateAction<TooltipState>>;
  hoveredTopicId: number | null;
  setHoveredTopicId: React.Dispatch<React.SetStateAction<number | null>>;
  selectedTopicIds: Set<number>;
  onToggleTopicSelection: (id: number) => void;
  onClearSelection: () => void;
  topicSearchQuery: string;
  onTopicSearchQueryChange: (query: string) => void;
  corpusCount: number;
  panelNodeIds: string[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  projectionKey: string;
  onViewReady: (projectionKey: string) => void;
  nodeNames?: string[];
  clusterCount?: number;
  exportDisabled?: boolean;
  randomSeed?: number;
  /** Result controls placed between the graph and the Topic lists. */
  controlRowSlot?: React.ReactNode;
}

const TM_CSV_OPTION = {
  id: 'includeCSV',
  label: 'Include representative words (CSV)',
  defaultChecked: true,
} as const;
const EMPTY_TOPIC_IDS = new Set<number>();

/** Renders corpus counts with the same persisted colours used by graph bubbles. */
function TopicSizeComposition({
  sizes,
  total,
  corpusCount,
  panelNodeIds,
  nodeColors,
  defaultPalette,
}: {
  sizes: number[] | undefined;
  total?: number | null;
  corpusCount: number;
  panelNodeIds: string[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
}) {
  if (corpusCount === 0 || !sizes) return null;
  const colorA = resolveTopicCorpusColor(
    0,
    defaultPalette[0] ?? '#2563eb',
    panelNodeIds,
    nodeColors,
    defaultPalette,
  );
  const colorB = resolveTopicCorpusColor(
    1,
    defaultPalette[1] ?? '#dc2626',
    panelNodeIds,
    nodeColors,
    defaultPalette,
  );
  if (sizes.length === 1) {
    return (
      <span className="inline-flex items-center gap-1">
        <span
          style={{ background: colorA, color: getReadableTextColor(colorA) }}
          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
        >
          {sizes[0]}
        </span>
        <span className="text-[10px] text-gray-500">= {total}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        style={{ background: colorA, color: getReadableTextColor(colorA) }}
        className="rounded px-1.5 py-0.5 text-[10px] font-medium"
      >
        {sizes[0]}
      </span>
      <span className="text-[10px] text-gray-500">+</span>
      <span
        style={{ background: colorB, color: getReadableTextColor(colorB) }}
        className="rounded px-1.5 py-0.5 text-[10px] font-medium"
      >
        {sizes[1]}
      </span>
      <span className="text-[10px] text-gray-500">= {total}</span>
    </span>
  );
}

/** Composes the React Flow topic graph, export dialog, result controls, and Topic lists. */
export function TopicModelingBubbleChartSection({
  topics,
  exportTopics = topics,
  tooltip,
  setTooltip,
  hoveredTopicId,
  setHoveredTopicId,
  selectedTopicIds,
  onToggleTopicSelection,
  onClearSelection,
  topicSearchQuery,
  onTopicSearchQueryChange,
  corpusCount,
  panelNodeIds,
  nodeColors,
  defaultPalette,
  projectionKey,
  onViewReady,
  nodeNames,
  clusterCount,
  exportDisabled = false,
  randomSeed,
  controlRowSlot,
}: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [lassoMode, setLassoMode] = useState(false);
  const [lassoFilter, setLassoFilter] = useState({
    projectionKey,
    topicIds: EMPTY_TOPIC_IDS,
  });
  const lassoTopicIds =
    lassoFilter.projectionKey === projectionKey ? lassoFilter.topicIds : EMPTY_TOPIC_IDS;
  const bubbles = buildTopicBubbleModels({
    topics,
    corpusCount,
    panelNodeIds,
    nodeColors,
    defaultPalette,
    selectedTopicIds,
    lassoTopicIds,
    hoveredTopicId,
    topicSearchQuery,
  });

  const renderSizeComposition = (sizes: number[] | undefined, total?: number | null) => (
    <TopicSizeComposition
      sizes={sizes}
      total={total}
      corpusCount={corpusCount}
      panelNodeIds={panelNodeIds}
      nodeColors={nodeColors}
      defaultPalette={defaultPalette}
    />
  );

  const handleDownloadChart = async (format: ChartImageFormat, extras: Record<string, boolean>) => {
    const svg = chartRef.current?.querySelector<SVGSVGElement>(
      'svg[data-topic-modeling-export="true"]',
    );
    if (!svg) {
      toast.error('Chart not available for export.');
      return;
    }
    const nodeName = (nodeNames ?? []).filter(Boolean).join('_') || 'data';
    const header: ChartExportHeaderItem[] = [
      { label: 'Data Block', value: nodeNames?.join(', ') ?? 'data' },
      { label: 'Clusters', value: clusterCount != null ? String(clusterCount) : '—' },
      { label: 'Random Seed', value: randomSeed != null ? String(randomSeed) : '—' },
      { label: 'Topics', value: String(topics.length) },
    ];
    try {
      if (extras.includeCSV ?? false) {
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
        zip.file(
          `${safeBaseName}_tm_topics.csv`,
          new Blob([buildTopicsCSV(exportTopics, selectedTopicIds, nodeNames ?? [])], {
            type: 'text/csv;charset=utf-8;',
          }),
        );
        await saveBlob(await zip.generateAsync({ type: 'blob' }), `${safeBaseName}_tm.zip`);
      } else {
        const { blob, filename } = await buildChartBlob(svg, {
          nodeName,
          toolSuffix: 'tm',
          format,
          header,
          legend: [],
        });
        await saveBlob(blob, filename);
      }
    } catch (error) {
      toast.error('Failed to export chart.', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <>
      <div ref={chartRef} className="relative w-full" style={{ containerType: 'inline-size' }}>
        <div
          className="overflow-hidden rounded-lg border border-muted-foreground/30 bg-background"
          data-testid="topic-bubble-chart-shell"
          style={{ height: 'clamp(320px, 55cqw, 520px)' }}
        >
          <TopicModelingFlowChart
            bubbles={bubbles}
            chartRootRef={chartRef}
            projectionKey={projectionKey}
            lassoMode={lassoMode}
            exportDisabled={exportDisabled}
            onToggleLassoMode={() => {
              setLassoMode((current) => !current);
              setHoveredTopicId(null);
              setTooltip((current) => ({ ...current, topic: null }));
            }}
            onAddLassoTopics={(topicIds) => {
              setLassoFilter((current) => ({
                projectionKey,
                topicIds: new Set([
                  ...(current.projectionKey === projectionKey ? current.topicIds : EMPTY_TOPIC_IDS),
                  ...topicIds,
                ]),
              }));
            }}
            onDownload={() => {
              setDownloadDialogOpen(true);
            }}
            onViewReady={onViewReady}
            onToggleTopicSelection={onToggleTopicSelection}
            setHoveredTopicId={setHoveredTopicId}
            setTooltip={setTooltip}
          />
        </div>
        {tooltip.topic ? (
          <div
            className="pointer-events-none absolute z-30 w-[min(18rem,calc(100%-1rem))] rounded-md border border-border bg-card p-3 text-xs shadow-lg"
            data-testid="topic-bubble-chart-tooltip"
            role="tooltip"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <div className="text-sm font-semibold">Topic {tooltip.topic.id}</div>
            <div className="mt-1 max-h-36 overflow-hidden text-muted-foreground">
              <ResponsiveWordCloud
                words={tooltip.topic.representative_words.map((term) => ({
                  text: term.word,
                  value: term.occurrence_count,
                }))}
                minWidth={180}
                aspectRatio={0.48}
              />
            </div>
            <span className="sr-only">
              {tooltip.topic.representative_words
                .map((term) => `${term.word}, ${String(term.occurrence_count)} occurrences`)
                .join('; ')}
            </span>
            <div className="mt-2">
              {renderSizeComposition(tooltip.topic.size, tooltip.topic.total_size)}
            </div>
          </div>
        ) : null}
      </div>

      {controlRowSlot ?? null}

      <TopicSelectionPanel
        topics={topics}
        selectedTopicIds={selectedTopicIds}
        onToggleTopicSelection={onToggleTopicSelection}
        onClearSelection={onClearSelection}
        topicSearchQuery={topicSearchQuery}
        onTopicSearchQueryChange={onTopicSearchQueryChange}
        lassoTopicIds={lassoTopicIds}
        onClearLassoFilter={() => {
          setLassoFilter({ projectionKey, topicIds: EMPTY_TOPIC_IDS });
        }}
        renderSizeComposition={renderSizeComposition}
        hoveredTopicId={hoveredTopicId}
        setHoveredTopicId={setHoveredTopicId}
      />

      <ChartImageDownloadDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        title="Download Topic Model Chart"
        extraOptions={[TM_CSV_OPTION]}
        onConfirm={(format, extras) => {
          void handleDownloadChart(format, extras);
        }}
      />
    </>
  );
}
