import React from 'react';
import type { TopicModelingTopic } from '@/api';
import { getReadableTextColor, interpolateColor, type ZoomDomain } from '../topicModelingAdapters';
import { matchChecklistOption } from '@/features/views/common/checklistSearch';

interface BrushRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface TooltipState {
  x: number;
  y: number;
  topic: TopicModelingTopic | null;
}

interface Params {
  topics: TopicModelingTopic[];
  activeDomain: ZoomDomain | null;
  chartWidth: number;
  chartHeight: number;
  chartPadding: number;
  brushRect: BrushRect | null;
  chartSvgRef: React.RefObject<SVGSVGElement | null>;
  chartRef: React.RefObject<HTMLDivElement | null>;
  isBrushing: boolean;
  handleBrushStart: (event: React.MouseEvent<SVGSVGElement>) => void;
  handleBrushMove: (event: React.MouseEvent<SVGSVGElement>) => void;
  handleBrushEnd: () => void;
  hoveredTopicId: number | null;
  setHoveredTopicId: React.Dispatch<React.SetStateAction<number | null>>;
  setTooltip: React.Dispatch<React.SetStateAction<TooltipState>>;
  corpusCount: number;
  panelNodeIds: string[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  selectedTopicIds: Set<number>;
  onToggleTopicSelection: (id: number) => void;
  topicSearchQuery: string;
  handleResetZoom: () => void;
}

/**
 * Resolves the corpus colour for one bubble segment from persisted node colours or defaults.
 * Called by: renderSizeComposition for chips and the topic loop for bubble fills.
 */
const resolvePanelColor = (
  index: number,
  fallback: string,
  panelNodeIds: string[],
  nodeColors: Record<string, string>,
  defaultPalette: string[],
) => {
  const nodeId = panelNodeIds[index];
  if (nodeId) {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty color string should fall back to the next color source, so falsy '' must fall through
    return nodeColors[nodeId] || defaultPalette[index] || fallback;
  }
  return fallback;
};

const positionTooltip = (event: React.MouseEvent, bounds: DOMRect) => {
  const cursorX = event.clientX - bounds.left;
  const cursorY = event.clientY - bounds.top;
  const tooltipWidth = 288;
  const tooltipHeight = 240;
  const gap = 12;
  const edge = 8;
  return {
    x:
      cursorX + gap + tooltipWidth <= bounds.width - edge
        ? cursorX + gap
        : Math.max(edge, cursorX - tooltipWidth - gap),
    y:
      cursorY + gap + tooltipHeight <= bounds.height - edge
        ? cursorY + gap
        : Math.max(edge, cursorY - tooltipHeight - gap),
  };
};

/**
 * Builds topic bubble-chart SVG elements and the size-composition renderer.
 * Used by: TopicModelingFeature, which passes both results through TopicModelingResultsPanel.
 * Flow: scale topics into the active domain, render brush/selection/search
 * states into SVG, and expose corpus-size chips for the tooltip and topic list.
 */
export function useTopicModelingBubbleChart({
  topics,
  activeDomain,
  chartWidth,
  chartHeight,
  chartPadding,
  brushRect,
  chartSvgRef,
  chartRef,
  isBrushing,
  handleBrushStart,
  handleBrushMove,
  handleBrushEnd,
  hoveredTopicId,
  setHoveredTopicId,
  setTooltip,
  corpusCount,
  panelNodeIds,
  nodeColors,
  defaultPalette,
  selectedTopicIds,
  onToggleTopicSelection,
  topicSearchQuery,
  handleResetZoom,
}: Params) {
  const fallbackPrimaryColor = defaultPalette[0] ?? '#2563eb';
  const fallbackSecondaryColor = defaultPalette[1] ?? '#dc2626';

  /**
   * Renders per-corpus size chips using the same colours as the node palette.
   * Used by: the bubble tooltip and TopicSelectionPanel through TopicModelingBubbleChartSection.
   * Flow: handle missing or single-corpus sizes, resolve palette colors and readable text, then render colored corpus size chips with totals.
   */
  const renderSizeComposition = (sizes: number[] | undefined, total?: number | null) => {
    if (corpusCount === 0 || !sizes) return null;
    if (sizes.length === 1) {
      const color = resolvePanelColor(
        0,
        fallbackPrimaryColor,
        panelNodeIds,
        nodeColors,
        defaultPalette,
      );
      const fg = getReadableTextColor(color);
      return (
        <span className="inline-flex items-center gap-1">
          <span
            style={{ background: color, color: fg }}
            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
          >
            {sizes[0]}
          </span>
          <span className="text-[10px] text-gray-500">= {total}</span>
        </span>
      );
    }

    const colorA = resolvePanelColor(
      0,
      fallbackPrimaryColor,
      panelNodeIds,
      nodeColors,
      defaultPalette,
    );
    const colorB = resolvePanelColor(
      1,
      fallbackSecondaryColor,
      panelNodeIds,
      nodeColors,
      defaultPalette,
    );
    const fgA = getReadableTextColor(colorA);
    const fgB = getReadableTextColor(colorB);
    return (
      <span className="inline-flex items-center gap-1 flex-wrap">
        <span
          style={{ background: colorA, color: fgA }}
          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
        >
          {sizes[0]}
        </span>
        <span className="text-[10px] text-gray-500">+</span>
        <span
          style={{ background: colorB, color: fgB }}
          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
        >
          {sizes[1]}
        </span>
        <span className="text-[10px] text-gray-500">= {total}</span>
      </span>
    );
  };

  const bubbleElements = (() => {
    if (!topics.length || !activeDomain) return null;

    const width = chartWidth;
    const height = chartHeight;
    // Called for each topic to map its embedding x-coordinate into the SVG plot.
    const scaleX = (x: number) =>
      ((x - activeDomain.xMin) / (activeDomain.xMax - activeDomain.xMin || 1)) *
        (width - 2 * chartPadding) +
      chartPadding;
    // Called for each topic to map its embedding y-coordinate into the SVG plot.
    const scaleY = (y: number) =>
      ((y - activeDomain.yMin) / (activeDomain.yMax - activeDomain.yMin || 1)) *
        (height - 2 * chartPadding) +
      chartPadding;
    const maxSize = Math.max(...topics.map((topic) => topic.total_size));
    const hasSearchFilter = topicSearchQuery.trim().length > 0;

    const brushDisplay = brushRect
      ? {
          x: Math.min(brushRect.startX, brushRect.currentX),
          y: Math.min(brushRect.startY, brushRect.currentY),
          width: Math.abs(brushRect.currentX - brushRect.startX),
          height: Math.abs(brushRect.currentY - brushRect.startY),
        }
      : null;

    return (
      <svg
        ref={chartSvgRef}
        width={width}
        height={height}
        className="border rounded bg-white block w-full"
        role="img"
        aria-label="Topic bubble chart"
        style={{ cursor: isBrushing ? 'grabbing' : 'crosshair' }}
        onMouseDown={handleBrushStart}
        onMouseMove={handleBrushMove}
        onMouseUp={handleBrushEnd}
        onDoubleClick={(e) => {
          if (e.currentTarget === e.target) {
            handleResetZoom();
          }
        }}
        onMouseLeave={() => {
          if (isBrushing) {
            handleBrushEnd();
            return;
          }
          setHoveredTopicId(null);
          setTooltip((previous) => ({ ...previous, topic: null }));
        }}
      >
        {topics.map((topic) => {
          const sizes = topic.size;
          const proportion =
            corpusCount === 2 && topic.total_size > 0 ? (sizes[1] ?? 0) / topic.total_size : 0.5;
          const colorA = resolvePanelColor(
            0,
            fallbackPrimaryColor,
            panelNodeIds,
            nodeColors,
            defaultPalette,
          );
          const colorB = resolvePanelColor(
            1,
            fallbackSecondaryColor,
            panelNodeIds,
            nodeColors,
            defaultPalette,
          );
          const fill = corpusCount <= 1 ? colorA : interpolateColor(colorA, colorB, proportion);
          const radius = 10 + 40 * Math.sqrt(topic.total_size / (maxSize || 1));
          const cx = scaleX(topic.x);
          const cy = scaleY(topic.y);
          const isHovered = hoveredTopicId === topic.id;
          const isSelected = selectedTopicIds.has(topic.id);
          const isFilteredOut =
            hasSearchFilter &&
            !matchChecklistOption(
              topic.representative_words.map((term) => term.word).join(', '),
              topicSearchQuery,
            );
          const displayRadius = isHovered && !isFilteredOut ? radius + 2 : radius;

          return (
            <g
              key={topic.id}
              transform={`translate(${String(cx)},${String(cy)})`}
              opacity={isFilteredOut ? 0.18 : undefined}
              style={{ cursor: isFilteredOut ? 'default' : isBrushing ? 'grabbing' : 'pointer' }}
              onMouseEnter={(event) => {
                if (isBrushing || isFilteredOut) return;
                setHoveredTopicId(topic.id);
                const bounds = chartRef.current?.getBoundingClientRect();
                if (bounds) {
                  const position = positionTooltip(event, bounds);
                  setTooltip({
                    ...position,
                    topic,
                  });
                }
              }}
              onMouseMove={(event) => {
                if (isBrushing || isFilteredOut || !chartRef.current) return;
                const bounds = chartRef.current.getBoundingClientRect();
                const position = positionTooltip(event, bounds);
                setTooltip((previous) =>
                  previous.topic?.id === topic.id
                    ? {
                        ...position,
                        topic,
                      }
                    : previous,
                );
              }}
              onMouseLeave={() => {
                if (isBrushing || isFilteredOut) return;
                setHoveredTopicId(null);
                setTooltip((previous) => ({ ...previous, topic: null }));
              }}
              onClick={() => {
                if (isBrushing || isFilteredOut) return;
                onToggleTopicSelection(topic.id);
              }}
            >
              {isSelected && !isFilteredOut && (
                <circle
                  r={radius + 5}
                  fill="none"
                  stroke="#16a34a"
                  strokeWidth={2}
                  strokeOpacity={0.6}
                  className="pointer-events-none"
                />
              )}
              <circle
                r={displayRadius}
                fill={fill}
                fillOpacity={isHovered ? 0.88 : isSelected ? 0.78 : 0.6}
                stroke={isSelected ? '#16a34a' : isHovered ? '#3b82f6' : '#94a3b8'}
                strokeWidth={isSelected ? 2 : isHovered ? 2 : 1}
              />
              <text
                textAnchor="middle"
                dy={4}
                fontSize={12}
                className="pointer-events-none select-none"
                fill="#1e293b"
              >
                {`T${String(topic.id)}`}
              </text>
            </g>
          );
        })}

        {brushDisplay && (
          <rect
            x={brushDisplay.x}
            y={brushDisplay.y}
            width={brushDisplay.width}
            height={brushDisplay.height}
            fill="rgba(37, 99, 235, 0.12)"
            stroke="rgba(37, 99, 235, 0.8)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}
      </svg>
    );
  })();

  return {
    bubbleElements,
    renderSizeComposition,
  };
}
