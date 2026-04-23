import type { NodeResultView, NormalizedNodeResult, TokenFrequencyStatisticsEntry } from '../../tokenFrequencyAdapters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, Search, SortAsc, SortDesc } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import HelpIcon from '@/components/help/HelpIcon';
import { Wordcloud } from '@visx/wordcloud';
import { Text } from '@visx/text';

type TokenFrequencyUnifiedTokenSectionProps = {
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
  onTokenRightClick: (token: string, event?: React.MouseEvent) => void;
  unifiedCloudWidth: number;
  unifiedCloudHeight: number;
  unifiedCloudContainerRef: React.RefObject<HTMLDivElement | null>;
  registerWordCloudRef: (nodeKey: string, element: SVGSVGElement | null) => void;
  sortedStatistics: TokenFrequencyStatisticsEntry[];
  statsSortColumn: string;
  statsSortDirection: 'asc' | 'desc';
  onToggleStatsSort: (column: string) => void;
  statsPage: number;
  onStatsPageChange: (page: number) => void;
  statsRowsPerPage: number;
  onStatsRowsPerPageChange: (rows: number) => void;
  onDownloadFrequencyCsv: (label: string, rows: unknown[]) => void;
  statsTokenFilter: string;
  onStatsTokenFilterChange: (value: string) => void;
};

type StatisticsColumn = {
  key: string;
  label: string;
  className?: string;
  render?: (value: unknown, row: TokenFrequencyStatisticsEntry) => React.ReactNode;
};

const parseStatisticsNumericValue = (value: unknown): number => {
  if (value === null || value === undefined) return NaN;
  if (value === '+Inf') return Number.POSITIVE_INFINITY;
  if (value === '-Inf') return Number.NEGATIVE_INFINITY;
  return Number(value);
};

