import React from 'react';
import type { TokenFrequencyResponse } from '@/api/text';
import HelpIcon from '@/components/help/HelpIcon';
import { AnalysisCardLayout } from '@/features/analysis/common/components/AnalysisCardLayout';
import { AnalysisRunningStateCard } from '@/features/analysis/common/components/AnalysisRunningStateCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wand2 } from 'lucide-react';
import type { NodeResultView, NormalizedNodeResult, TokenFrequencyStatisticsEntry } from '../../tokenFrequencyAdapters';
import { TokenFrequencySingleTokenSection } from '../results/TokenFrequencySingleTokenSection';
import { TokenFrequencyUnifiedTokenSection } from '../results/TokenFrequencyUnifiedTokenSection';

type RunningTask = {
  task_id: string;
  state?: string;
  message?: string;
  progress?: number;
  progress_message?: string;
};

type TokenFrequencyResultsPanelProps = {
  results: TokenFrequencyResponse | null;
  isRunning: boolean;
  runningTask?: RunningTask | null;

  stopWords: string;
  onStopWordsChange: React.Dispatch<React.SetStateAction<string>>;
  onStopWordsApply: () => void;
  isLoadingStopWords: boolean;
  onFillDefaultStopWords: () => void;

  tokenLimitInput: string;
  onTokenLimitInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onTokenLimitBlur: () => void;
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

  statsSortColumn: string;
  statsSortDirection: 'asc' | 'desc';
  onToggleStatsSort: (column: string) => void;
  sortedStatistics: TokenFrequencyStatisticsEntry[];
  statsRowsPerPage: number;
  statsPage: number;
  onStatsPageChange: (page: number) => void;
  onStatsRowsPerPageChange: (rows: number) => void;
  statsTokenFilter: string;
  onStatsTokenFilterChange: (value: string) => void;

  onDownloadFrequencyCsv: (label: string, rows: unknown[]) => void;
};

export const TokenFrequencyResultsPanel = ({
  results,
  isRunning,
  runningTask,
  stopWords,
  onStopWordsChange,
  onStopWordsApply,
  isLoadingStopWords,
  onFillDefaultStopWords,
  tokenLimitInput,
  onTokenLimitInputChange,
  onTokenLimitBlur,
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
  statsSortColumn,
  statsSortDirection,
  onToggleStatsSort,
  sortedStatistics,
  statsRowsPerPage,
  statsPage,
  onStatsPageChange,
  onStatsRowsPerPageChange,
  statsTokenFilter,
  onStatsTokenFilterChange,
  onDownloadFrequencyCsv,
}: TokenFrequencyResultsPanelProps) => {
  const isRunningState = isRunning;
  const isFailedState = results?.state === 'failed' && !isRunningState;
  const isSuccessfulState = results?.state === 'successful' && !isRunningState;

  if (!isRunningState && !results) {
    return null;
  }

  const runningMessage =
    runningTask?.progress_message || runningTask?.message || 'Running token frequency analysis…';
  const runningTaskId = runningTask?.task_id;
  const runningProgress = typeof runningTask?.progress === 'number' ? runningTask.progress : null;
  const cardTone: 'default' | 'error' = isFailedState ? 'error' : 'default';

  return (
    <AnalysisCardLayout
      title="Token Frequency Results"
      tone={cardTone}
      help={{
        targetKey: 'analysis.token-frequency.results',
        label: 'Token frequency results',
        tooltip: 'Shows running progress, failures, and final token frequency outputs.',
      }}
    >
      {isRunningState ? (
        <AnalysisRunningStateCard message={runningMessage} taskId={runningTaskId} progress={runningProgress} />
      ) : null}

      {isFailedState ? (
        <p className="text-sm text-muted-foreground">{results?.message || 'Analysis failed to complete.'}</p>
      ) : null}

      {isSuccessfulState && results ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="stop-words">Stop words filter ({appliedStopCount})</Label>
                <HelpIcon
                  targetKey="analysis.token-frequency.stop-words"
                  label="Stop words"
                  tooltip="Words entered here are removed from the displayed token tables and comparison views after a run completes."
                />
              </div>
              <textarea
                id="stop-words"
                rows={4}
                value={stopWords}
                onChange={(event) => onStopWordsChange(event.target.value)}
                onBlur={onStopWordsApply}
                placeholder="the, and, of"
                disabled={isLoadingStopWords}
                className="w-full resize-y overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onStopWordsApply}
                  disabled={isLoadingStopWords}
                >
                  Apply Stop Words
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onFillDefaultStopWords}
                  disabled={isLoadingStopWords}
                >
                  Fill Default
                </Button>
                <HelpIcon
                  targetKey="analysis.token-frequency.stop-words"
                  label="About default stop words"
                  tooltip="Fill Default loads the bundled English stop-word list shipped with the app. You can edit that list before or after applying it. Click to open the tutorial."
                  className="h-5 w-5 text-muted-foreground"
                />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="token-limit">Token display limit</Label>
                <HelpIcon
                  targetKey="analysis.token-frequency.token-limit"
                  label="Token display limit"
                  tooltip="Limits how many top tokens are shown per table after the analysis has finished."
                />
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="token-limit"
                  type="number"
                  min={1}
                  value={tokenLimitInput}
                  onChange={onTokenLimitInputChange}
                  onBlur={onTokenLimitBlur}
                />
                <Button type="button" variant="outline" size="sm" onClick={onTokenLimitBlur} disabled={isApplyingTokenLimit}>
                  <Wand2 className="mr-1 h-3.5 w-3.5" />
                  Apply
                </Button>
              </div>
              {tokenLimitError ? (
                <p className="text-xs text-destructive">{tokenLimitError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Currently displaying top {effectiveTokenLimit} tokens per table (default: {defaultTokenLimit}).
                </p>
              )}
            </div>
          </div>

          <TokenFrequencySingleTokenSection
            nodeDisplayResults={nodeDisplayResults}
            getColorForNode={getColorForNode}
            onTokenClick={onTokenClick}
            onTokenRightClick={onTokenRightClick}
            onDownloadFrequencyCsv={onDownloadFrequencyCsv}
            onDownloadWordCloud={onDownloadWordCloud}
            registerWordCloudRef={registerWordCloudRef}
          />

          <TokenFrequencyUnifiedTokenSection
            normalizedNodeResults={normalizedNodeResults}
            nodeDisplayResults={nodeDisplayResults}
            lastCompareNodeIds={lastCompareNodeIds}
            statistics={results?.statistics}
            appliedStopSet={appliedStopSet}
            statsSortColumn={statsSortColumn}
            statsSortDirection={statsSortDirection}
            onToggleStatsSort={onToggleStatsSort}
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
            statsRowsPerPage={statsRowsPerPage}
            onStatsRowsPerPageChange={onStatsRowsPerPageChange}
            statsPage={statsPage}
            onStatsPageChange={onStatsPageChange}
            onDownloadFrequencyCsv={onDownloadFrequencyCsv}
            statsTokenFilter={statsTokenFilter}
            onStatsTokenFilterChange={onStatsTokenFilterChange}
          />
        </div>
      ) : null}
    </AnalysisCardLayout>
  );
};
