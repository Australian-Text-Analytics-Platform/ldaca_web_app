import React from 'react';
import type { TokenFrequencyResponse } from '@/api';
import HelpIcon from '@/components/help/HelpIcon';
import { AnalysisCardLayout } from '@/features/views/common/components/AnalysisCardLayout';
import { AnalysisRunningStateCard } from '@/features/views/common/components/AnalysisRunningStateCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Wand2 } from 'lucide-react';
import type { NodeResultView, NormalizedNodeResult } from '../../tokenFrequencyAdapters';

import { TokenFrequencySingleTokenSection } from '../results/TokenFrequencySingleTokenSection';
import { TokenFrequencyUnifiedTokenSection } from '../results/TokenFrequencyUnifiedTokenSection';
import { useTokenFrequencyListLimit } from '../../hooks/useTokenFrequencyListLimit';

type ResultsView = 'cloud' | 'list';

interface RunningTask {
  task_id: string;
  state?: string;
  message?: string;
  progress?: number;
  progress_message?: string;
}

interface TokenFrequencyResultsPanelProps {
  results: TokenFrequencyResponse | null;
  isRunning: boolean;
  runningTask?: RunningTask | null;

  stopWords: string;
  onStopWordsChange: React.Dispatch<React.SetStateAction<string>>;
  onStopWordsApply: () => void;
  isLoadingStopWords: boolean;
  onFillDefaultStopWords: () => void;
  onSortStopWords: () => void;

  tokenLimitInput: string;
  onTokenLimitInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onTokenLimitBlur: () => void;
  /** Programmatic apply of cloud-side token limit (used when the list-side
   *  limit changes and needs to mirror to the cloud limit). */
  applyCloudTokenLimit: (value: number) => Promise<void> | void;
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
  // Optional second arg scopes the concordance handoff to a single data block;
  // omitted by the unified cloud and statistics table (both-node handoff).
  onTokenClick: (token: string, nodeId?: string) => void;
  onTokenRightClick: (token: string, event?: React.MouseEvent) => void;

  unifiedCloudWidth: number;
  unifiedCloudHeight: number;
  unifiedCloudContainerRef: React.RefObject<HTMLDivElement | null>;
  registerWordCloudRef: (nodeKey: string, element: SVGSVGElement | null) => void;

  onDownloadFrequencyCsv: (label: string, rows: unknown[]) => void;
}

