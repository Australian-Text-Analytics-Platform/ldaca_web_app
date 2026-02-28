import type { NodeResultView, NormalizedNodeResult } from '../../tokenFrequencyAdapters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, SortAsc, SortDesc } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Wordcloud } from '@visx/wordcloud';
import { Text } from '@visx/text';

type TokenFrequencyUnifiedTokenSectionProps = {
  normalizedNodeResults: NormalizedNodeResult[];
  nodeDisplayResults: NodeResultView[];
  lastCompareNodeIds: string[];
  statistics: any[] | null | undefined;
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
  sortedStatistics: any[];
  statsSortColumn: string;
  statsSortDirection: 'asc' | 'desc';
  onToggleStatsSort: (column: string) => void;
  statsPage: number;
  onStatsPageChange: (page: number) => void;
  statsRowsPerPage: number;
  onStatsRowsPerPageChange: (rows: number) => void;
  onDownloadFrequencyCsv: (label: string, rows: any[]) => void;
};

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
}: TokenFrequencyUnifiedTokenSectionProps) => {
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
    .filter((s: any) => !appliedStopSet.has(String(s?.token ?? '').toLowerCase()))
    .map((s: any) => ({
      token: String(s?.token ?? ''),
      o1: Number(s?.freq_corpus_0) || 0,
      o2: Number(s?.freq_corpus_1) || 0,
      p1: Number(s?.percent_corpus_0) || 0,
      p2: Number(s?.percent_corpus_1) || 0,
      logratio: Number(s?.log_ratio) || 0,
    }))
    .map((s: any) => ({
      ...s,
      total: s.o1 + s.o2,
      juxRank: (s.o1 + s.o2) > 0 ? Math.log10(s.o1 + s.o2) * (s.logratio || 0) : 0,
    }))
    .filter((s: any) => s.token.length > 0 && s.total > 10);

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
            <CardTitle className="text-base font-semibold">Unified tokens</CardTitle>
            <Button variant="outline" size="sm" onClick={() => onDownloadWordCloud('unified', 'Unified tokens')}>
              <Download className="mr-2 h-4 w-4" />
              Cloud
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
              <p className="text-sm text-muted-foreground">Unified cloud appears when two node results and comparative statistics are available.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {sortedStatistics.length > 0 && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">Keyness statistics</h4>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDownloadFrequencyCsv('token-keyness', sortedStatistics)}
            >
              <Download className="mr-2 h-4 w-4" />
              Export stats (CSV)
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-200 border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  {[
                    ['token', 'Token'],
                    ['freq_corpus_0', 'Freq A'],
                    ['freq_corpus_1', 'Freq B'],
                    ['log_likelihood_llv', 'LogL'],
                    ['log_ratio', 'Log Ratio'],
                  ].map(([column, label]) => {
                    const isActive = statsSortColumn === column;
                    return (
                      <th key={column} className="px-2 py-2">
                        <Button variant="ghost" size="sm" className="h-auto px-0" onClick={() => onToggleStatsSort(column)}>
                          {label}
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
                    <td className="px-2 py-1 font-medium">{stat.token}</td>
                    <td className="px-2 py-1 tabular-nums">{stat.freq_corpus_0}</td>
                    <td className="px-2 py-1 tabular-nums">{stat.freq_corpus_1}</td>
                    <td className="px-2 py-1 tabular-nums">{stat.log_likelihood_llv}</td>
                    <td className="px-2 py-1 tabular-nums">{stat.log_ratio}</td>
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
              <Button variant="outline" size="sm" disabled={safeStatsPage <= 1} onClick={() => onStatsPageChange(safeStatsPage - 1)}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">Page {safeStatsPage} / {statisticsPageCount}</span>
              <Button variant="outline" size="sm" disabled={safeStatsPage >= statisticsPageCount} onClick={() => onStatsPageChange(safeStatsPage + 1)}>
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
