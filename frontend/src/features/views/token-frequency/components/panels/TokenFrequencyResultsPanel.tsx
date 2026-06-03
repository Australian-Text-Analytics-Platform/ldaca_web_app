import React from 'react';
import type { TokenFrequencyResponse } from '@/api/generated/types.gen';
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

type ResultsView = 'cloud' | 'list';

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
  onTokenClick: (token: string) => void;
  onTokenRightClick: (token: string, event?: React.MouseEvent) => void;

  unifiedCloudWidth: number;
  unifiedCloudHeight: number;
  unifiedCloudContainerRef: React.RefObject<HTMLDivElement | null>;
  registerWordCloudRef: (nodeKey: string, element: SVGSVGElement | null) => void;

  onDownloadFrequencyCsv: (label: string, rows: unknown[]) => void;
};

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

  // Maximum vocabulary across all node results (full filtered list, ignoring
  // the cloud display limit). Used to cap the List display limit. Falls back
  // to 10 so the input always has a sensible upper bound.
  const globalMaxVocab = React.useMemo(() => {
    let max = 0;
    for (const node of nodeDisplayResults) {
      const filtered = Array.isArray(node.filteredRows) ? node.filteredRows.length : 0;
      const raw = Array.isArray(node.rows) ? node.rows.length : 0;
      if (filtered > max) max = filtered;
      if (raw > max) max = raw;
    }
    return Math.max(max, 10);
  }, [nodeDisplayResults]);

  // List display limit is UI-only (not persisted to the backend). Cloud
  // display limit is the existing backend-persisted value
  // (`effectiveTokenLimit`). Sync rule: changes mirror across both, with the
  // cloud limit capped at 100. So setting list to 150 → list = 150, cloud = 100.
  // Setting cloud to 50 → both = 50.
  const [listLimit, setListLimit] = React.useState<number>(0);
  const [listLimitInput, setListLimitInput] = React.useState<string>('');
  const [listLimitError, setListLimitError] = React.useState<string | null>(null);
  // Mirror the cloud limit into the list limit whenever the cloud limit
  // changes, *unless* the user has explicitly pushed the list above 100
  // (the cloud cap). Once list > 100 the two values diverge by design.
  React.useEffect(() => {
    if (!Number.isFinite(effectiveTokenLimit) || effectiveTokenLimit <= 0) return;
    void Promise.resolve().then(() => {
      setListLimit((prev) => {
        if (prev > 100) return prev;
        return effectiveTokenLimit;
      });
      setListLimitInput((prev) => {
        const prevNum = Number.parseInt(prev, 10);
        if (Number.isFinite(prevNum) && prevNum > 100) return prev;
        return String(effectiveTokenLimit);
      });
    });
  }, [effectiveTokenLimit]);

  /** Called by: TokenFrequencyResultsPanel list-limit input to capture edits and clear stale errors because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
  const handleListLimitInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setListLimitInput(event.target.value);
    if (listLimitError) setListLimitError(null);
  };

  /**
   * Called by: TokenFrequencyResultsPanel list-limit Apply button and blur handler because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
   * Flow: parse the list-limit input, clamp it to the visible vocabulary range, clear validation errors, then mirror the capped value to cloud preferences when needed.
   */
  const handleApplyListLimit = () => {
    const parsed = Number.parseInt(listLimitInput, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setListLimitError('Enter a whole number greater than zero.');
      return;
    }
    const clamped = Math.max(10, Math.min(parsed, globalMaxVocab));
    setListLimit(clamped);
    setListLimitInput(String(clamped));
    setListLimitError(null);
    // Mirror to cloud, capped at 100. Skip the call if it's already that value.
    const cloudTarget = Math.min(clamped, 100);
    if (cloudTarget !== effectiveTokenLimit) {
      void applyCloudTokenLimit(cloudTarget);
    }
  };

  // Wrap cloud apply so that applying the cloud value also mirrors it down
  // to the list limit (cloud is always ≤ 100, so the two stay in lockstep
  // whenever the user touches the cloud input).
  /** Called by: TokenFrequencyResultsPanel cloud-limit Apply button, blur handler, and Enter key because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules. */
  const handleApplyCloudLimit = () => {
    const parsed = Number.parseInt(tokenLimitInput, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      const cloudClamped = Math.max(10, Math.min(parsed, 100));
      setListLimit(cloudClamped);
      setListLimitInput(String(cloudClamped));
      setListLimitError(null);
    }
    onTokenLimitBlur();
  };

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
        <AnalysisRunningStateCard
          message={runningMessage}
          taskId={runningTaskId}
          progress={runningProgress}
        />
      ) : null}

      {isFailedState ? (
        <p className="text-sm text-muted-foreground">
          {results?.message || 'Analysis failed to complete.'}
        </p>
      ) : null}

      {isSuccessfulState && results ? (
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
                onChange={(event) => onStopWordsChange(event.target.value)}
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
                  Fill Default
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
                  tooltip="Fill Default opens a dialog where you pick the language (a guess is pre-selected from the column's text) whose default stop words to load. You can edit the list before or after applying it. Click to open the tutorial."
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
            onValueChange={(value) => setResultsView(value as ResultsView)}
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
                    onChange={(event) => setListTokenFilter(event.target.value)}
                    className="h-8"
                  />
                  {listTokenFilter ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setListTokenFilter('')}
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
            statistics={results?.statistics}
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