/**
 * Rendered by: TokenFrequencyFeature to show running status, controls, and token-frequency result sections because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
export const TokenFrequencyResultsPanel = ({
  results,
  isRunning,
  runningTask,
  stopWords,
  onStopWordsChange,
  onStopWordsApply,
  isLoadingStopWords,
  onFillDefaultStopWords,
  onSortStopWords,
  tokenLimitInput,
  onTokenLimitInputChange,
  onTokenLimitBlur,
  applyCloudTokenLimit,
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
}: TokenFrequencyResultsPanelProps) => {
  const isRunningState = isRunning;
  const isFailedState = results?.state === 'failed' && !isRunningState;
  const isSuccessfulState = results?.state === 'successful' && !isRunningState;
  const [resultsView, setResultsView] = React.useState<ResultsView>('cloud');
  // Token wildcard filter (list view only). Lives here so it applies to all
  // three list-view cards (left list, right list, and the statistics table)
  // simultaneously.
  const [listTokenFilter, setListTokenFilter] = React.useState<string>('');
  const {
    globalMaxVocab,
    listLimit,
    listLimitInput,
    listLimitError,
    handleListLimitInputChange,
    handleApplyListLimit,
    handleApplyCloudLimit,
  } = useTokenFrequencyListLimit({
    nodeDisplayResults,
    effectiveTokenLimit,
    tokenLimitInput,
    onTokenLimitBlur,
    applyCloudTokenLimit,
  });

  if (!isRunningState && !results) {
    return null;
  }

  const runningMessage =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty progress_message/message should fall back to the next source, not render blank
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
        <AnalysisRunningStateCard
          message={runningMessage}
          taskId={runningTaskId}
          progress={runningProgress}
        />
      ) : null}

      {isFailedState ? (
        <p className="text-sm text-muted-foreground">
          {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty failure message should fall back to the default text, not render blank */}
          {results.message || 'Analysis failed to complete.'}
        </p>
      ) : null}

      {isSuccessfulState ? (
        <div className="space-y-4">
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
                onChange={(event) => {
                  onStopWordsChange(event.target.value);
                }}
                onBlur={onStopWordsApply}
                placeholder="the, and, of"
                disabled={isLoadingStopWords}
                className="w-full resize-y overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
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
                  Add Default
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onSortStopWords}
                  disabled={isLoadingStopWords || !stopWords.trim()}
                >
                  Sort
                </Button>
                <HelpIcon
                  targetKey="analysis.token-frequency.stop-words"
                  label="About default stop words"
                  tooltip="Add Default opens a dialog where you pick a language (a guess is pre-selected from the column's text) whose default stop words are appended to your current list. Add bags from several languages and edit the list before or after applying. Click to open the tutorial."
                  className="h-5 w-5 text-muted-foreground"
                />
              </div>
            </div>

            <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="token-limit">Cloud display limit (10–100)</Label>
                  <HelpIcon
                    targetKey="analysis.token-frequency.token-limit"
                    label="Cloud display limit"
                    tooltip="Maximum number of tokens shown in the word cloud (10–100). Setting this also updates the list display limit to the same value."
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id="token-limit"
                    type="number"
                    min={10}
                    max={100}
                    value={tokenLimitInput}
                    onChange={onTokenLimitInputChange}
                    onBlur={handleApplyCloudLimit}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleApplyCloudLimit();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleApplyCloudLimit}
                    disabled={isApplyingTokenLimit}
                  >
                    <Wand2 className="mr-1 h-3.5 w-3.5" />
                    Apply
                  </Button>
                </div>
                {tokenLimitError ? (
                  <p className="text-xs text-destructive">{tokenLimitError}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="list-limit">List display limit (10 – {globalMaxVocab})</Label>
                  <HelpIcon
                    targetKey="analysis.token-frequency.list-limit"
                    label="List display limit"
                    tooltip="Maximum number of tokens shown in the list view (10–vocabulary size). Values up to 100 stay in sync with the cloud display limit; larger values keep the cloud capped at 100."
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id="list-limit"
                    type="number"
                    min={10}
                    max={globalMaxVocab}
                    value={listLimitInput}
                    onChange={handleListLimitInputChange}
                    onBlur={handleApplyListLimit}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleApplyListLimit();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={handleApplyListLimit}>
                    <Wand2 className="mr-1 h-3.5 w-3.5" />
                    Apply
                  </Button>
                </div>
                {listLimitError ? (
                  <p className="text-xs text-destructive">{listLimitError}</p>
                ) : null}
              </div>
            </div>
          </div>

          <Tabs
            value={resultsView}
            onValueChange={(value) => {
              setResultsView(value as ResultsView);
            }}
            data-testid="token-frequency-results-view-tabs"
          >
            <TabsList>
              <TabsTrigger value="cloud">Cloud view</TabsTrigger>
              <TabsTrigger value="list">List view</TabsTrigger>
            </TabsList>
          </Tabs>

          <TokenFrequencySingleTokenSection
            nodeDisplayResults={nodeDisplayResults}
            getColorForNode={getColorForNode}
            onTokenClick={onTokenClick}
            onTokenRightClick={onTokenRightClick}
            onDownloadFrequencyCsv={onDownloadFrequencyCsv}
            onDownloadWordCloud={onDownloadWordCloud}
            registerWordCloudRef={registerWordCloudRef}
            view={resultsView}
            tokenFilter={listTokenFilter}
            listLimit={listLimit}
          />

          {resultsView === 'list' ? (
            <div className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold">Filter tokens</h4>
                  <HelpIcon
                    targetKey="analysis.token-frequency.token-filter"
                    label="Token filter"
                    tooltip="Filter the list views and statistics table by token. Use * as a wildcard (e.g. pre* or *ing). Does not affect the word cloud view."
                  />
                </div>
                <div className="flex flex-1 items-center gap-2 sm:max-w-md">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Filter tokens (use * as wildcard, e.g. pre* or *ing)"
                    value={listTokenFilter}
                    onChange={(event) => {
                      setListTokenFilter(event.target.value);
                    }}
                    className="h-8"
                  />
                  {listTokenFilter ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setListTokenFilter('');
                      }}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

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
            onDownloadFrequencyCsv={onDownloadFrequencyCsv}
            view={resultsView}
            tokenFilter={listTokenFilter}
          />
        </div>
      ) : null}
    </AnalysisCardLayout>
  );
};
