import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MousePointer2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { BarChart, LineChart } from 'echarts/charts';
import {
  AriaComponent,
  BrushComponent,
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import {
  init,
  use as registerEChartsModules,
  type EChartsCoreOption,
  type EChartsType,
} from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

import { Button } from '@/components/ui/button';

registerEChartsModules([
  LineChart,
  BarChart,
  AriaComponent,
  BrushComponent,
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
  SVGRenderer,
]);

interface EChartsZoomRange {
  start: number;
  end: number;
}

interface EChartsShowTipEvent {
  dataIndex?: number;
}

interface EChartsPointerEvent {
  offsetX?: number;
  offsetY?: number;
  event?: { shiftKey?: boolean };
}

interface EChartsBrushSelectedEvent {
  batch?: {
    selected?: { dataIndex?: number[] }[];
  }[];
}

interface EChartsDataZoomEvent {
  start?: number;
  end?: number;
  batch?: { start?: number; end?: number }[];
}

interface EChartsViewProps {
  option: EChartsCoreOption;
  height: number;
  pointCount: number;
  dataResetKey: string;
  ariaLabel: string;
  selectedIndices?: ReadonlySet<number>;
  onSelect?: (index: number, shiftHeld: boolean) => void;
  onSelectRange?: (startIndex: number, endIndex: number, shiftHeld: boolean) => void;
  getPointSummary?: (index: number) => string;
  className?: string;
  testId?: string;
  toolbarStart?: ReactNode;
}

const FULL_ZOOM: EChartsZoomRange = { start: 0, end: 100 };
const MIN_ZOOM_SPAN = 5;

const clampZoomRange = (start: number, end: number): EChartsZoomRange => {
  const safeStart = Math.max(0, Math.min(100, start));
  const safeEnd = Math.max(safeStart, Math.min(100, end));
  return { start: safeStart, end: safeEnd };
};

const zoomAroundCenter = (current: EChartsZoomRange, factor: number): EChartsZoomRange => {
  const center = (current.start + current.end) / 2;
  const width = Math.max(MIN_ZOOM_SPAN, Math.min(100, (current.end - current.start) * factor));
  let start = center - width / 2;
  let end = center + width / 2;
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > 100) {
    start -= end - 100;
    end = 100;
  }
  return clampZoomRange(start, end);
};

const zoomFromEvent = (event: EChartsDataZoomEvent): EChartsZoomRange | null => {
  const payload = event.batch?.[0] ?? event;
  if (typeof payload.start !== 'number' || typeof payload.end !== 'number') return null;
  return clampZoomRange(payload.start, payload.end);
};

/**
 * Owns the imperative ECharts lifecycle for analysis charts.
 *
 * The callback refs are intentionally stable: ECharts subscriptions are an
 * identity-sensitive external-library boundary and must not be recreated on
 * every React render.
 */
