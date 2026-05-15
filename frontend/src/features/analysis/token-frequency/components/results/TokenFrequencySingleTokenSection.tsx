import type { NodeResultView } from '../../tokenFrequencyAdapters';
import { wildcardToRegExp } from '../../tokenFrequencyAdapters';
import { useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { Wordcloud } from '@visx/wordcloud';
import { Text } from '@visx/text';
import { useElementWidth } from '@/lib/useElementWidth';

type TokenFrequencySingleTokenSectionProps = {
  nodeDisplayResults: NodeResultView[];
  getColorForNode: (nodeId: string, index?: number) => string;
  onTokenClick: (token: string) => void;
  onTokenRightClick: (token: string, event?: React.MouseEvent) => void;
  onDownloadWordCloud: (nodeKey: string, displayName: string) => void;
  onDownloadFrequencyCsv: (label: string, rows: unknown[]) => void;
  registerWordCloudRef: (nodeKey: string, element: SVGSVGElement | null) => void;
  /**
   * Which sub-view the parent results panel is showing. The component always
   * mounts both the word cloud and the bar list so that download refs remain
   * registered when switching tabs, and toggles visibility via the `hidden`
   * Tailwind class. Defaults to 'cloud' for backward compatibility with
   * callers (and tests) that haven't been updated to pass this prop.
   */
  view?: 'cloud' | 'list';
  /**
   * Optional wildcard filter applied to bar list rows in list view. Empty
   * string means "no filter". Cloud rendering is unaffected.
   */
  tokenFilter?: string;
  /**
   * Maximum number of rows to show in the list view per node. The cloud view
   * continues to use the cloud-side display limit (`displayRows`). When
   * undefined, falls back to the cloud-side limit (`displayRows`).
   */
  listLimit?: number;
};

const VISIBLE_BAR_ROWS = 10;
const BAR_ROW_HEIGHT_REM = 2;
const BAR_ROW_GAP_REM = 0.5;
const BAR_LIST_MAX_HEIGHT_REM = VISIBLE_BAR_ROWS * BAR_ROW_HEIGHT_REM + (VISIBLE_BAR_ROWS - 1) * BAR_ROW_GAP_REM;

// Aspect ratio applied when the per-card cloud is sized from the container
// width — keeps the cloud landscape-ish without dominating tall layouts.
const SINGLE_CLOUD_ASPECT_RATIO = 0.6;
// Floor on the SVG width so the cloud stays legible in a narrow column.
const SINGLE_CLOUD_MIN_WIDTH = 280;
// Largest font size as a fraction of the cloud width. d3-cloud's spiral
// starts from the centre — if the max word is small relative to the canvas
// you end up with a tight cluster of words and a wide margin of white space
// around it. Setting the cap as a fraction of width lets the cloud fill its
// container as the panel resizes.
const SINGLE_CLOUD_MAX_FONT_FRACTION = 0.14;
const SINGLE_CLOUD_MIN_FONT_PX = 11;
const SINGLE_CLOUD_MAX_FONT_FLOOR = 36;
const SINGLE_CLOUD_MAX_FONT_CEILING = 160;

type SingleNodeWordCloudProps = {
  nodeKey: string;
  words: Array<{ text: string; value: number }>;
  color: string;
  registerWordCloudRef: (nodeKey: string, element: SVGSVGElement | null) => void;
  onTokenClick: (token: string) => void;
  onTokenRightClick: (token: string, event?: React.MouseEvent) => void;
};

/**
 * Per-node word-cloud SVG that sizes itself to its parent container via
 * ResizeObserver. Extracted from the map body so the hook (which can't be
 * called inside a loop) sits at the top level of a component.
 */
const SingleNodeWordCloud = ({
  nodeKey,
  words,
  color,
  registerWordCloudRef,
  onTokenClick,
  onTokenRightClick,
}: SingleNodeWordCloudProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measuredWidth = useElementWidth(containerRef);
  const cloudWidth = Math.max(SINGLE_CLOUD_MIN_WIDTH, measuredWidth || SINGLE_CLOUD_MIN_WIDTH);
  const cloudHeight = Math.round(cloudWidth * SINGLE_CLOUD_ASPECT_RATIO);
  const wordCount = words.length;
  // Font-size envelope tied to the cloud width: the biggest word claims
  // ~14 % of the canvas width, which gives the spiral algorithm enough room
  // to spread its placements out across the SVG rather than clustering in
  // the centre. The floor and ceiling stop the cap from collapsing in tiny
  // panels or going absurd in ultrawide layouts.
  const maxFontSize = Math.max(
    SINGLE_CLOUD_MAX_FONT_FLOOR,
    Math.min(
      SINGLE_CLOUD_MAX_FONT_CEILING,
      Math.round(cloudWidth * SINGLE_CLOUD_MAX_FONT_FRACTION),
    ),
  );
  const minFontSize = Math.max(SINGLE_CLOUD_MIN_FONT_PX, Math.round(maxFontSize / 6));
  const maxFrequency = Math.max(1, ...words.map((w) => w.value));
  const fontSizeSetter = (datum: { value: number }) =>
    Math.max(
      minFontSize,
      Math.min(
        maxFontSize,
        (datum.value / maxFrequency) * (maxFontSize - minFontSize) + minFontSize,
      ),
    );
  return (
    <div ref={containerRef} className="w-full">
      <svg
        ref={(element) => registerWordCloudRef(nodeKey, element)}
        width={cloudWidth}
        height={cloudHeight}
        className="overflow-visible"
        style={{ overflow: 'visible' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <Wordcloud
          words={words}
          width={cloudWidth}
          height={cloudHeight}
          fontSize={fontSizeSetter}
          font="Segoe UI, Roboto, sans-serif"
          padding={wordCount > 60 ? 1 : 2}
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
                transform={`translate(${word.x}, ${word.y}) rotate(${word.rotate})`}
                fontSize={word.size}
                fontFamily={word.font}
                className="cursor-pointer transition-colors"
                onClick={() => word.text && onTokenClick(word.text)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (word.text) {
                    onTokenRightClick(word.text, event);
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                {word.text || ''}
              </Text>
            ))
          }
        </Wordcloud>
      </svg>
    </div>
  );
};

export const TokenFrequencySingleTokenSection = ({
  nodeDisplayResults,
  getColorForNode,
  onTokenClick,
  onTokenRightClick,
  onDownloadWordCloud,
  onDownloadFrequencyCsv,
  registerWordCloudRef,
  view = 'cloud',
  tokenFilter = '',
  listLimit,
}: TokenFrequencySingleTokenSectionProps) => {
  // Refs for each per-node list scroll container, used to synchronise vertical
  // scrolling across the side-by-side list view. We keep refs on the
  // component (not on each Card) so the parent can broadcast scroll events.
  const listScrollRefs = useRef<Array<HTMLDivElement | null>>([]);
  const isSyncingScrollRef = useRef(false);

  const handleListScroll = (sourceIndex: number) => (event: React.UIEvent<HTMLDivElement>) => {
    if (isSyncingScrollRef.current) {
      // Avoid feedback loops while we propagate scrollTop to siblings.
      return;
    }
    const source = event.currentTarget;
    isSyncingScrollRef.current = true;
    try {
      for (let i = 0; i < listScrollRefs.current.length; i += 1) {
        if (i === sourceIndex) continue;
        const target = listScrollRefs.current[i];
        if (target && target !== source && target.scrollTop !== source.scrollTop) {
          target.scrollTop = source.scrollTop;
        }
      }
    } finally {
      isSyncingScrollRef.current = false;
    }
  };

  const singleNodeLayoutClassName = nodeDisplayResults.length <= 1
    ? 'grid grid-cols-1 gap-4'
    : 'grid grid-cols-1 gap-4 lg:grid-cols-2';

  // Width (in ch) of the rank gutter inside each list card. Sized to the
  // largest *original* list length (after stop-word filtering, capped by the
  // list display limit) across cards so ranks don't shift when filtering.
  const tokenFilterTrimmed = tokenFilter.trim();
  const tokenFilterRegex = tokenFilterTrimmed ? wildcardToRegExp(tokenFilterTrimmed) : null;
  const matchesTokenFilter = (token: string): boolean => {
    if (!tokenFilterTrimmed) return true;
    if (!tokenFilterRegex) {
      return token.toLowerCase().includes(tokenFilterTrimmed.toLowerCase());
    }
    return tokenFilterRegex.test(token);
  };
  const listSliceCapForGutter = typeof listLimit === 'number' && Number.isFinite(listLimit) && listLimit > 0
    ? Math.floor(listLimit)
    : Number.POSITIVE_INFINITY;
  const maxRowCount = nodeDisplayResults.reduce((acc, item) => {
    const filtered = Array.isArray(item.filteredRows) ? item.filteredRows : [];
    const listed = Math.min(filtered.length, listSliceCapForGutter);
    const fallback = Array.isArray(item.displayRows) ? item.displayRows.length : 0;
    return Math.max(acc, listed > 0 ? listed : fallback);
  }, 0);
  const rankWidthCh = Math.max(2, String(maxRowCount).length + 1);

  return (
    <div className={singleNodeLayoutClassName} data-testid="token-frequency-single-layout">
      {nodeDisplayResults.map((result, index) => {
        const nodeKey = result.nodeId || result.displayName || `node-${index}`;
        const color = getColorForNode(result.nodeId || result.displayName, index);
        const displayRows = Array.isArray(result.displayRows) ? result.displayRows : [];
        // List view uses its own (typically larger) cap on the full
        // stop-word-filtered list, so it can show more rows than the cloud.
        // Falls back to the cloud cap when no list limit is provided.
        const filteredRowsAll = Array.isArray(result.filteredRows) ? result.filteredRows : displayRows;
        const listSliceCap = typeof listLimit === 'number' && Number.isFinite(listLimit) && listLimit > 0
          ? Math.floor(listLimit)
          : displayRows.length;
        const listSourceRows = filteredRowsAll.slice(0, listSliceCap);
        // Then apply the wildcard filter for list view; cloud view stays unaffected.
        // Preserve each row's original 1-based rank so filtering doesn't renumber rows.
        const filteredListRows: Array<{ row: typeof listSourceRows[number]; rank: number }> = listSourceRows
          .map((row, rowIndex) => ({ row, rank: rowIndex + 1 }))
          .filter(({ row }) => matchesTokenFilter(String(row?.token ?? '')));
        const listMaxFrequency = Math.max(1, ...filteredListRows.map(({ row }) => Number(row.frequency) || 0));
        const words = displayRows.map((item) => ({
          text: String(item?.token ?? ''),
          value: Number(item?.frequency) || 0,
        }));

        return (
          <Card key={`${result.nodeId || result.displayName}-${index}`} className="h-full">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <CardTitle className="min-w-0 flex-1 break-words whitespace-normal text-base font-semibold [overflow-wrap:anywhere]">
                  {result.displayName}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end" data-testid={`token-frequency-actions-${nodeKey}`}>
                  {view === 'cloud' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="Download word cloud"
                      title="Download word cloud"
                      onClick={() => onDownloadWordCloud(nodeKey, result.displayName)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  ) : null}
                  {view === 'list' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="Download frequencies"
                      title="Download frequencies"
                      onClick={() => onDownloadFrequencyCsv(result.displayName, Array.isArray(result.filteredRows) ? result.filteredRows : result.rows)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-2">
              <div className={view === 'cloud' ? 'mb-4 flex w-full justify-center overflow-visible' : 'hidden'}>
                <SingleNodeWordCloud
                  nodeKey={nodeKey}
                  words={words}
                  color={color}
                  registerWordCloudRef={registerWordCloudRef}
                  onTokenClick={onTokenClick}
                  onTokenRightClick={onTokenRightClick}
                />
              </div>

              <div
                ref={(element) => {
                  listScrollRefs.current[index] = element;
                }}
                onScroll={handleListScroll(index)}
                className={view === 'list' ? 'space-y-2 overflow-y-auto pr-1' : 'hidden'}
                style={view === 'list' ? { maxHeight: `${BAR_LIST_MAX_HEIGHT_REM}rem` } : undefined}
              >
                {filteredListRows.map(({ row, rank }) => {
                  const frequency = Number(row.frequency) || 0;
                  const widthPct = Math.max(3, Math.round((frequency / listMaxFrequency) * 100));
                  return (
                    <div
                      key={`${result.nodeId}-${row.token}`}
                      className="grid items-center gap-2"
                      style={{ gridTemplateColumns: `${rankWidthCh}ch minmax(0,1fr) 90px` }}
                    >
                      <span className="text-right text-xs tabular-nums text-muted-foreground">
                        {rank}.
                      </span>
                      <button
                        type="button"
                        className="group relative h-8 overflow-hidden rounded border text-left"
                        onClick={() => onTokenClick(row.token)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          onTokenRightClick(row.token, event);
                        }}
                        title="Click to inspect in concordance. Right-click to add to stop words."
                      >
                        <span
                          className="absolute inset-y-0 left-0 rounded bg-primary/20 group-hover:bg-primary/30"
                          style={{ width: `${widthPct}%`, backgroundColor: color }}
                        />
                        <span className="relative z-10 block truncate px-2 text-sm font-medium">{row.token}</span>
                      </button>
                      <span className="text-right text-xs tabular-nums text-muted-foreground">{frequency}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
