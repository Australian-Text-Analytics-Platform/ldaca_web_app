import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeZoomDomain, type ZoomDomain } from '../topicModelingAdapters';

type BrushRect = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type TopicPoint = {
  x: number;
  y: number;
};

type TooltipLike<TTopic> = {
  x: number;
  y: number;
  topic: TTopic | null;
  containerW: number;
  containerH: number;
};

type Params<TTopic extends TopicPoint> = {
  topics: TTopic[];
  chartWidth: number;
  chartHeight: number;
  chartPadding: number;
  setHoveredTopicId: (value: number | null) => void;
  setTooltip: React.Dispatch<React.SetStateAction<TooltipLike<TTopic>>>;
};

export function useTopicModelingZoomBrush<TTopic extends TopicPoint>({
  topics,
  chartWidth,
  chartHeight,
  chartPadding,
  setHoveredTopicId,
  setTooltip,
}: Params<TTopic>) {
  const [zoomDomain, setZoomDomain] = useState<ZoomDomain | null>(null);
  const [brushRect, setBrushRect] = useState<BrushRect | null>(null);
  const [isBrushing, setIsBrushing] = useState(false);

  const chartSvgRef = useRef<SVGSVGElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const fullDomain = useMemo<ZoomDomain | null>(() => computeZoomDomain(topics), [topics]);
  const activeDomain = zoomDomain ?? fullDomain;

  useEffect(() => {
    if (!fullDomain) {
      setZoomDomain(null);
      return;
    }
    setZoomDomain(fullDomain);
  }, [fullDomain]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, []);

  const animateDomainTo = useCallback((target: ZoomDomain) => {
    const start = activeDomain ?? target;
    if (animationFrameRef.current != null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const startAt = performance.now();
    const durationMs = 260;
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const step = (now: number) => {
      const raw = (now - startAt) / durationMs;
      const t = Math.max(0, Math.min(1, raw));
      const e = easeOutCubic(t);
      setZoomDomain({
        xMin: start.xMin + (target.xMin - start.xMin) * e,
        xMax: start.xMax + (target.xMax - start.xMax) * e,
        yMin: start.yMin + (target.yMin - start.yMin) * e,
        yMax: start.yMax + (target.yMax - start.yMax) * e,
      });
      if (t < 1) {
        animationFrameRef.current = requestAnimationFrame(step);
      } else {
        setZoomDomain(target);
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = requestAnimationFrame(step);
  }, [activeDomain]);

  const toSvgPoint = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    const svg = chartSvgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);

  const handleBrushStart = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
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
  }, [activeDomain, setHoveredTopicId, setTooltip, toSvgPoint]);

  const handleBrushMove = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    if (!isBrushing) return;
    const point = toSvgPoint(event);
    if (!point) return;
    setBrushRect((prev) => (prev ? { ...prev, currentX: point.x, currentY: point.y } : prev));
  }, [isBrushing, toSvgPoint]);

  const handleBrushEnd = useCallback(() => {
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
    const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

    const invX = (px: number) => {
      const t = clamp((px - chartPadding) / innerWidth, 0, 1);
      return activeDomain.xMin + t * (activeDomain.xMax - activeDomain.xMin);
    };

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
  }, [activeDomain, animateDomainTo, brushRect, chartHeight, chartPadding, chartWidth, isBrushing]);

  const handleResetZoom = useCallback(() => {
    if (!fullDomain) return;
    animateDomainTo(fullDomain);
  }, [animateDomainTo, fullDomain]);

  const isAtGlobalZoom = useMemo(() => {
    if (!fullDomain || !activeDomain) return true;
    const eps = 1e-6;
    return (
      Math.abs(activeDomain.xMin - fullDomain.xMin) < eps &&
      Math.abs(activeDomain.xMax - fullDomain.xMax) < eps &&
      Math.abs(activeDomain.yMin - fullDomain.yMin) < eps &&
      Math.abs(activeDomain.yMax - fullDomain.yMax) < eps
    );
  }, [activeDomain, fullDomain]);

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
