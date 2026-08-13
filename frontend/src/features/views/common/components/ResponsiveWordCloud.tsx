import { memo, useRef } from 'react';
import { Text } from '@visx/text';
import { Wordcloud } from '@visx/wordcloud';
import { useElementWidth } from '@/lib/useElementWidth';

interface WordCloudDatum {
  text: string;
  value: number;
}

interface Props {
  words: WordCloudDatum[];
  color?: string;
  minWidth?: number;
  aspectRatio?: number;
  className?: string;
  svgRef?: (element: SVGSVGElement | null) => void;
  onWordClick?: (word: string) => void;
  onWordContextMenu?: (word: string, event: React.MouseEvent) => void;
}

/** Responsive deterministic cloud shared by analysis-specific wrappers. */
export const ResponsiveWordCloud = memo(function ResponsiveWordCloud({
  words,
  color = 'currentColor',
  minWidth = 180,
  aspectRatio = 0.6,
  className,
  svgRef,
  onWordClick,
  onWordContextMenu,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measuredWidth = useElementWidth(containerRef);
  const cloudWidth = Math.max(minWidth, measuredWidth);
  const cloudHeight = Math.round(cloudWidth * aspectRatio);
  const maxFontSize = Math.max(28, Math.min(160, Math.round(cloudWidth * 0.14)));
  const minFontSize = Math.max(10, Math.round(maxFontSize / 6));
  const maxValue = Math.max(Number.EPSILON, ...words.map((word) => word.value));
  const interactive = Boolean(onWordClick ?? onWordContextMenu);

  return (
    <div ref={containerRef} className={className ?? 'w-full'}>
      <svg
        ref={svgRef}
        width={cloudWidth}
        height={cloudHeight}
        className="overflow-visible"
        style={{ overflow: 'visible' }}
        xmlns="http://www.w3.org/2000/svg"
        aria-label={words.map((word) => `${word.text}: ${String(word.value)}`).join(', ')}
      >
        <Wordcloud
          words={words}
          width={cloudWidth}
          height={cloudHeight}
          fontSize={({ value }) =>
            Math.max(
              minFontSize,
              Math.min(maxFontSize, (value / maxValue) * (maxFontSize - minFontSize) + minFontSize),
            )
          }
          font="Segoe UI, Roboto, sans-serif"
          padding={words.length > 60 ? 1 : 2}
          spiral="archimedean"
          rotate={0}
          random={() => 0.5}
        >
          {(cloudWords) =>
            cloudWords.map((word) => (
              <Text
                key={word.text}
                fill={color}
                textAnchor="middle"
                transform={`translate(${String(word.x)}, ${String(word.y)}) rotate(${String(word.rotate)})`}
                fontSize={word.size}
                fontFamily={word.font}
                className={interactive ? 'cursor-pointer transition-colors' : undefined}
                onClick={() => {
                  if (word.text) onWordClick?.(word.text);
                }}
                onContextMenu={(event) => {
                  if (!word.text || !onWordContextMenu) return;
                  event.preventDefault();
                  onWordContextMenu(word.text, event);
                }}
              >
                {word.text ?? ''}
              </Text>
            ))
          }
        </Wordcloud>
      </svg>
    </div>
  );
});
