import HelpIcon from '@/components/help/HelpIcon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, RotateCcw, Wand2 } from 'lucide-react';
import type { TokenFrequencyResponse } from '@/api/text';
import type { NodeResultView, NormalizedNodeResult } from '../../tokenFrequencyAdapters';
import { TokenFrequencySingleTokenSection } from '../results/TokenFrequencySingleTokenSection';
import { TokenFrequencyUnifiedTokenSection } from '../results/TokenFrequencyUnifiedTokenSection';

type TokenFrequencyResultsPanelProps = {
  results: TokenFrequencyResponse | null;
  stopWords: string;
  onStopWordsChange: (value: string) => void;
  onStopWordsApply: () => void;
  isLoadingStopWords: boolean;
  onFillDefaultStopWords: () => void;
  tokenLimitInput: string;
  onTokenLimitInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onTokenLimitBlur: () => void;
  onTokenLimitKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  tokenLimitError: string | null;
  isApplyingTokenLimit: boolean;
  appliedStopCount: number;
  normalizedNodeResults: NormalizedNodeResult[];
  nodeDisplayResults: NodeResultView[];
  lastCompareNodeIds: string[];
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
  onDownloadFrequencyCsv: (label: string, rows: any[]) => void;
  sortedStatistics: any[];
  statsSortColumn: string;
  statsSortDirection: 'asc' | 'desc';
  onToggleStatsSort: (column: string) => void;
  statsPage: number;
  onStatsPageChange: (page: number) => void;
  statsRowsPerPage: number;
  onStatsRowsPerPageChange: (rows: number) => void;
};

export const TokenFrequencyResultsPanel = ({
  results,
  stopWords,
  onStopWordsChange,
  onStopWordsApply,
  isLoadingStopWords,
  onFillDefaultStopWords,
  tokenLimitInput,
  onTokenLimitInputChange,
  onTokenLimitBlur,
  onTokenLimitKeyDown,
  tokenLimitError,
  isApplyingTokenLimit,
  appliedStopCount,
  normalizedNodeResults,
  nodeDisplayResults,
  lastCompareNodeIds,
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
  sortedStatistics,
  statsSortColumn,
  statsSortDirection,
  onToggleStatsSort,
  statsPage,
  onStatsPageChange,
  statsRowsPerPage,
  onStatsRowsPerPageChange,
}: TokenFrequencyResultsPanelProps) => {
  if (!results) {
    return null;
  }

  if (results.state === 'failed') {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Token Frequency Analysis Failed</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{results.message || 'Analysis failed to complete.'}</p>
        </CardContent>
      </Card>
    );
  }

  if (results.state !== 'successful') {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Results
          <Badge variant="outline">{normalizedNodeResults.length} node{normalizedNodeResults.length === 1 ? '' : 's'}</Badge>
          <HelpIcon targetKey="analysis.token-frequency.results" label="Token frequency results" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="token-limit-input">Token limit</Label>
              <HelpIcon targetKey="analysis.token-frequency.token-limit" label="Token limit" />
            </div>
            <Input
              id="token-limit-input"
              value={tokenLimitInput}
              onChange={onTokenLimitInputChange}
              onBlur={onTokenLimitBlur}
              onKeyDown={onTokenLimitKeyDown}
              inputMode="numeric"
              aria-invalid={!!tokenLimitError}
              disabled={isApplyingTokenLimit}
            />
            {tokenLimitError ? <p className="text-xs text-destructive">{tokenLimitError}</p> : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="stop-words-input">Stop words</Label>
              <HelpIcon targetKey="analysis.token-frequency.stop-words" label="Stop words" />
            </div>
            <Input
              id="stop-words-input"
              value={stopWords}
              onChange={(event) => onStopWordsChange(event.target.value)}
              onBlur={onStopWordsApply}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onStopWordsApply();
                }
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onFillDefaultStopWords} disabled={isLoadingStopWords}>
                {isLoadingStopWords ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                Default stop words
              </Button>
              <Button variant="outline" size="sm" onClick={() => { onStopWordsChange(''); onStopWordsApply(); }}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Clear stop words
              </Button>
            </div>
            {appliedStopCount > 0 && (
              <p className="text-xs text-muted-foreground">Filtering out {appliedStopCount} stop word{appliedStopCount === 1 ? '' : 's'}.</p>
            )}
          </div>
        </div>

        <TokenFrequencySingleTokenSection
          nodeDisplayResults={nodeDisplayResults}
          getColorForNode={getColorForNode}
          onTokenClick={onTokenClick}
          onTokenRightClick={onTokenRightClick}
          onDownloadWordCloud={onDownloadWordCloud}
          onDownloadFrequencyCsv={onDownloadFrequencyCsv}
          registerWordCloudRef={registerWordCloudRef}
        />

        <TokenFrequencyUnifiedTokenSection
          normalizedNodeResults={normalizedNodeResults}
          nodeDisplayResults={nodeDisplayResults}
          lastCompareNodeIds={lastCompareNodeIds}
          statistics={results.statistics}
          appliedStopSet={appliedStopSet}
          effectiveTokenLimit={effectiveTokenLimit}
          defaultTokenLimit={defaultTokenLimit}
          computeDisplayName={computeDisplayName}
          getColorForNode={getColorForNode}
          onDownloadWordCloud={onDownloadWordCloud}
          onTokenClick={onTokenClick}
          onTokenRightClick={onTokenRightClick}
          unifiedCloudWidth={unifiedCloudWidth}
          unifiedCloudHeight={unifiedCloudHeight}
          unifiedCloudContainerRef={unifiedCloudContainerRef}
          registerWordCloudRef={registerWordCloudRef}
          sortedStatistics={sortedStatistics}
          statsSortColumn={statsSortColumn}
          statsSortDirection={statsSortDirection}
          onToggleStatsSort={onToggleStatsSort}
          statsPage={statsPage}
          onStatsPageChange={onStatsPageChange}
          statsRowsPerPage={statsRowsPerPage}
          onStatsRowsPerPageChange={onStatsRowsPerPageChange}
          onDownloadFrequencyCsv={onDownloadFrequencyCsv}
        />
      </CardContent>
    </Card>
  );
};
