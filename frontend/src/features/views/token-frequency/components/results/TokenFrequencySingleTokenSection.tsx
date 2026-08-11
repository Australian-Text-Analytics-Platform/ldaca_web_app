import type { NodeResultView } from '../../tokenFrequencyAdapters';
import { wildcardToRegExp } from '../../tokenFrequencyAdapters';
import { memo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { toBgColor } from '@/features/views/common/vizPalette';
import { ResponsiveWordCloud } from '@/features/views/common/components/ResponsiveWordCloud';

interface TokenFrequencySingleTokenSectionProps {
  nodeDisplayResults: NodeResultView[];
  getColorForNode: (nodeId: string, index?: number) => string;
  onTokenClick: (token: string) => void;
  onTokenRightClick: (token: string, event?: React.MouseEvent) => void;
  onDownloadWordCloud: (nodeKey: string, displayName: string) => void;
  onDownloadFrequencyCsv: (label: string, rows: unknown[]) => void;
  registerWordCloudRef: (nodeKey: string, element: SVGSVGElement | null) => void;
  /** Which sub-view the parent results panel is showing. */
  view: 'cloud' | 'list';
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
}

const VISIBLE_BAR_ROWS = 10;
const BAR_ROW_HEIGHT_REM = 2;
const BAR_ROW_GAP_REM = 0.5;
const BAR_LIST_MAX_HEIGHT_REM =
  VISIBLE_BAR_ROWS * BAR_ROW_HEIGHT_REM + (VISIBLE_BAR_ROWS - 1) * BAR_ROW_GAP_REM;

// Aspect ratio applied when the per-card cloud is sized from the container
// width — keeps the cloud landscape-ish without dominating tall layouts.

interface SingleNodeWordCloudProps {
  nodeKey: string;
  words: { text: string; value: number }[];
  color: string;
  registerWordCloudRef: (nodeKey: string, element: SVGSVGElement | null) => void;
  onTokenClick: (token: string) => void;
  onTokenRightClick: (token: string, event?: React.MouseEvent) => void;
}

/**
 * Per-node word-cloud SVG that sizes itself to its parent container via
 * ResizeObserver. Extracted from the map body so the hook (which can't be
 * called inside a loop) sits at the top level of a component.
 */
const SingleNodeWordCloud = memo(
  ({
    nodeKey,
    words,
    color,
    registerWordCloudRef,
    onTokenClick,
    onTokenRightClick,
  }: SingleNodeWordCloudProps) => {
    return (
      <ResponsiveWordCloud
        words={words}
        color={color}
        minWidth={280}
        svgRef={(element) => {
          registerWordCloudRef(nodeKey, element);
        }}
        onWordClick={onTokenClick}
        onWordContextMenu={onTokenRightClick}
      />
    );
  },
);
SingleNodeWordCloud.displayName = 'SingleNodeWordCloud';

/**
 * Rendered by: TokenFrequencyResultsPanel to show per-node word clouds or synchronized token lists.
 */
const TokenFrequencySingleTokenSectionInner = ({
  nodeDisplayResults,
  getColorForNode,
  onTokenClick,
  onTokenRightClick,
  onDownloadWordCloud,
  onDownloadFrequencyCsv,
  registerWordCloudRef,
  view,
  tokenFilter = '',
  listLimit,
}: TokenFrequencySingleTokenSectionProps) => {
  // Refs for each per-node list scroll container, used to synchronise vertical
  // scrolling across the side-by-side list view. We keep refs on the
  // component (not on each Card) so the parent can broadcast scroll events.
  const listScrollRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isSyncingScrollRef = useRef(false);

  /**
   * Called by: per-node token list scroll containers to keep rows visually aligned across cards.
   * Flow: ignore recursive sync events, copy the source scrollTop to sibling token lists, then release the sync guard.
   */
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

  const singleNodeLayoutClassName =
    nodeDisplayResults.length <= 1
      ? 'grid grid-cols-1 gap-4'
      : 'grid grid-cols-1 gap-4 lg:grid-cols-2';

  // Width (in ch) of the rank gutter inside each list card. Sized to the
  // largest *original* list length (after stop-word filtering, capped by the
  // list display limit) across cards so ranks don't shift when filtering.
  const tokenFilterTrimmed = tokenFilter.trim();
  const tokenFilterRegex = tokenFilterTrimmed ? wildcardToRegExp(tokenFilterTrimmed) : null;
  /** Used by: TokenFrequencySingleTokenSectionInner list rows to test visibility under the current filter. */
  const matchesTokenFilter = (token: string): boolean => {
    if (!tokenFilterTrimmed) return true;
    if (!tokenFilterRegex) {
      return token.toLowerCase().includes(tokenFilterTrimmed.toLowerCase());
    }
    return tokenFilterRegex.test(token);
  };
  const listSliceCapForGutter =
    typeof listLimit === 'number' && Number.isFinite(listLimit) && listLimit > 0
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
        const nodeKey = result.nodeId || result.displayName || `node-${String(index)}`;
        const color = getColorForNode(result.nodeId || result.displayName, index);
        const displayRows = Array.isArray(result.displayRows) ? result.displayRows : [];
        // List view uses its own (typically larger) cap on the full
        // stop-word-filtered list, so it can show more rows than the cloud.
        // Falls back to the cloud cap when no list limit is provided.
        const filteredRowsAll = Array.isArray(result.filteredRows)
          ? result.filteredRows
          : displayRows;
        const listSliceCap =
          typeof listLimit === 'number' && Number.isFinite(listLimit) && listLimit > 0
            ? Math.floor(listLimit)
            : displayRows.length;
        const listSourceRows = filteredRowsAll.slice(0, listSliceCap);
        // Then apply the wildcard filter for list view; cloud view stays unaffected.
        // Preserve each row's original 1-based rank so filtering doesn't renumber rows.
        const filteredListRows: { row: (typeof listSourceRows)[number]; rank: number }[] =
          listSourceRows
            .map((row, rowIndex) => ({ row, rank: rowIndex + 1 }))
            .filter(({ row }) => matchesTokenFilter(row.token));
        const listMaxFrequency = Math.max(
          1,
          ...filteredListRows.map(({ row }) => row.frequency || 0),
        );
        const words = displayRows.map((item) => ({
          text: item.token,
          value: item.frequency || 0,
        }));

        return (
          <Card key={`${result.nodeId || result.displayName}-${String(index)}`} className="h-full">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <CardTitle className="min-w-0 flex-1 wrap-anywhere whitespace-normal text-base font-semibold">
                  {result.displayName}
                </CardTitle>
                <div
                  className="flex flex-wrap items-center gap-2 sm:justify-end"
                  data-testid={`token-frequency-actions-${nodeKey}`}
                >
                  {view === 'cloud' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="Download word cloud"
                      title="Download word cloud"
                      onClick={() => {
                        onDownloadWordCloud(nodeKey, result.displayName);
                      }}
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
                      onClick={() => {
                        onDownloadFrequencyCsv(
                          result.displayName,
                          Array.isArray(result.filteredRows) ? result.filteredRows : result.rows,
                        );
                      }}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-2">
              <div
                className={
                  view === 'cloud' ? 'mb-4 flex w-full justify-center overflow-visible' : 'hidden'
                }
              >
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
                style={
                  view === 'list'
                    ? { maxHeight: `${String(BAR_LIST_MAX_HEIGHT_REM)}rem` }
                    : undefined
                }
              >
                {filteredListRows.map(({ row, rank }) => {
                  const frequency = row.frequency || 0;
                  const widthPct = Math.max(3, Math.round((frequency / listMaxFrequency) * 100));
                  return (
                    <div
                      key={`${result.nodeId}-${row.token}`}
                      className="grid items-center gap-2"
                      style={{ gridTemplateColumns: `${String(rankWidthCh)}ch minmax(0,1fr) 90px` }}
                    >
                      <span className="text-right text-xs tabular-nums text-muted-foreground">
                        {rank}.
                      </span>
                      <button
                        type="button"
                        className="group relative h-8 overflow-hidden rounded border text-left"
                        onClick={() => {
                          onTokenClick(row.token);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          onTokenRightClick(row.token, event);
                        }}
                        title="Click to inspect in concordance. Right-click to add to stop words."
                      >
                        <span
                          className="absolute inset-y-0 left-0 rounded bg-primary/20 group-hover:bg-primary/30"
                          style={{
                            width: `${String(widthPct)}%`,
                            backgroundColor: toBgColor(color),
                          }}
                        />
                        <span className="relative z-10 block truncate px-2 text-sm font-medium">
                          {row.token}
                        </span>
                      </button>
                      <span className="text-right text-xs tabular-nums text-muted-foreground">
                        {frequency}
                      </span>
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

/**
 * ``React.memo`` wrap. Like the unified section, this is one of the hot
 * paths on a stop-word keystroke — d3-cloud's spiral runs inside every
 * per-card ``<Wordcloud>``. With every prop now referentially stable
 * across keystrokes the default shallow compare is enough to skip the
 * re-render entirely when only ``stopWords`` (which this component
 * doesn't take) changed.
 */
export const TokenFrequencySingleTokenSection = memo(TokenFrequencySingleTokenSectionInner);
