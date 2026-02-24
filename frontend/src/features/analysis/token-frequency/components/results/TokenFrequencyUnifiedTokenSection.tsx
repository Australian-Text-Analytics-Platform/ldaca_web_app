import type { NodeResultView, NormalizedNodeResult } from '../../tokenFrequencyAdapters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, SortAsc, SortDesc } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
  statistics: _statistics,
  appliedStopSet: _appliedStopSet,
  effectiveTokenLimit,
  defaultTokenLimit,
  computeDisplayName: _computeDisplayName,
  getColorForNode,
  onDownloadWordCloud,
  onTokenClick,
  onTokenRightClick,
  unifiedCloudWidth: _unifiedCloudWidth,
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

  const unifiedRows = Array.from(
    new Map(
      normalizedNodeResults
        .flatMap((node) => node.rows || [])
        .map((row) => [row.token, row])
    ).values()
  ).slice(0, Math.max(10, Math.min(200, effectiveTokenLimit || defaultTokenLimit)));

  const maxUnifiedFrequency = Math.max(1, ...unifiedRows.map((row) => Number(row.frequency) || 0));

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
            <div className="flex flex-wrap gap-2">
              {unifiedRows.map((row, index) => {
                const frequency = Number(row.frequency) || 0;
                const ratio = Math.max(0.4, frequency / maxUnifiedFrequency);
                const fontSize = Math.round(11 + ratio * 18);
                const sourceNode =
                  (Array.isArray(row.node_ids) && row.node_ids[0]) ||
                  lastCompareNodeIds[index % Math.max(1, lastCompareNodeIds.length)] ||
                  nodeDisplayResults[index % Math.max(1, nodeDisplayResults.length)]?.nodeId ||
                  '';
                const color = sourceNode ? getColorForNode(sourceNode, index) : undefined;
                return (
                  <button
                    key={`unified-${row.token}-${index}`}
                    type="button"
                    className="inline-flex items-center rounded border px-2 py-1 font-medium hover:bg-muted"
                    style={{ fontSize, color }}
                    onClick={() => onTokenClick(row.token)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onTokenRightClick(row.token, event);
                    }}
                    title={`Frequency: ${frequency}`}
                  >
                    {row.token}
                  </button>
                );
              })}
            </div>

            <div className="h-0 w-0 overflow-hidden">
              <svg
                ref={(element) => registerWordCloudRef('unified', element)}
                xmlns="http://www.w3.org/2000/svg"
                width="1"
                height="1"
                viewBox="0 0 1 1"
              />
            </div>
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
