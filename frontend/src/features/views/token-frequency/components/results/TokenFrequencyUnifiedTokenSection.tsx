import { Download } from 'lucide-react';
import { memo, useMemo } from 'react';
import HelpIcon from '@/components/help/HelpIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ResponsiveWordCloud } from '@/features/views/common/components/ResponsiveWordCloud';
import {
  createTokenFilterMatcher,
  type NodeResultView,
  type NormalizedNodeResult,
  type TokenFrequencyStatisticsEntry,
} from '../../tokenFrequencyAdapters';
import { TokenFrequencyStatisticsTable } from './TokenFrequencyStatisticsTable';

// Aspect ratio for the cloud SVG when sized from the container width. Keeps
// the cloud "landscape-ish" without dominating tall corpora layouts.
const UNIFIED_CLOUD_ASPECT_RATIO = 0.55;

// Floors keep the comparative cloud legible before the card's measured width is available.
const UNIFIED_CLOUD_MIN_WIDTH = 320;
const UNIFIED_CLOUD_MIN_HEIGHT = 340;

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
  onTokenClick: (token: string) => void;
  onTokenRightClick: (token: string) => void;
  registerWordCloudRef: (nodeKey: string, element: SVGSVGElement | null) => void;
  onDownloadFrequencyCsv: (label: string, rows: unknown[]) => void;
  /** Active sub-view from the parent results panel. */
  view: 'cloud' | 'list';
  /**
   * Optional wildcard filter lifted to the parent result panel and applied to
   * the Juxtorpus cloud, statistics table, and their exports.
   */
  tokenFilter?: string;
}

/** Used by: TokenFrequencyUnifiedTokenSectionInner to parse backend statistic values for unified-cloud scoring. */
const parseStatisticsNumericValue = (value: unknown): number => {
  if (value === null || value === undefined) return NaN;
  if (value === '+Inf') return Number.POSITIVE_INFINITY;
  if (value === '-Inf') return Number.NEGATIVE_INFINITY;
  return Number(value);
};

