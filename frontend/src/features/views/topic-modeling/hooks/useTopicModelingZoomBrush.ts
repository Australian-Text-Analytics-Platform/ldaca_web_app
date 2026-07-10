import { useEffect, useRef, useState } from 'react';
import type { TopicModelingTopic } from '@/api';
import { computeZoomDomain, type ZoomDomain } from '../topicModelingAdapters';

interface BrushRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

type TopicPoint = Pick<TopicModelingTopic, 'x' | 'y'>;

interface ZoomState<TTopic extends TopicPoint> {
  topics: TTopic[];
  domain: ZoomDomain;
}

interface TooltipLike<TTopic> {
  x: number;
  y: number;
  topic: TTopic | null;
}

interface Params<TTopic extends TopicPoint> {
  topics: TTopic[];
  chartWidth: number;
  chartHeight: number;
  chartPadding: number;
  setHoveredTopicId: (value: number | null) => void;
  setTooltip: React.Dispatch<React.SetStateAction<TooltipLike<TTopic>>>;
}

/** Manages click-drag zoom brushing for the topic-modeling bubble chart. */
/**
 * Used by: TopicModelingFeature.tsx because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
 */
export function useTopicModelingZoomBrush<TTopic extends TopicPoint>({
  topics,
  chartWidth,
  chartHeight,
  chartPadding,
  setHoveredTopicId,
  setTooltip,
}: Params<TTopic>) {
  const [zoomState, setZoomState] = useState<ZoomState<TTopic> | null>(null);
  const [brushRect, setBrushRect] = useState<BrushRect | null>(null);
  const [isBrushing, setIsBrushing] = useState(false);

  const chartSvgRef = useRef<SVGSVGElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const fullDomain = computeZoomDomain(topics);
  const activeZoomDomain = zoomState?.topics === topics ? zoomState.domain : null;
  const activeDomain = activeZoomDomain ?? fullDomain;

  useEffect(() => {
    return () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, []);

  // Animates the chart domain so zoom and reset transitions remain spatially legible.
  /**
   * Called by: useTopicModelingZoomBrush during this analysis workflow because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
   * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
   */
  const animateDomainTo = (target: ZoomDomain) => {
    const animationTopics = topics;
    const start = activeDomain ?? target;
    if (animationFrameRef.current != null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const startAt = performance.now();
    const durationMs = 260;
    // Eases domain interpolation so zoom transitions decelerate near the target.
    /**
     * Called by: animateDomainTo during this analysis workflow because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
     */
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    // Advances one animation frame of the zoom-domain interpolation.
    /**
     * Called by: animateDomainTo during this analysis workflow because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
     * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
     */
    const step = (now: number) => {
      const raw = (now - startAt) / durationMs;
      const t = Math.max(0, Math.min(1, raw));
      const e = easeOutCubic(t);
      setZoomState({
        topics: animationTopics,
        domain: {
          xMin: start.xMin + (target.xMin - start.xMin) * e,
          xMax: start.xMax + (target.xMax - start.xMax) * e,
          yMin: start.yMin + (target.yMin - start.yMin) * e,
          yMax: start.yMax + (target.yMax - start.yMax) * e,
        },
      });
      if (t < 1) {
        animationFrameRef.current = requestAnimationFrame(step);
      } else {
        setZoomState({ topics: animationTopics, domain: target });
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = requestAnimationFrame(step);
  };

  // Converts mouse coordinates into SVG-local coordinates for brush geometry.
  /**
   * Called by: useTopicModelingZoomBrush during this analysis workflow because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
   */
  const toSvgPoint = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = chartSvgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  // Starts a brush selection and suppresses hover state while the drag is active.
  /**
   * Called by: useTopicModelingZoomBrush through JSX event props or task lifecycle callbacks because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
   */
  const handleBrushStart = (event: React.MouseEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !activeDomain) return;
    const point = toSvgPoint(event);
    if (!point) return;

    setIsBrushing(true);
    setTooltip((prev) => ({ ...prev, topic: null }));
    setHoveredTopicId(null);
    setBrushRect({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    });
  };

  // Updates the live brush rectangle as the pointer moves.
  /**
   * Called by: useTopicModelingZoomBrush through JSX event props or task lifecycle callbacks because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
   */
  const handleBrushMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!isBrushing) return;
    const point = toSvgPoint(event);
    if (!point) return;
    setBrushRect((prev) => (prev ? { ...prev, currentX: point.x, currentY: point.y } : prev));
  };

  // Converts the finished brush rectangle back into topic-coordinate zoom bounds.
  /**
   * Called by: useTopicModelingZoomBrush through JSX event props or task lifecycle callbacks because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
   * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
   */
  const handleBrushEnd = () => {
    if (!isBrushing || !brushRect || !activeDomain) {
      setIsBrushing(false);
      setBrushRect(null);
      return;
    }

    const x0 = Math.min(brushRect.startX, brushRect.currentX);
    const x1 = Math.max(brushRect.startX, brushRect.currentX);
    const y0 = Math.min(brushRect.startY, brushRect.currentY);
    const y1 = Math.max(brushRect.startY, brushRect.currentY);

    setIsBrushing(false);
    setBrushRect(null);

    if (x1 - x0 < 8 || y1 - y0 < 8) {
      return;
    }

    const innerWidth = Math.max(1, chartWidth - 2 * chartPadding);
    const innerHeight = Math.max(1, chartHeight - 2 * chartPadding);
    // Keeps inverted brush coordinates within the drawable chart bounds.
    /**
     * Called by: handleBrushEnd as a local helper in this analysis workflow because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
     */
    const clamp = (value: number, low: number, high: number) =>
      Math.min(high, Math.max(low, value));

    // Converts an SVG x-coordinate back into topic-domain coordinates.
    /**
     * Called by: handleBrushEnd during this analysis workflow because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
     */
    const invX = (px: number) => {
      const t = clamp((px - chartPadding) / innerWidth, 0, 1);
      return activeDomain.xMin + t * (activeDomain.xMax - activeDomain.xMin);
    };

    // Converts an SVG y-coordinate back into topic-domain coordinates.
    /**
     * Called by: handleBrushEnd during this analysis workflow because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
     */
    const invY = (py: number) => {
      const t = clamp((py - chartPadding) / innerHeight, 0, 1);
      return activeDomain.yMin + t * (activeDomain.yMax - activeDomain.yMin);
    };

    const nx0 = invX(x0);
    const nx1 = invX(x1);
    const ny0 = invY(y0);
    const ny1 = invY(y1);
    const epsilon = 1e-6;

    animateDomainTo({
      xMin: Math.min(nx0, nx1),
      xMax: Math.max(nx0, nx1) + epsilon,
      yMin: Math.min(ny0, ny1),
      yMax: Math.max(ny0, ny1) + epsilon,
    });
  };

  // Restores the chart to the full domain covering all fitted topics.
  /**
   * Called by: useTopicModelingZoomBrush through JSX event props or task lifecycle callbacks because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
   */
  const handleResetZoom = () => {
    if (!fullDomain) return;
    animateDomainTo(fullDomain);
  };

  const isAtGlobalZoom = (() => {
    if (!fullDomain || !activeDomain) return true;
    const eps = 1e-6;
    return (
      Math.abs(activeDomain.xMin - fullDomain.xMin) < eps &&
      Math.abs(activeDomain.xMax - fullDomain.xMax) < eps &&
      Math.abs(activeDomain.yMin - fullDomain.yMin) < eps &&
      Math.abs(activeDomain.yMax - fullDomain.yMax) < eps
    );
  })();

  return {
    activeDomain,
    brushRect,
    chartSvgRef,
    isBrushing,
    handleBrushStart,
    handleBrushMove,
    handleBrushEnd,
    handleResetZoom,
    isAtGlobalZoom,
  };
}