function EChartsInstance({
  option,
  height,
  pointCount,
  ariaLabel,
  selectedIndices,
  onSelect,
  onSelectRange,
  getPointSummary,
  className,
  testId,
  toolbarStart,
}: EChartsViewProps) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const selectRef = useRef(onSelect);
  const selectRangeRef = useRef(onSelectRange);
  const summaryRef = useRef(getPointSummary);
  const selectionModeRef = useRef<'point' | 'range'>('point');
  const shiftHeldRef = useRef(false);
  const nearestPointIndexRef = useRef<number | null>(null);
  const suppressBrushEventRef = useRef(false);
  const zoomRangeRef = useRef<EChartsZoomRange>(FULL_ZOOM);
  const [selectionMode, setSelectionMode] = useState<'point' | 'range'>('point');
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomRange, setZoomRange] = useState<EChartsZoomRange>(FULL_ZOOM);
  const [liveText, setLiveText] = useState('');
  const rangeSelectionEnabled = onSelectRange !== undefined;

  useEffect(() => {
    selectRef.current = onSelect;
    selectRangeRef.current = onSelectRange;
    summaryRef.current = getPointSummary;
    selectionModeRef.current = selectionMode;
  }, [getPointSummary, onSelect, onSelectRange, selectionMode]);

  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;

    const chart = init(element, undefined, { renderer: 'svg' });
    chartRef.current = chart;

    const handleShowTip = (event: EChartsShowTipEvent) => {
      if (typeof event.dataIndex === 'number') nearestPointIndexRef.current = event.dataIndex;
    };
    const handlePlotClick = (event: EChartsPointerEvent) => {
      if (selectionModeRef.current !== 'point' || !selectRef.current) return;
      if (typeof event.offsetX !== 'number' || typeof event.offsetY !== 'number') return;
      const pixel: [number, number] = [event.offsetX, event.offsetY];
      if (!chart.containPixel({ gridIndex: 0 }, pixel)) return;

      // Let ECharts snap the axis pointer to the nearest complete-dataset row.
      // Its synchronous showTip event supplies the correct dataIndex for both
      // categorical and continuous axes, including while dataZoom is active.
      chart.dispatchAction({ type: 'updateAxisPointer', x: pixel[0], y: pixel[1] });
      const index = nearestPointIndexRef.current;
      if (index == null) return;
      setActiveIndex(index);
      setLiveText(summaryRef.current?.(index) ?? `Point ${String(index + 1)}`);
      selectRef.current(index, !!event.event?.shiftKey);
    };
    const handleBrushSelected = (event: EChartsBrushSelectedEvent) => {
      if (suppressBrushEventRef.current || selectionModeRef.current !== 'range') return;
      const selected = new Set<number>();
      for (const batch of event.batch ?? []) {
        for (const series of batch.selected ?? []) {
          for (const index of series.dataIndex ?? []) selected.add(index);
        }
      }
      if (selected.size === 0) return;
      const indices = Array.from(selected).sort((left, right) => left - right);
      const first = indices[0];
      const last = indices.at(-1);
      if (first == null || last == null) return;
      selectRangeRef.current?.(first, last, shiftHeldRef.current);
      setActiveIndex(last);
      setLiveText(`Selected points ${String(first + 1)} through ${String(last + 1)}`);
      suppressBrushEventRef.current = true;
      chart.dispatchAction({ type: 'brush', areas: [] });
      suppressBrushEventRef.current = false;
    };
    const handleDataZoom = (event: EChartsDataZoomEvent) => {
      const next = zoomFromEvent(event);
      if (next) {
        zoomRangeRef.current = next;
        setZoomRange(next);
      }
    };
    const handlePointerDown = (event: { event?: { shiftKey?: boolean } }) => {
      shiftHeldRef.current = !!event.event?.shiftKey;
    };

    chart.on('showtip', handleShowTip as never);
    chart.on('brushselected', handleBrushSelected as never);
    chart.on('datazoom', handleDataZoom as never);
    chart.getZr().on('mousedown', handlePointerDown);
    chart.getZr().on('click', handlePlotClick);

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
      chart.off('showtip', handleShowTip);
      chart.off('brushselected', handleBrushSelected);
      chart.off('datazoom', handleDataZoom);
      chart.getZr().off('mousedown', handlePointerDown);
      chart.getZr().off('click', handlePlotClick);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const currentZoom = zoomRangeRef.current;
    chart.setOption(
      {
        ...option,
        aria: {
          enabled: true,
          decal: { show: true },
          description: ariaLabel,
        },
        dataZoom: [
          {
            id: 'wordflow-inside-zoom',
            type: 'inside',
            xAxisIndex: 0,
            start: currentZoom.start,
            end: currentZoom.end,
            filterMode: 'none',
            zoomOnMouseWheel: true,
            moveOnMouseMove: false,
            moveOnMouseWheel: false,
          },
          {
            id: 'wordflow-slider-zoom',
            type: 'slider',
            xAxisIndex: 0,
            start: currentZoom.start,
            end: currentZoom.end,
            filterMode: 'none',
            bottom: 4,
            height: 18,
            showDetail: false,
            brushSelect: false,
          },
        ],
        toolbox: { show: false },
        brush: rangeSelectionEnabled
          ? {
              id: 'wordflow-range-brush',
              xAxisIndex: 0,
              brushType: 'lineX',
              brushMode: 'single',
              throttleType: 'debounce',
              throttleDelay: 80,
            }
          : undefined,
      },
      { notMerge: true, lazyUpdate: false },
    );
  }, [ariaLabel, option, rangeSelectionEnabled]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.dispatchAction({
      type: 'takeGlobalCursor',
      key: 'brush',
      brushOption: {
        brushType: selectionMode === 'range' && rangeSelectionEnabled ? 'lineX' : false,
      },
    });
  }, [rangeSelectionEnabled, selectionMode]);

  const moveActivePoint = (nextIndex: number) => {
    if (pointCount <= 0) return;
    const bounded = Math.max(0, Math.min(pointCount - 1, nextIndex));
    setActiveIndex(bounded);
    setLiveText(summaryRef.current?.(bounded) ?? `Point ${String(bounded + 1)}`);
    chartRef.current?.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: bounded });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveActivePoint(activeIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveActivePoint(activeIndex + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveActivePoint(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveActivePoint(pointCount - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (pointCount > 0) selectRef.current?.(activeIndex, event.shiftKey);
    } else if (event.key === 'Escape') {
      setSelectionMode('point');
      chartRef.current?.dispatchAction({ type: 'hideTip' });
    }
  };

  const setZoom = (next: EChartsZoomRange, announcement: string) => {
    zoomRangeRef.current = next;
    setZoomRange(next);
    setLiveText(announcement);
    chartRef.current?.dispatchAction({
      type: 'dataZoom',
      dataZoomId: 'wordflow-inside-zoom',
      start: next.start,
      end: next.end,
    });
  };

  const isFullZoom = zoomRange.start === 0 && zoomRange.end === 100;

  return (
    <div className={className} data-testid={testId}>
      <div
        className="mb-2 flex flex-nowrap items-center justify-end gap-2 overflow-x-auto pb-1"
        aria-label="Chart controls"
      >
        {toolbarStart}
        {onSelectRange ? (
          <Button
            type="button"
            variant={selectionMode === 'range' ? 'default' : 'outline'}
            size="sm"
            aria-pressed={selectionMode === 'range'}
            onClick={() => {
              setSelectionMode((current) => (current === 'range' ? 'point' : 'range'));
            }}
          >
            <MousePointer2 className="h-4 w-4" aria-hidden="true" />
            Select range
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-control-sm"
          aria-label="Zoom in"
          onClick={() => {
            setZoom(zoomAroundCenter(zoomRange, 0.75), 'Chart zoomed in');
          }}
        >
          <ZoomIn className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-control-sm"
          aria-label="Zoom out"
          disabled={isFullZoom}
          onClick={() => {
            setZoom(zoomAroundCenter(zoomRange, 4 / 3), 'Chart zoomed out');
          }}
        >
          <ZoomOut className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-control-sm"
          aria-label="Reset zoom"
          disabled={isFullZoom}
          onClick={() => {
            setZoom(FULL_ZOOM, 'Chart zoom reset');
          }}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div
        ref={plotRef}
        role="group"
        aria-roledescription="interactive chart"
        aria-label={ariaLabel}
        aria-description="Use Left and Right Arrow to inspect points, Enter or Space to select, and Escape to leave range-selection mode."
        tabIndex={0}
        onKeyDown={handleKeyDown}
        style={{ height: `${String(height)}px` }}
        className="w-full cursor-crosshair focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-border"
      />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveText}
      </div>
      <div className="sr-only">{String(selectedIndices?.size ?? 0)} chart points selected.</div>
    </div>
  );
}

/** Resets viewport-only state by remounting the imperative boundary for a new result key. */
export function EChartsView(props: EChartsViewProps) {
  return <EChartsInstance key={props.dataResetKey} {...props} />;
}
