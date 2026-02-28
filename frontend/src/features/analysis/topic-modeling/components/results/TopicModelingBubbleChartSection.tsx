import React from 'react';
import { Scan } from 'lucide-react';
import { TopicSelectionPanel } from './TopicSelectionPanel';
import type { ZoomDomain } from '../../topicModelingAdapters';

type TopicLike = {
  id: number;
  label: string;
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
};

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
}: Props) {
  return (
    <>
      <div className="relative w-full overflow-hidden rounded-lg border border-muted-foreground/30 bg-background" ref={chartRef}>
        <button
          type="button"
          className="absolute top-2 right-2 z-20 flex items-center gap-1.5 rounded-md border border-border bg-white/95 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={handleResetZoom}
          disabled={isAtGlobalZoom}
          title="Reset zoom to global view (or double-click chart)"
          aria-label="Reset zoom to global view"
        >
          <Scan className="h-3.5 w-3.5" />
          Reset view
        </button>
        {bubbleElements}
        {tooltip.topic && (
          <div
            className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-border bg-card p-3 text-xs shadow-lg"
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
    </>
  );
}
