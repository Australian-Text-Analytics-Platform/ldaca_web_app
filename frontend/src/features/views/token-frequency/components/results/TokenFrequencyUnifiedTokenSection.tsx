import { memo } from 'react';
import type {
  NodeResultView,
  NormalizedNodeResult,
  TokenFrequencyStatisticsEntry,
} from '../../tokenFrequencyAdapters';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import HelpIcon from '@/components/help/HelpIcon';
import { Wordcloud } from '@visx/wordcloud';
import { Text } from '@visx/text';
import { TokenFrequencyStatisticsTable } from './TokenFrequencyStatisticsTable';
import { useElementWidth } from '@/lib/useElementWidth';

// Aspect ratio for the cloud SVG when sized from the container width. Keeps
// the cloud "landscape-ish" without dominating tall corpora layouts.
const UNIFIED_CLOUD_ASPECT_RATIO = 0.55;

// Floor on the SVG width so the cloud is still legible in a narrow panel
// before d3-cloud falls back to truncating big words.
const UNIFIED_CLOUD_MIN_WIDTH = 320;

// Font envelope scaled with width — see the matching constants in
// ``TokenFrequencySingleTokenSection`` for the rationale. A hardcoded
// 12-54 px range (the original) clustered words in the centre of a
// 1500-wide canvas and left a huge margin of white space around them.
const UNIFIED_CLOUD_MAX_FONT_FRACTION = 0.11;
const UNIFIED_CLOUD_MIN_FONT_PX = 12;
const UNIFIED_CLOUD_MAX_FONT_FLOOR = 40;
const UNIFIED_CLOUD_MAX_FONT_CEILING = 170;

interface TokenFrequencyUnifiedTokenSectionProps {
  normalizedNodeResults: NormalizedNodeResult[];
  nodeDisplayResults: NodeResultView[];
  lastCompareNodeIds: string[];
  statistics: TokenFrequencyStatisticsEntry[] | null | undefined;
  appliedStopSet: Set<string>;
  effectiveTokenLimit: number;
  defaultTokenLimit: number;
  computeDisplayName: (nodeId: string, fallbackKey?: string) => string;
  getColorForNode: (nodeId: string, index?: number) => string;
  onDownloadWordCloud: (nodeKey: string, displayName: string) => void;
  // Token clicks here cover both compared nodes, so no per-node id is passed
  // (the optional second arg is omitted) — see TokenFrequencySingleTokenSection
  // for the per-node scoped variant.
  onTokenClick: (token: string, nodeId?: string) => void;
  onTokenRightClick: (token: string, event?: React.MouseEvent) => void;
  unifiedCloudWidth: number;
  unifiedCloudHeight: number;
  unifiedCloudContainerRef: React.RefObject<HTMLDivElement | null>;
  registerWordCloudRef: (nodeKey: string, element: SVGSVGElement | null) => void;
  onDownloadFrequencyCsv: (label: string, rows: unknown[]) => void;
  /** Active sub-view from the parent results panel. */
  view: 'cloud' | 'list';
  /**
   * Optional wildcard filter (lifted to the parent panel) applied to the
   * statistics table when in list view. Cloud rendering is unaffected.
   */
  tokenFilter?: string;
}

