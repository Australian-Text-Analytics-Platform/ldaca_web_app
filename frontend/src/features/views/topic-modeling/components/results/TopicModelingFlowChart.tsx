import '@xyflow/react/dist/style.css';

import {
  ControlButton,
  Controls,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Viewport,
} from '@xyflow/react';
import { Download, FilterX, LassoSelect, Minus, Plus, Scan } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { NodeTooltip, NodeTooltipContent, NodeTooltipTrigger } from '@/components/node-tooltip';
import { ResponsiveWordCloud } from '@/features/views/common/components/ResponsiveWordCloud';
import { cn } from '@/lib/utils';
import { type TopicCorpusPresentation, TopicSizeComposition } from './TopicSizeComposition';
import {
  findTopicIdsInsideLasso,
  TOPIC_GRAPH_HEIGHT,
  TOPIC_GRAPH_WIDTH,
  type TopicBubbleModel,
  type TopicGraphPoint,
} from './topicModelingGraph';

interface TopicBubbleNodeData extends Record<string, unknown> {
  bubble: TopicBubbleModel;
  corpusPresentation: TopicCorpusPresentation;
}

export type TopicFlowNode = Node<TopicBubbleNodeData, 'topic'>;

interface Props {
  bubbles: TopicBubbleModel[];
  corpusPresentation: TopicCorpusPresentation;
  projectionKey: string;
  lassoMode: boolean;
  lassoFilterActive: boolean;
  exportDisabled: boolean;
  onToggleLassoMode: () => void;
  onClearLassoFilter: () => void;
  onAddLassoTopics: (topicIds: Set<number>) => void;
  onDownload: () => void;
  onViewReady: (projectionKey: string) => void;
  onToggleTopicSelection: (topicId: number) => void;
}

const NODE_ORIGIN: [number, number] = [0.5, 0.5];
const EMPTY_EDGES: [] = [];
const FIT_VIEW_OPTIONS = {
  padding: { top: '24px', right: '150px', bottom: '24px', left: '24px' },
  minZoom: 0.05,
  maxZoom: 1.5,
  duration: 0,
} as const;

interface TopicGraphControlButtonProps {
  accessibleLabel: string;
  label: string;
  children: ReactNode;
  disabled?: boolean;
  pressed?: boolean;
  active?: boolean;
  onClick: () => void;
}