const formatNumber = (
  value: unknown,
  options: {
    decimals?: number;
    suffix?: string;
    multiplier?: number;
    fallback?: string;
  } = {}
) => {
  const {
    decimals = 2,
    suffix = '',
    multiplier = 1,
    fallback = 'N/A',
  } = options;
  if (value === '+Inf') {
    return `+∞${suffix}`;
  }
  if (value === '-Inf') {
    return `-∞${suffix}`;
  }
  const parsed = parseStatisticsNumericValue(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return `${(parsed * multiplier).toFixed(decimals)}${suffix}`;
};

const STATISTICS_COLUMNS: StatisticsColumn[] = [
  { key: 'token', label: 'Token', className: 'font-medium' },
  { key: 'freq_baseline', label: 'OB', className: 'tabular-nums' },
  {
    key: 'percent_baseline',
    label: '%B',
    className: 'tabular-nums',
    render: (value) => formatNumber(value, { decimals: 2, suffix: '%' }),
  },
  { key: 'freq_study', label: 'OS', className: 'tabular-nums' },
  {
    key: 'percent_study',
    label: '%S',
    className: 'tabular-nums',
    render: (value) => formatNumber(value, { decimals: 2, suffix: '%' }),
  },
  {
    key: 'log_likelihood_llv',
    label: 'LL',
    className: 'tabular-nums',
    render: (value) => formatNumber(value, { decimals: 2 }),
  },
  {
    key: 'percent_diff',
    label: '%DIFF',
    className: 'tabular-nums',
    render: (value) => formatNumber(value, { decimals: 2, suffix: '%', multiplier: 100 }),
  },
  {
    key: 'bayes_factor_bic',
    label: 'Bayes',
    className: 'tabular-nums',
    render: (value) => formatNumber(value, { decimals: 2 }),
  },
  {
    key: 'effect_size_ell',
    label: 'ELL',
    className: 'tabular-nums',
    render: (value) => formatNumber(value, { decimals: 4 }),
  },
  {
    key: 'relative_risk',
    label: 'RRisk',
    className: 'tabular-nums',
    render: (value) => formatNumber(value, { decimals: 2 }),
  },
  {
    key: 'log_ratio',
    label: 'LogRatio',
    className: 'tabular-nums',
    render: (value) => formatNumber(value, { decimals: 4 }),
  },
  {
    key: 'odds_ratio',
    label: 'OddsRatio',
    className: 'tabular-nums',
    render: (value) => formatNumber(value, { decimals: 2 }),
  },
  {
    key: 'significance',
    label: 'Significance',
    render: (_value, row) => {
      const significance = String(row?.significance ?? '');
      const badgeClass =
        significance === '****'
          ? 'bg-red-100 text-red-800'
          : significance === '***'
            ? 'bg-orange-100 text-orange-800'
            : significance === '**'
              ? 'bg-yellow-100 text-yellow-800'
              : significance === '*'
                ? 'bg-green-100 text-green-800'
                : 'bg-muted text-muted-foreground';
      return (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>
          {significance || 'n.s.'}
        </span>
      );
    },
  },
];

export const TokenFrequencyUnifiedTokenSection = ({
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
  sortedStatistics,
  statsSortColumn,
  statsSortDirection,
  onToggleStatsSort,
  statsPage,
  onStatsPageChange,
  statsRowsPerPage,
  onStatsRowsPerPageChange,
  onDownloadFrequencyCsv,
  statsTokenFilter,
  onStatsTokenFilterChange,
}: TokenFrequencyUnifiedTokenSectionProps) => {
  const hasMultipleNodes = normalizedNodeResults.length >= 2 || nodeDisplayResults.length >= 2 || lastCompareNodeIds.length >= 2;

  if (!hasMultipleNodes) {
    return null;
  }

  const statisticsPageCount = Math.max(1, Math.ceil(sortedStatistics.length / statsRowsPerPage));
  const safeStatsPage = Math.min(statsPage, statisticsPageCount);
  const pagedStatistics = sortedStatistics.slice(
    (safeStatsPage - 1) * statsRowsPerPage,
    safeStatsPage * statsRowsPerPage
  );

  const isComparative = normalizedNodeResults.length === 2 && lastCompareNodeIds.length === 2;
  const nodeAResult = (nodeDisplayResults[0] ?? normalizedNodeResults[0]) ?? null;
  const nodeBResult = (nodeDisplayResults[1] ?? normalizedNodeResults[1]) ?? null;
  const nodeAId = nodeAResult?.nodeId ?? lastCompareNodeIds[0] ?? '';
  const nodeBId = nodeBResult?.nodeId ?? lastCompareNodeIds[1] ?? '';
  const nodeAName = nodeAResult?.displayName ?? computeDisplayName(nodeAId, nodeAId);
  const nodeBName = nodeBResult?.displayName ?? computeDisplayName(nodeBId, nodeBId);
  const nodeAColor = getColorForNode(nodeAId || nodeAName, 0);
  const nodeBColor = getColorForNode(nodeBId || nodeBName, 1);

  const statsSource = Array.isArray(statistics) && statistics.length > 0 ? statistics : sortedStatistics;
  const cloudStats = (Array.isArray(statsSource) ? statsSource : [])
    .filter((s) => !appliedStopSet.has(String(s?.token ?? '').toLowerCase()))
    .map((s) => ({
      token: String(s?.token ?? ''),
      o1: Number(s?.freq_baseline) || 0,
      o2: Number(s?.freq_study) || 0,
      p1: parseStatisticsNumericValue(s?.percent_baseline),
      p2: parseStatisticsNumericValue(s?.percent_study),
      logratio: parseStatisticsNumericValue(s?.log_ratio),
    }))
    .map((s) => ({
      ...s,
      total: s.o1 + s.o2,
      juxRank:
        (s.o1 + s.o2) > 0 && Number.isFinite(s.logratio)
          ? Math.log10(s.o1 + s.o2) * s.logratio
          : 0,
    }))
    .filter((s) => s.token.length > 0 && s.total > 10);

  const sortedByRank = [...cloudStats].sort((a, b) => a.juxRank - b.juxRank);
  const limitForCloudBase = typeof effectiveTokenLimit === 'number' ? effectiveTokenLimit : defaultTokenLimit;
  const cloudLimit = Math.max(0, limitForCloudBase * 2);
  const half = Math.floor(cloudLimit / 2);
  const low = sortedByRank.slice(0, Math.min(half, sortedByRank.length));
  const high = sortedByRank.slice(Math.max(sortedByRank.length - half, 0));
  let selectedCloudStats = [...low, ...high];

  const remaining = Math.max(0, cloudLimit - selectedCloudStats.length);
  if (remaining > 0 && sortedByRank.length > selectedCloudStats.length) {
    const nextLow = sortedByRank[low.length] || null;
    const nextHigh = sortedByRank[sortedByRank.length - high.length - 1] || null;
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

  const maxCloudTotal = Math.max(1, ...selectedCloudStats.map((s) => Number(s.total) || 0));

  const hexToRgb = (hex: string) => {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  };
  const rgbToHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const colorA = hexToRgb(nodeAColor);
  const colorB = hexToRgb(nodeBColor);
  const blend = (t: number) => {
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
      proportion: denom > 0 ? (s.p1 / denom) : 0.5,
    };
  });
  const proportionByToken = new Map<string, number>(
    words.map((word) => [word.text, Number(word.proportion) || 0.5])
  );
  const fontSizeSetter = (datum: { value: number }) => Math.max(12, Math.min(54, (datum.value / maxCloudTotal) * 42 + 12));

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold">Unified Word Cloud</CardTitle>
              <HelpIcon
                targetKey="analysis.token-frequency.unified-word-cloud"
                label="Unified word cloud"
                tooltip="Shows a combined comparative word cloud for the selected data block pair."
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => onDownloadWordCloud('unified', 'Unified Word Cloud')}>
              <Download className="mr-2 h-4 w-4" />
              Word Cloud
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          <div ref={unifiedCloudContainerRef} className="rounded-lg border p-3" style={{ minHeight: Math.max(240, unifiedCloudHeight) }}>
            {isComparative && selectedCloudStats.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <div className="flex items-center gap-1"><span className="inline-block h-3.5 w-3.5 rounded" style={{ backgroundColor: nodeAColor }} />{nodeAName}</div>
                  <div className="flex items-center gap-1"><span className="inline-block h-3.5 w-3.5 rounded" style={{ backgroundColor: nodeBColor }} />{nodeBName}</div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>Gradient</span>
                    <div className="h-2.5 w-28 rounded" style={{ background: `linear-gradient(to right, ${nodeAColor}, ${nodeBColor})` }} />
                    <span>A → B</span>
                  </div>
                </div>

                <div className="flex w-full justify-center overflow-visible">
                  <svg
                    ref={(element) => registerWordCloudRef('unified', element)}
                    width={unifiedCloudWidth}
                    height={unifiedCloudHeight}
                    xmlns="http://www.w3.org/2000/svg"
                    className="overflow-visible"
                    style={{ overflow: 'visible' }}
                  >
                    <Wordcloud
                      words={words}
                      width={unifiedCloudWidth}
                      height={unifiedCloudHeight}
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
                              transform={`translate(${word.x}, ${word.y}) rotate(${word.rotate})`}
                              fontSize={word.size}
                              fontFamily={word.font}
                              className="cursor-pointer transition-colors"
                              onClick={() => tokenText && onTokenClick(tokenText)}
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
              <p className="text-sm text-muted-foreground">Unified cloud appears when two data block results and comparative statistics are available.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {(Array.isArray(statistics) && statistics.length > 0) && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold">Statistics</h4>
              <HelpIcon
                targetKey="analysis.token-frequency.statistical-measures"
                label="Statistics"
                tooltip="Displays comparative token-level statistical measures for the selected data blocks."
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDownloadFrequencyCsv('token-keyness', sortedStatistics)}
            >
              <Download className="mr-2 h-4 w-4" />
              Frequencies
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter tokens (use * as wildcard, e.g. pre* or *ing)"
              value={statsTokenFilter}
              onChange={(event) => onStatsTokenFilterChange(event.target.value)}
              className="h-8 max-w-sm"
            />
            {statsTokenFilter && (
              <span className="text-xs text-muted-foreground">
                {sortedStatistics.length} match{sortedStatistics.length !== 1 ? 'es' : ''}
              </span>
            )}
          </div>

          {sortedStatistics.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-300 border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  {STATISTICS_COLUMNS.map((column) => {
                    const isActive = statsSortColumn === column.key;
                    return (
                      <th key={column.key} className="px-2 py-2 whitespace-nowrap">
                        <Button variant="ghost" size="sm" className="h-auto px-0" onClick={() => onToggleStatsSort(column.key)}>
                          {column.label}
                          {isActive ? (
                            statsSortDirection === 'asc' ? <SortAsc className="ml-1 h-3.5 w-3.5" /> : <SortDesc className="ml-1 h-3.5 w-3.5" />
                          ) : null}
                        </Button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pagedStatistics.map((stat, idx) => (
                  <tr key={`${stat.token}-${idx}`} className="border-b last:border-b-0">
                    {STATISTICS_COLUMNS.map((column) => {
                      const rawValue = (stat as Record<string, unknown>)?.[column.key];
                      const content = column.render ? column.render(rawValue, stat) : String(rawValue ?? '');
                      return (
                        <td key={`${column.key}-${idx}`} className={`px-2 py-1 whitespace-nowrap ${column.className ?? ''}`}>
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Label htmlFor="stats-rows-per-page" className="text-xs text-muted-foreground">Rows per page</Label>
              <Input
                id="stats-rows-per-page"
                type="number"
                min={5}
                max={200}
                value={statsRowsPerPage}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next >= 5 && next <= 200) {
                    onStatsRowsPerPageChange(next);
                  }
                }}
                className="h-8 w-20"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={safeStatsPage <= 1} onClick={() => onStatsPageChange(1)}>
                First
              </Button>
              <Button variant="outline" size="sm" disabled={safeStatsPage <= 1} onClick={() => onStatsPageChange(safeStatsPage - 1)}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">Page {safeStatsPage} / {statisticsPageCount}</span>
              <Button variant="outline" size="sm" disabled={safeStatsPage >= statisticsPageCount} onClick={() => onStatsPageChange(safeStatsPage + 1)}>
                Next
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={safeStatsPage >= statisticsPageCount}
                onClick={() => onStatsPageChange(statisticsPageCount)}
              >
                Last
              </Button>
            </div>
          </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No tokens match the current filter.</p>
          )}
        </div>
      )}
    </div>
  );
};
