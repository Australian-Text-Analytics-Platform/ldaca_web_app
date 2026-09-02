import 'echarts-wordcloud';

import { init, type EChartsType, use as registerEChartsModules } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import type { WordCloudSeriesOption } from 'echarts/types/dist/echarts';
import { memo, useEffect, useRef } from 'react';
import { useElementWidth } from '@/lib/useElementWidth';

registerEChartsModules([SVGRenderer]);

interface WordCloudDatum {
  text: string;
  value: number;
  color?: string;
}

interface Props {
  words: WordCloudDatum[];
  color?: string;
  minWidth?: number;
  minHeight?: number;
  aspectRatio?: number;
  svgRef?: (element: SVGSVGElement | null) => void;
  onWordClick?: (word: string) => void;
  onWordContextMenu?: (word: string) => void;
}

interface WordCloudPointerEvent {
  name?: string;
}

// echarts-wordcloud 2.1.0 implements these options, but its bundled declaration
// file was not updated when they were added to the extension.
interface WordflowWordCloudSeriesOption extends WordCloudSeriesOption {
  keepAspect: boolean;
  shrinkToFit: boolean;
}

/** Responsive deterministic ECharts cloud shared by analysis-specific wrappers. */
function ResponsiveWordCloudInstance({
  words,
  color = 'currentColor',
  minWidth = 180,
  minHeight = 0,
  aspectRatio = 0.6,
  svgRef,
  onWordClick,
  onWordContextMenu,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const wordClickRef = useRef(onWordClick);
  const wordContextMenuRef = useRef(onWordContextMenu);
  const measuredWidth = useElementWidth(containerRef);
  const cloudWidth = Math.max(minWidth, measuredWidth);
  const cloudHeight = Math.max(minHeight, Math.round(cloudWidth * aspectRatio));
  const maxFontSize = Math.max(28, Math.min(160, Math.round(cloudWidth * 0.14)));
  const minFontSize = Math.max(10, Math.round(maxFontSize / 6));
  const maxValue = Math.max(Number.EPSILON, ...words.map((word) => word.value));
  const interactive = Boolean(onWordClick ?? onWordContextMenu);
  const ariaLabel = words.map((word) => `${word.text}: ${String(word.value)}`).join(', ');

  useEffect(() => {
    wordClickRef.current = onWordClick;
    wordContextMenuRef.current = onWordContextMenu;
  }, [onWordClick, onWordContextMenu]);

  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;

    const chart = init(element, undefined, { renderer: 'svg' });
    chartRef.current = chart;

    const handleClick = (event: WordCloudPointerEvent) => {
      if (event.name) wordClickRef.current?.(event.name);
    };
    const handleContextMenu = (event: WordCloudPointerEvent) => {
      if (event.name) wordContextMenuRef.current?.(event.name);
    };

    chart.on('click', 'series.wordCloud', handleClick as never);
    chart.on('contextmenu', 'series.wordCloud', handleContextMenu as never);

    return () => {
      chart.off('click', handleClick);
      chart.off('contextmenu', handleContextMenu);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const element = plotRef.current;
    if (!chart || !element) return;

    const series: WordflowWordCloudSeriesOption = {
      type: 'wordCloud',
      shape: 'circle',
      keepAspect: false,
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      sizeRange: [minFontSize, maxFontSize],
      rotationRange: [0, 0],
      rotationStep: 1,
      gridSize: 4,
      drawOutOfBound: false,
      shrinkToFit: true,
      layoutAnimation: false,
      silent: !interactive,
      cursor: interactive ? 'pointer' : 'default',
      textStyle: {
        color,
        fontFamily: 'Segoe UI, Roboto, sans-serif',
        fontWeight: 'normal',
      },
      data: words.map((word) => ({
        name: word.text,
        value: word.value,
        textStyle: {
          color: word.color ?? color,
          fontFamily: 'Segoe UI, Roboto, sans-serif',
          fontWeight: 'normal',
          fontSize: Math.max(
            minFontSize,
            Math.min(
              maxFontSize,
              (word.value / maxValue) * (maxFontSize - minFontSize) + minFontSize,
            ),
          ),
        },
      })),
    };

    // echarts-wordcloud defers its first layout pass even when layoutAnimation is
    // disabled. Dispose the previous layout before replacing the option so a
    // pending pass cannot append stale words after a resize or tab remount.
    chart.clear();
    chart.resize({ width: cloudWidth, height: cloudHeight });
    chart.setOption({ animation: false, series: [series] }, { notMerge: true, lazyUpdate: false });

    const svg = element.querySelector('svg');
    svgRef?.(svg);
    return () => {
      svgRef?.(null);
    };
  }, [
    cloudHeight,
    cloudWidth,
    color,
    interactive,
    maxFontSize,
    maxValue,
    minFontSize,
    svgRef,
    words,
  ]);

  return (
    <div ref={containerRef} className="w-full">
      <div
        ref={plotRef}
        role="img"
        aria-label={ariaLabel}
        onContextMenu={(event) => {
          if (onWordContextMenu) event.preventDefault();
        }}
        style={{ width: `${String(cloudWidth)}px`, height: `${String(cloudHeight)}px` }}
      />
    </div>
  );
}

/** ECharts layout is an identity-sensitive external boundary, so prop-stable parents may skip it. */
export const ResponsiveWordCloud = memo(ResponsiveWordCloudInstance);