function TopicGraphControlButton({
  accessibleLabel,
  label,
  children,
  disabled,
  pressed,
  active,
  onClick,
}: TopicGraphControlButtonProps) {
  return (
    <ControlButton
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={accessibleLabel}
      aria-pressed={pressed}
      className={cn(
        '!h-10 !w-10 !min-w-10 !justify-start !gap-3 !overflow-hidden !px-3',
        'transition-[width,background-color,color] duration-150 ease-out',
        'group-hover/topic-controls:!w-40 group-focus-within/topic-controls:!w-40',
        'disabled:!bg-editor disabled:!text-[var(--vscode-icon-foreground)] disabled:!opacity-40',
        active && '!bg-list-active !text-[var(--vscode-list-activeSelectionForeground)]',
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:!size-4 [&_svg]:!max-h-none [&_svg]:!max-w-none [&_svg]:!fill-none">
        {children}
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none whitespace-nowrap text-label-secondary font-medium opacity-0 transition-opacity duration-100 group-hover/topic-controls:opacity-100 group-focus-within/topic-controls:opacity-100"
      >
        {label}
      </span>
    </ControlButton>
  );
}

/** Renders one measured React Flow node using the shared Topic bubble model. */
function TopicBubbleNode({ data }: NodeProps<TopicFlowNode>) {
  const { bubble, corpusPresentation } = data;
  const outerRadius = bubble.radius + 7;
  const diameter = outerRadius * 2;
  const tooltipPosition =
    bubble.position.x <= TOPIC_GRAPH_WIDTH / 2 ? Position.Right : Position.Left;
  return (
    <NodeTooltip className="size-full">
      <NodeTooltipTrigger
        data-testid={`topic-flow-node-${String(bubble.id)}`}
        data-topic-id={bubble.id}
        className={cn(
          'group relative size-full',
          bubble.filteredOut && 'pointer-events-none opacity-[0.18]',
        )}
        aria-hidden="true"
      >
        <svg width={diameter} height={diameter} className="block overflow-visible">
          {bubble.lassoed ? (
            <circle
              cx={outerRadius}
              cy={outerRadius}
              r={bubble.radius + 6}
              fill="none"
              stroke="#7c3aed"
              strokeWidth={2.5}
              strokeDasharray="5 3"
              data-testid={`topic-lasso-ring-${String(bubble.id)}`}
            />
          ) : null}
          {bubble.selected ? (
            <circle
              cx={outerRadius}
              cy={outerRadius}
              r={bubble.radius + 4}
              fill="none"
              stroke="#16a34a"
              strokeWidth={2}
              strokeOpacity={0.7}
            />
          ) : null}
          <circle
            cx={outerRadius}
            cy={outerRadius}
            r={bubble.hovered && !bubble.filteredOut ? bubble.radius + 2 : bubble.radius}
            fill={bubble.fill}
            fillOpacity={bubble.hovered ? 0.88 : bubble.selected ? 0.78 : 0.6}
            stroke={bubble.selected ? '#16a34a' : bubble.hovered ? '#3b82f6' : '#94a3b8'}
            strokeWidth={bubble.selected || bubble.hovered ? 2 : 1}
            className={cn(
              'transition-[fill-opacity,stroke,stroke-width] duration-100',
              !bubble.filteredOut &&
                'group-hover:fill-opacity-[0.88] group-hover:stroke-focus group-hover:[stroke-width:2]',
            )}
          />
          <text
            x={outerRadius}
            y={outerRadius + 4}
            textAnchor="middle"
            fontSize={12}
            fill="#1e293b"
            className="pointer-events-none select-none"
          >
            {`T${String(bubble.id)}`}
          </text>
        </svg>
      </NodeTooltipTrigger>
      <NodeTooltipContent
        align={
          bubble.position.y < TOPIC_GRAPH_HEIGHT / 3
            ? 'start'
            : bubble.position.y > (TOPIC_GRAPH_HEIGHT * 2) / 3
              ? 'end'
              : 'center'
        }
        position={tooltipPosition}
        offset={12}
        role="tooltip"
        tabIndex={-1}
        data-testid={`topic-flow-tooltip-${String(bubble.id)}`}
        className="pointer-events-none w-[min(18rem,calc(100%-1rem))] rounded-md border border-surface-border bg-surface p-3 text-label-secondary text-surface-foreground"
      >
        <div className="text-body font-semibold">Topic {bubble.topic.id}</div>
        <div className="mt-1 max-h-36 overflow-hidden text-description">
          <ResponsiveWordCloud
            words={bubble.topic.representative_words.map((term) => ({
              text: term.word,
              value: term.occurrence_count,
            }))}
            minWidth={180}
            aspectRatio={0.48}
          />
        </div>
        <span className="sr-only">
          {bubble.topic.representative_words
            .map((term) => `${term.word}, ${String(term.occurrence_count)} occurrences`)
            .join('; ')}
        </span>
        <div className="mt-2">
          <TopicSizeComposition
            sizes={bubble.topic.size}
            total={bubble.topic.total_size}
            {...corpusPresentation}
          />
        </div>
      </NodeTooltipContent>
    </NodeTooltip>
  );
}

const TOPIC_NODE_TYPES = {
  topic: TopicBubbleNode,
} satisfies NodeTypes;

function drawLassoPath(canvas: HTMLCanvasElement, points: TopicGraphPoint[]) {
  const bounds = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (points.length === 0) return;
  const first = points[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  if (points.length >= 3) {
    context.closePath();
    context.fillStyle = 'rgba(124, 58, 237, 0.12)';
    context.fill();
  }
  context.strokeStyle = 'rgba(124, 58, 237, 0.9)';
  context.lineWidth = 2;
  context.setLineDash([6, 4]);
  context.stroke();
}

/** Owns the pointer transaction for the official canvas-style freehand lasso. */
export function TopicLassoCanvas({
  enabled,
  bubbles,
  onComplete,
}: {
  enabled: boolean;
  bubbles: TopicBubbleModel[];
  onComplete: (topicIds: Set<number>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const pathRef = useRef<TopicGraphPoint[]>([]);
  const { getViewport } = useReactFlow<TopicFlowNode>();

  useEffect(() => {
    const pointFromEvent = (event: PointerEvent): TopicGraphPoint | null => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds) return null;
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const cancelGesture = () => {
      activePointerRef.current = null;
      pathRef.current = [];
      if (canvasRef.current) drawLassoPath(canvasRef.current, []);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (activePointerRef.current !== event.pointerId) return;
      const point = pointFromEvent(event);
      if (!point || !canvasRef.current) return;
      pathRef.current.push(point);
      drawLassoPath(canvasRef.current, pathRef.current);
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (activePointerRef.current !== event.pointerId) return;
      const point = pointFromEvent(event);
      if (point) pathRef.current.push(point);
      const polygon = pathRef.current;
      activePointerRef.current = null;
      pathRef.current = [];
      if (canvasRef.current) drawLassoPath(canvasRef.current, []);
      if (polygon.length < 3) return;
      const matches = findTopicIdsInsideLasso(bubbles, polygon, getViewport());
      if (matches.size > 0) onComplete(matches);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      if (activePointerRef.current === event.pointerId) cancelGesture();
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', cancelGesture);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', cancelGesture);
      cancelGesture();
    };
  }, [bubbles, getViewport, onComplete]);

  if (!enabled) return null;
  return (
    <canvas
      ref={canvasRef}
      data-testid="topic-lasso-canvas"
      className="absolute inset-0 z-10 size-full cursor-crosshair touch-none"
      aria-label="Draw an additive lasso around topic bubbles"
      onPointerDown={(event) => {
        if (event.button !== 0 || activePointerRef.current !== null) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        activePointerRef.current = event.pointerId;
        pathRef.current = [{ x: event.clientX - bounds.left, y: event.clientY - bounds.top }];
        drawLassoPath(event.currentTarget, pathRef.current);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Window listeners remain authoritative when capture is unavailable.
        }
      }}
      onLostPointerCapture={(event) => {
        if (activePointerRef.current !== event.pointerId) return;
        activePointerRef.current = null;
        pathRef.current = [];
        drawLassoPath(event.currentTarget, []);
      }}
      onWheel={(event) => {
        if (activePointerRef.current !== null) event.preventDefault();
      }}
    />
  );
}

function TopicExportSvg({
  bubbles,
  viewport,
  width,
  height,
}: {
  bubbles: TopicBubbleModel[];
  viewport: Viewport;
  width: number;
  height: number;
}) {
  return (
    <svg
      data-topic-modeling-export="true"
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <rect width={width} height={height} fill="#ffffff" />
      <g
        transform={`translate(${String(viewport.x)} ${String(viewport.y)}) scale(${String(viewport.zoom)})`}
      >
        {bubbles.map((bubble) => (
          <g
            key={bubble.id}
            transform={`translate(${String(bubble.position.x)} ${String(bubble.position.y)})`}
            opacity={bubble.filteredOut ? 0.18 : undefined}
          >
            {bubble.lassoed ? (
              <circle
                r={bubble.radius + 6}
                fill="none"
                stroke="#7c3aed"
                strokeWidth={2.5}
                strokeDasharray="5 3"
              />
            ) : null}
            {bubble.selected ? (
              <circle
                r={bubble.radius + 4}
                fill="none"
                stroke="#16a34a"
                strokeWidth={2}
                strokeOpacity={0.7}
              />
            ) : null}
            <circle
              r={bubble.radius}
              fill={bubble.fill}
              fillOpacity={bubble.selected ? 0.78 : 0.6}
              stroke={bubble.selected ? '#16a34a' : '#94a3b8'}
              strokeWidth={bubble.selected ? 2 : 1}
            />
            <text textAnchor="middle" dy={4} fontSize={12} fill="#1e293b">
              {`T${String(bubble.id)}`}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

/** Renders the interactive React Flow topic plane and its native control toolbar. */
function TopicModelingFlowChartInner({
  bubbles,
  corpusPresentation,
  projectionKey,
  lassoMode,
  lassoFilterActive,
  exportDisabled,
  onToggleLassoMode,
  onClearLassoFilter,
  onAddLassoTopics,
  onDownload,
  onViewReady,
  onToggleTopicSelection,
}: Props) {
  const flowRef = useRef<HTMLDivElement | null>(null);
  const fittedViewportRef = useRef(true);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [paneSize, setPaneSize] = useState({ width: 1, height: 1 });
  const { fitView, getViewport, zoomIn, zoomOut } = useReactFlow<TopicFlowNode>();
  const nodes: TopicFlowNode[] = bubbles.map((bubble) => {
    const diameter = (bubble.radius + 7) * 2;
    return {
      id: `topic-${String(bubble.id)}`,
      type: 'topic',
      position: bubble.position,
      data: { bubble, corpusPresentation },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: bubble.selected ? 3 : bubble.lassoed ? 2 : 1,
      style: { width: diameter, height: diameter },
    };
  });

  useEffect(() => {
    if (nodes.length === 0) {
      onViewReady(projectionKey);
      return;
    }
    let cancelled = false;
    let frame: number | null = null;
    fittedViewportRef.current = true;
    const fitCommittedNodes = (attemptsRemaining: number) => {
      frame = requestAnimationFrame(() => {
        frame = null;
        void fitView(FIT_VIEW_OPTIONS).then((didFit) => {
          if (cancelled) return;
          if (!didFit) {
            if (attemptsRemaining > 0) fitCommittedNodes(attemptsRemaining - 1);
            return;
          }
          setViewport(getViewport());
          onViewReady(projectionKey);
        });
      });
    };
    fitCommittedNodes(8);
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [fitView, getViewport, nodes.length, onViewReady, projectionKey]);

  useEffect(() => {
    const element = flowRef.current;
    if (!element) return;
    let frame: number | null = null;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      setPaneSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
      if (!fittedViewportRef.current || nodes.length === 0) return;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        void fitView(FIT_VIEW_OPTIONS).then(() => {
          setViewport(getViewport());
        });
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [fitView, getViewport, nodes.length]);

  return (
    <div ref={flowRef} className="relative size-full">
      <ReactFlow<TopicFlowNode>
        nodes={nodes}
        edges={EMPTY_EDGES}
        nodeTypes={TOPIC_NODE_TYPES}
        nodeOrigin={NODE_ORIGIN}
        minZoom={0.05}
        maxZoom={4}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        panOnDrag={!lassoMode}
        panOnScroll={false}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick
        preventScrolling
        onNodeClick={(_event, node) => {
          if (!lassoMode && !node.data.bubble.filteredOut) {
            onToggleTopicSelection(node.data.bubble.id);
          }
        }}
        onMoveStart={(event) => {
          if (event) fittedViewportRef.current = false;
        }}
        onMoveEnd={(_event, nextViewport) => {
          setViewport(nextViewport);
        }}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        attributionPosition="bottom-left"
        className="bg-surface"
      >
        <Controls
          orientation="vertical"
          position="top-left"
          showZoom={false}
          showFitView={false}
          showInteractive={false}
          className="group/topic-controls overflow-hidden rounded-md border border-surface-border bg-editor"
          style={{ zIndex: 20 }}
          aria-label="Topic graph controls"
        >
          <TopicGraphControlButton
            accessibleLabel="Zoom in"
            label="Zoom in"
            onClick={() => {
              fittedViewportRef.current = false;
              void zoomIn();
            }}
          >
            <Plus aria-hidden="true" />
          </TopicGraphControlButton>
          <TopicGraphControlButton
            accessibleLabel="Zoom out"
            label="Zoom out"
            onClick={() => {
              fittedViewportRef.current = false;
              void zoomOut();
            }}
          >
            <Minus aria-hidden="true" />
          </TopicGraphControlButton>
          <TopicGraphControlButton
            accessibleLabel="Fit view"
            label="Fit view"
            onClick={() => {
              fittedViewportRef.current = true;
              void fitView(FIT_VIEW_OPTIONS).then(() => {
                setViewport(getViewport());
              });
            }}
          >
            <Scan aria-hidden="true" />
          </TopicGraphControlButton>
          <TopicGraphControlButton
            accessibleLabel={lassoMode ? 'Disable additive lasso' : 'Enable additive lasso'}
            label="Select topics"
            pressed={lassoMode}
            active={lassoMode}
            onClick={onToggleLassoMode}
          >
            <LassoSelect aria-hidden="true" />
          </TopicGraphControlButton>
          <TopicGraphControlButton
            accessibleLabel="Clear lasso filter"
            label="Clear filter"
            disabled={!lassoFilterActive}
            onClick={onClearLassoFilter}
          >
            <FilterX aria-hidden="true" />
          </TopicGraphControlButton>
          <TopicGraphControlButton
            accessibleLabel="Download chart"
            label="Download chart"
            disabled={exportDisabled}
            onClick={onDownload}
          >
            <Download aria-hidden="true" />
          </TopicGraphControlButton>
        </Controls>
        <TopicLassoCanvas enabled={lassoMode} bubbles={bubbles} onComplete={onAddLassoTopics} />
      </ReactFlow>
      <TopicExportSvg
        bubbles={bubbles}
        viewport={viewport}
        width={paneSize.width}
        height={paneSize.height}
      />
    </div>
  );
}

export function TopicModelingFlowChart(props: Props) {
  return (
    <ReactFlowProvider>
      <TopicModelingFlowChartInner {...props} />
    </ReactFlowProvider>
  );
}