/**
 * Rendered by: TokenFrequencyResultsPanel to show comparative token-frequency output.
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
  registerWordCloudRef,
  onDownloadFrequencyCsv,
  view,
  tokenFilter = '',
}: TokenFrequencyUnifiedTokenSectionProps) => {
  const filteredStatistics = useMemo(
    () => (statistics ?? []).filter((entry) => !appliedStopSet.has(entry.token.toLowerCase())),
    [appliedStopSet, statistics],
  );
  const tokenFilteredStatistics = useMemo(() => {
    const matchesTokenFilter = createTokenFilterMatcher(tokenFilter);
    return filteredStatistics.filter((entry) => matchesTokenFilter(entry.token));
  }, [filteredStatistics, tokenFilter]);

  const hasMultipleNodes =
    normalizedNodeResults.length >= 2 ||
    nodeDisplayResults.length >= 2 ||
    lastCompareNodeIds.length >= 2;

  if (!hasMultipleNodes) {
    return null;
  }

  const isComparative = normalizedNodeResults.length === 2 && lastCompareNodeIds.length === 2;
  // The gradient encodes backend comparison roles, not card position: node A
  // remains Reference and node B remains Study even when cards follow a
  // different tab-input display order.
  const resultById = new Map(nodeDisplayResults.map((result) => [result.nodeId, result]));
  const nodeAId = lastCompareNodeIds[0] ?? nodeDisplayResults[0]?.nodeId ?? '';
  const nodeBId = lastCompareNodeIds[1] ?? nodeDisplayResults[1]?.nodeId ?? '';
  const nodeAName = resultById.get(nodeAId)?.displayName ?? computeDisplayName(nodeAId, nodeAId);
  const nodeBName = resultById.get(nodeBId)?.displayName ?? computeDisplayName(nodeBId, nodeBId);
  const nodeAColor = getColorForNode(nodeAId || nodeAName, 0);
  const nodeBColor = getColorForNode(nodeBId || nodeBName, 1);

  const cloudStats = tokenFilteredStatistics
    .map((s) => ({
      token: s.token,
      o1: Number(s.freq_reference ?? 0),
      o2: Number(s.freq_study ?? 0),
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

  /** Used by: TokenFrequencyUnifiedTokenSectionInner color blending to convert hex swatches into RGB channels. */
  const hexToRgb = (hex: string) => {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  };
  /** Used by: blend to convert RGB channels back into a hex swatch for SVG text fill. */
  const rgbToHex = (r: number, g: number, b: number) =>
    `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const colorA = hexToRgb(nodeAColor);
  const colorB = hexToRgb(nodeBColor);
  /**
   * Used by: unified word-cloud data to blend between study and reference colors.
   * Flow: interpolate each RGB channel, round it, and convert the blended color
   * back to a hex swatch.
   */
  const blend = (t: number) => {
    /** Used by: blend to interpolate one RGB channel for the unified cloud gradient. */
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    const r = Math.round(lerp(colorB.r, colorA.r, t));
    const g = Math.round(lerp(colorB.g, colorA.g, t));
    const b = Math.round(lerp(colorB.b, colorA.b, t));
    return rgbToHex(r, g, b);
  };

  const words = selectedCloudStats.map((s) => {
    const denom = s.p1 + s.p2;
    const proportion = denom > 0 ? s.p1 / denom : 0.5;
    return {
      text: s.token,
      value: s.total,
      color: blend(Math.max(0, Math.min(1, proportion))),
    };
  });

  if (view === 'list') {
    return (
      <div className="space-y-3">
        {Array.isArray(statistics) && statistics.length > 0
          ? (() => {
              // lastCompareNodeIds is ordered [reference, study]; the
              // task-flow request builder puts the study data block last
              // (the user picks it via the radio in the parameter panel)
              // and the non-selected block becomes the reference at [0].
              const referenceId = lastCompareNodeIds[0] ?? null;
              const studyId = lastCompareNodeIds[1] ?? null;
              return (
                <TokenFrequencyStatisticsTable
                  statistics={filteredStatistics}
                  onDownloadFrequencyCsv={onDownloadFrequencyCsv}
                  onTokenClick={onTokenClick}
                  tokenFilter={tokenFilter}
                  referenceNodeName={referenceId ? computeDisplayName(referenceId) : null}
                  referenceColor={referenceId ? getColorForNode(referenceId, 0) : null}
                  studyNodeName={studyId ? computeDisplayName(studyId) : null}
                  studyColor={studyId ? getColorForNode(studyId, 1) : null}
                />
              );
            })()
          : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <CardTitle className="text-body font-semibold">Juxtorpus</CardTitle>
              <span className="text-label-secondary text-description">
                - based on keyword analysis.
              </span>
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
          <div className="rounded-lg border p-3">
            {isComparative && selectedCloudStats.length > 0 ? (
              <div className="space-y-3">
                <TooltipProvider delayDuration={0} skipDelayDuration={0}>
                  <div
                    className="flex items-center gap-1.5 text-body"
                    aria-label="Reference to Study color scale"
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={0}
                          aria-label={`Reference: ${nodeAName}`}
                          className="inline-flex cursor-help items-center gap-1"
                        >
                          <span>Reference</span>
                          <span
                            aria-hidden="true"
                            className="inline-block h-4 w-4 rounded-sm"
                            style={{ backgroundColor: nodeAColor }}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{nodeAName}</TooltipContent>
                    </Tooltip>
                    <div
                      className="h-2.5 w-28 rounded-sm"
                      aria-hidden="true"
                      style={{
                        background: `linear-gradient(to right, ${nodeAColor}, ${nodeBColor})`,
                      }}
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={0}
                          aria-label={`Study: ${nodeBName}`}
                          className="inline-flex cursor-help items-center gap-1"
                        >
                          <span
                            aria-hidden="true"
                            className="inline-block h-4 w-4 rounded-sm"
                            style={{ backgroundColor: nodeBColor }}
                          />
                          <span>Study</span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{nodeBName}</TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>

                <div className="flex w-full justify-center">
                  <ResponsiveWordCloud
                    words={words}
                    minWidth={UNIFIED_CLOUD_MIN_WIDTH}
                    minHeight={UNIFIED_CLOUD_MIN_HEIGHT}
                    aspectRatio={UNIFIED_CLOUD_ASPECT_RATIO}
                    svgRef={(element) => {
                      registerWordCloudRef('unified', element);
                    }}
                    onWordClick={onTokenClick}
                    onWordContextMenu={onTokenRightClick}
                  />
                </div>
              </div>
            ) : (
              <p className="text-body text-description">
                {tokenFilter.trim() && tokenFilteredStatistics.length === 0
                  ? 'No tokens match the active filter.'
                  : 'Unified cloud appears when two data block results and comparative statistics are available.'}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

/**
 * ``React.memo`` wrap. The unified-cloud section owns an external ECharts
 * layout that should not be updated on unrelated stop-word keystrokes.
 * With every prop now referentially stable across keystrokes
 * (``useCallback`` on the handlers in token-frequency feature hooks,
 * ``useMemo`` on the derived collections), the default shallow compare
 * is enough to skip the re-render entirely when only ``stopWords``
 * (which this component doesn't take) changed.
 */
export const TokenFrequencyUnifiedTokenSection = memo(TokenFrequencyUnifiedTokenSectionInner);
