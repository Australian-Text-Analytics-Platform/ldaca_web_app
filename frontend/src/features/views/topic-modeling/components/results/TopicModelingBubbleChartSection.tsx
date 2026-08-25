import React, { useRef, useState } from 'react';
import type { TopicModelingTopic } from '@/api';
import JSZip from 'jszip';
import { toast } from 'sonner';
import { ChartImageDownloadDialog } from '@/components/ui/ChartImageDownloadDialog';
import {
  buildChartBlob,
  type ChartExportHeaderItem,
  type ChartImageFormat,
} from '@/lib/chartExport';
import { saveBlob } from '@/lib/download';
import { buildTopicsCSV } from './topicModelingCsv';
import { TopicModelingFlowChart } from './TopicModelingFlowChart';
import { buildTopicBubbleModels } from './topicModelingGraph';
import { TopicSelectionPanel } from './TopicSelectionPanel';

interface Props {
  topics: TopicModelingTopic[];
  exportTopics?: TopicModelingTopic[];
  selectedTopicIds: Set<number>;
  onToggleTopicSelection: (id: number) => void;
  onClearSelection: () => void;
  topicSearchQuery: string;
  onTopicSearchQueryChange: (query: string) => void;
  corpusSizes: number[];
  panelNodeIds: string[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  projectionKey: string;
  onViewReady: (projectionKey: string) => void;
  nodeNames?: string[];
  clusterCount?: number;
  exportDisabled?: boolean;
  randomSeed?: number;
  topNTopics?: number;
  /** Result controls placed between the graph and the Topic lists. */
  controlRowSlot?: React.ReactNode;
}

const TM_CSV_OPTION = {
  id: 'includeCSV',
  label: 'Include representative words (CSV)',
  defaultChecked: true,
} as const;
const EMPTY_TOPIC_IDS = new Set<number>();

/** Composes the React Flow topic graph, export dialog, result controls, and Topic lists. */
export function TopicModelingBubbleChartSection({
  topics,
  exportTopics = topics,
  selectedTopicIds,
  onToggleTopicSelection,
  onClearSelection,
  topicSearchQuery,
  onTopicSearchQueryChange,
  corpusSizes,
  panelNodeIds,
  nodeColors,
  defaultPalette,
  projectionKey,
  onViewReady,
  nodeNames,
  clusterCount,
  exportDisabled = false,
  randomSeed,
  topNTopics,
  controlRowSlot,
}: Props) {
  const corpusCount = corpusSizes.length;
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [lassoMode, setLassoMode] = useState(false);
  const [lassoFilter, setLassoFilter] = useState({
    projectionKey,
    topicIds: EMPTY_TOPIC_IDS,
  });
  const [listHover, setListHover] = useState({
    projectionKey,
    topicId: null as number | null,
  });
  const lassoTopicIds =
    lassoFilter.projectionKey === projectionKey ? lassoFilter.topicIds : EMPTY_TOPIC_IDS;
  const hoveredTopicId = listHover.projectionKey === projectionKey ? listHover.topicId : null;
  const bubbles = buildTopicBubbleModels({
    topics,
    corpusSizes,
    panelNodeIds,
    nodeColors,
    defaultPalette,
    selectedTopicIds,
    lassoTopicIds,
    hoveredTopicId,
    topicSearchQuery,
  });

  const corpusPresentation = { corpusCount, panelNodeIds, nodeColors, defaultPalette };

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
      { label: 'Top topics per document', value: topNTopics != null ? String(topNTopics) : '—' },
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
          className="overflow-hidden rounded-lg border border-surface-border-foreground/30 bg-editor"
          data-testid="topic-bubble-chart-shell"
          style={{ height: 'clamp(320px, 55cqw, 520px)' }}
        >
          <TopicModelingFlowChart
            bubbles={bubbles}
            corpusPresentation={corpusPresentation}
            projectionKey={projectionKey}
            lassoMode={lassoMode}
            lassoFilterActive={lassoTopicIds.size > 0}
            exportDisabled={exportDisabled}
            onToggleLassoMode={() => {
              setLassoMode((current) => !current);
              setListHover({ projectionKey, topicId: null });
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
            onClearLassoFilter={() => {
              setLassoFilter({ projectionKey, topicIds: EMPTY_TOPIC_IDS });
            }}
            onDownload={() => {
              setDownloadDialogOpen(true);
            }}
            onViewReady={onViewReady}
            onToggleTopicSelection={onToggleTopicSelection}
          />
        </div>
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
        corpusPresentation={corpusPresentation}
        hoveredTopicId={hoveredTopicId}
        onHoveredTopicChange={(topicId) => {
          setListHover({ projectionKey, topicId });
        }}
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
