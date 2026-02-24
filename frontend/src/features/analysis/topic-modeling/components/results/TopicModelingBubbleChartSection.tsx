import React from 'react';
import { Scan } from 'lucide-react';

type TopicLike = {
  id: number;
  label: string;
  size?: number[];
  total_size?: number | null;
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
}: Props) {
  return (
    <>
      <div className="relative w-full overflow-hidden rounded-lg border border-muted-foreground/30 bg-background" ref={chartRef}>
        <button
          type="button"
          className="react-flow__controls-button absolute top-2 right-2 z-20 border border-border bg-white/90"
          onClick={handleResetZoom}
          disabled={isAtGlobalZoom}
          title="Reset zoom to global view"
          aria-label="Reset zoom to global view"
          style={{ opacity: isAtGlobalZoom ? 0.5 : 1 }}
        >
          <Scan className="h-4 w-4" />
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

      <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
        {topics.slice(0, 10).map((topic) => {
          const isHovered = hoveredTopicId === topic.id;
          return (
            <div
              key={topic.id}
              className={`rounded-lg border border-border bg-muted/50 p-3 transition-shadow ${isHovered ? 'ring-2 ring-primary shadow-md' : ''}`}
              onMouseEnter={() => setHoveredTopicId(topic.id)}
              onMouseLeave={() => setHoveredTopicId(null)}
            >
              <div className="font-medium text-foreground">Topic {topic.id}</div>
              <div className="truncate text-xs text-muted-foreground" title={topic.label}>{topic.label}</div>
              <div className="mt-2">{renderSizeComposition(topic.size, topic.total_size)}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