/** Used by: TokenFrequencyUnifiedTokenSectionInner to parse backend statistic values for unified-cloud scoring because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
const parseStatisticsNumericValue = (value: unknown): number => {
  if (value === null || value === undefined) return NaN;
  if (value === '+Inf') return Number.POSITIVE_INFINITY;
  if (value === '-Inf') return Number.NEGATIVE_INFINITY;
  return Number(value);
};

/**
 * Rendered by: TokenFrequencyResultsPanel to show comparative token-frequency output because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
const TokenFrequencyUnifiedTokenSectionInner = ({
  normalizedNodeResults,
  nodeDisplayResults,
  lastCompareNodeIds,
  statistics,
  appliedStopSet,
  effectiveTokenLimit,
  defaultTokenLimit,
  computeDisplayName,
  getColorForNode,
  onDownloadWordCloud,
  onTokenClick,
  onTokenRightClick,
  unifiedCloudWidth,
  unifiedCloudHeight,
  unifiedCloudContainerRef,
  registerWordCloudRef,
  onDownloadFrequencyCsv,
  view,
  tokenFilter = '',
}: TokenFrequencyUnifiedTokenSectionProps) => {
  // Hook must come before any early return so React sees a stable call order
  // across renders, regardless of whether the comparative panel is showing.
  const measuredCardWidth = useElementWidth(unifiedCloudContainerRef);

  const hasMultipleNodes =
    normalizedNodeResults.length >= 2 ||
    nodeDisplayResults.length >= 2 ||
    lastCompareNodeIds.length >= 2;

  if (!hasMultipleNodes) {
    return null;
  }

  const isComparative = normalizedNodeResults.length === 2 && lastCompareNodeIds.length === 2;
  const nodeAResult = nodeDisplayResults[0] ?? normalizedNodeResults[0] ?? null;
  const nodeBResult = nodeDisplayResults[1] ?? normalizedNodeResults[1] ?? null;
  const nodeAId = nodeAResult?.nodeId ?? lastCompareNodeIds[0] ?? '';
  const nodeBId = nodeBResult?.nodeId ?? lastCompareNodeIds[1] ?? '';
  const nodeAName = nodeAResult?.displayName ?? computeDisplayName(nodeAId, nodeAId);
  const nodeBName = nodeBResult?.displayName ?? computeDisplayName(nodeBId, nodeBId);
  const nodeAColor = getColorForNode(nodeAId || nodeAName, 0);
  const nodeBColor = getColorForNode(nodeBId || nodeBName, 1);

  const statsSource = Array.isArray(statistics) && statistics.length > 0 ? statistics : [];
  const cloudStats = (Array.isArray(statsSource) ? statsSource : [])
    .filter((s) => !appliedStopSet.has(s.token.toLowerCase()))
    .map((s) => ({
      token: s.token,
      o1: s.freq_reference || 0,
      o2: s.freq_study || 0,
      p1: parseStatisticsNumericValue(s.percent_reference),
      p2: parseStatisticsNumericValue(s.percent_study),
      logratio: parseStatisticsNumericValue(s.log_ratio),
    }))
    .map((s) => ({
      ...s,
      total: s.o1 + s.o2,
      juxRank:
        s.o1 + s.o2 > 0 && Number.isFinite(s.logratio) ? Math.log10(s.o1 + s.o2) * s.logratio : 0,
    }))
    .filter((s) => s.token.length > 0 && s.total > 10);

  const sortedByRank = cloudStats.toSorted((a, b) => a.juxRank - b.juxRank);
  const limitForCloudBase =
    typeof effectiveTokenLimit === 'number' ? effectiveTokenLimit : defaultTokenLimit;
  const cloudLimit = Math.max(0, limitForCloudBase * 2);
  const half = Math.floor(cloudLimit / 2);
  const low = sortedByRank.slice(0, Math.min(half, sortedByRank.length));
  const high = sortedByRank.slice(Math.max(sortedByRank.length - half, 0));
  let selectedCloudStats = [...low, ...high];

  const remaining = Math.max(0, cloudLimit - selectedCloudStats.length);
  if (remaining > 0 && sortedByRank.length > selectedCloudStats.length) {
    const nextLow = sortedByRank[low.length] ?? null;
    const nextHigh = sortedByRank[sortedByRank.length - high.length - 1] ?? null;
    const pick = (() => {
      const al = nextLow ? Math.abs(nextLow.juxRank) : -1;
      const ah = nextHigh ? Math.abs(nextHigh.juxRank) : -1;
      return ah >= al ? nextHigh : nextLow;
    })();
    if (pick) selectedCloudStats.push(pick);
  }

  const selectedSeen = new Set<string>();
  selectedCloudStats = selectedCloudStats
    .filter((s) => (selectedSeen.has(s.token) ? false : (selectedSeen.add(s.token), true)))
    .slice(0, Math.min(cloudLimit, selectedCloudStats.length));

  const maxCloudTotal = Math.max(1, ...selectedCloudStats.map((s) => s.total || 0));

  /** Used by: TokenFrequencyUnifiedTokenSectionInner color blending to convert hex swatches into RGB channels because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
  const hexToRgb = (hex: string) => {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  };
  /** Used by: blend to convert RGB channels back into a hex swatch for SVG text fill because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
  const rgbToHex = (r: number, g: number, b: number) =>
    `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const colorA = hexToRgb(nodeAColor);
  const colorB = hexToRgb(nodeBColor);
  /**
   * Used by: unified word-cloud Text fill to blend between study and reference colors because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
   * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
   */
  const blend = (t: number) => {
    /** Used by: blend to interpolate one RGB channel for the unified cloud gradient because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    const r = Math.round(lerp(colorB.r, colorA.r, t));
    const g = Math.round(lerp(colorB.g, colorA.g, t));
    const b = Math.round(lerp(colorB.b, colorA.b, t));
    return rgbToHex(r, g, b);
  };

  const words = selectedCloudStats.map((s) => {
    const denom = s.p1 + s.p2;
    return {
      text: s.token,
      value: s.total,
      proportion: denom > 0 ? s.p1 / denom : 0.5,
    };
  });
  const proportionByToken = new Map<string, number>(
    words.map((word) => [word.text, word.proportion || 0.5]),
  );

  // Measure the card body so the SVG fills the actual available width
  // instead of a hardcoded 640 px. Falls back to the prop value before the
  // first ResizeObserver tick lands so SSR / pre-mount renders still get a
  // usable size. (useElementWidth is hoisted above the early return.)
  const effectiveCloudWidth = Math.max(
    UNIFIED_CLOUD_MIN_WIDTH,
    measuredCardWidth > 0 ? measuredCardWidth - /* padding */ 24 : unifiedCloudWidth,
  );
  const effectiveCloudHeight = Math.max(
    unifiedCloudHeight,
    Math.round(effectiveCloudWidth * UNIFIED_CLOUD_ASPECT_RATIO),
  );
  // Tie the font envelope to the measured width so d3-cloud's spiral
  // actually fills the SVG. Hardcoded 12-54 px clustered words in the
  // centre on wide panels and left a large white margin around them.
  const maxFontSize = Math.max(
    UNIFIED_CLOUD_MAX_FONT_FLOOR,
    Math.min(
      UNIFIED_CLOUD_MAX_FONT_CEILING,
      Math.round(effectiveCloudWidth * UNIFIED_CLOUD_MAX_FONT_FRACTION),
    ),
  );
  const minFontSize = Math.max(UNIFIED_CLOUD_MIN_FONT_PX, Math.round(maxFontSize / 6));
  /** Used by: TokenFrequencyUnifiedTokenSectionInner Wordcloud prop to scale words within measured bounds because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
  const fontSizeSetter = (datum: { value: number }) =>
    Math.max(
      minFontSize,
      Math.min(
        maxFontSize,
        (datum.value / maxCloudTotal) * (maxFontSize - minFontSize) + minFontSize,
      ),
    );

  return (
    <div className="space-y-3">
      <Card className={view === 'cloud' ? undefined : 'hidden'}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <CardTitle className="text-base font-semibold">Juxtorpus</CardTitle>
              <span className="text-xs text-muted-foreground">- based on keyword analysis.</span>
              <HelpIcon
                targetKey="analysis.token-frequency.unified-word-cloud"
                label="Unified word cloud"
                tooltip="Shows a combined comparative word cloud for the selected data block pair."
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              aria-label="Download word cloud"
              title="Download word cloud"
              onClick={() => {
                onDownloadWordCloud('unified', 'Unified Word Cloud');
              }}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          <div
            ref={unifiedCloudContainerRef}
            className="rounded-lg border p-3"
            style={{ minHeight: effectiveCloudHeight }}
          >
            {isComparative && selectedCloudStats.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <span
                      className="inline-block h-3.5 w-3.5 rounded"
                      style={{ backgroundColor: nodeAColor }}
                    />
                    {nodeAName}
                  </div>
                  <div className="flex items-center gap-1">
                    <span
                      className="inline-block h-3.5 w-3.5 rounded"
                      style={{ backgroundColor: nodeBColor }}
                    />
                    {nodeBName}
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>Gradient</span>
                    <div
                      className="h-2.5 w-28 rounded"
                      style={{
                        background: `linear-gradient(to right, ${nodeAColor}, ${nodeBColor})`,
                      }}
                    />
                    <span>A → B</span>
                  </div>
                </div>

                <div className="flex w-full justify-center overflow-visible">
                  <svg
                    ref={(element) => {
                      registerWordCloudRef('unified', element);
                    }}
                    width={effectiveCloudWidth}
                    height={effectiveCloudHeight}
                    xmlns="http://www.w3.org/2000/svg"
                    className="overflow-visible"
                    style={{ overflow: 'visible' }}
                  >
                    <Wordcloud
                      words={words}
                      width={effectiveCloudWidth}
                      height={effectiveCloudHeight}
                      fontSize={fontSizeSetter}
                      font="Segoe UI, Roboto, sans-serif"
                      padding={2}
                      spiral="archimedean"
                      rotate={0}
                      random={() => 0.5}
                    >
                      {(cloudWords) =>
                        cloudWords.map((word) => {
                          const tokenText = word.text ?? '';
                          const proportion = proportionByToken.get(tokenText) ?? 0.5;
                          return (
                            <Text
                              key={tokenText}
                              fill={blend(Math.max(0, Math.min(1, proportion)))}
                              textAnchor="middle"
                              transform={`translate(${String(word.x)}, ${String(word.y)}) rotate(${String(word.rotate)})`}
                              fontSize={word.size}
                              fontFamily={word.font}
                              className="cursor-pointer transition-colors"
                              onClick={() => {
                                if (tokenText) onTokenClick(tokenText);
                              }}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                if (tokenText) {
                                  onTokenRightClick(tokenText, event);
                                }
                              }}
                              style={{ cursor: 'pointer' }}
                            >
                              {tokenText}
                            </Text>
                          );
                        })
                      }
                    </Wordcloud>
                  </svg>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Unified cloud appears when two data block results and comparative statistics are
                available.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {Array.isArray(statistics) && statistics.length > 0 && (
        <div className={view === 'list' ? undefined : 'hidden'}>
          {(() => {
            // lastCompareNodeIds is ordered [reference, study]; the
            // task-flow request builder puts the study data block last
            // (the user picks it via the radio in the parameter panel)
            // and the non-selected block becomes the reference at [0].
            const referenceId = lastCompareNodeIds[0] ?? null;
            const studyId = lastCompareNodeIds[1] ?? null;
            return (
              <TokenFrequencyStatisticsTable
                statistics={statistics.filter(
                  (entry) => !appliedStopSet.has(entry.token.toLowerCase()),
                )}
                onDownloadFrequencyCsv={onDownloadFrequencyCsv}
                onTokenClick={onTokenClick}
                tokenFilter={tokenFilter}
                referenceNodeName={referenceId ? computeDisplayName(referenceId) : null}
                referenceColor={referenceId ? getColorForNode(referenceId, 0) : null}
                studyNodeName={studyId ? computeDisplayName(studyId) : null}
                studyColor={studyId ? getColorForNode(studyId, 1) : null}
              />
            );
          })()}
        </div>
      )}
    </div>
  );
};

/**
 * ``React.memo`` wrap. The unified-cloud section is one of the two hot
 * paths on a stop-word keystroke — d3-cloud's spiral layout runs inside
 * ``<Wordcloud>`` on every render, which is 50-200 ms for 50-100 words.
 * With every prop now referentially stable across keystrokes
 * (``useCallback`` on the handlers in ``TokenFrequencyFeature``,
 * ``useMemo`` on the derived collections), the default shallow compare
 * is enough to skip the re-render entirely when only ``stopWords``
 * (which this component doesn't take) changed.
 */
export const TokenFrequencyUnifiedTokenSection = memo(TokenFrequencyUnifiedTokenSectionInner);
