import React, { useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Plus } from 'lucide-react';
import { TopicModelingBubbleChartSection } from '../results/TopicModelingBubbleChartSection';
import { TopicModelingDetachDialog } from '../results/TopicModelingDetachDialog';
import { AppliedStopwordsDialog } from '../results/AppliedStopwordsDialog';
import { AnalysisCardLayout } from '@/features/analysis/common/components/AnalysisCardLayout';
import { AnalysisRunningStateCard } from '@/features/analysis/common/components/AnalysisRunningStateCard';
import type { ZoomDomain } from '../../topicModelingAdapters';

type TopicModelingTopic = { id: number; label: string; size: number[]; total_size: number; x: number; y: number };
type TopicModelingResult = {
  state?: string;
  data?: {
    topics: TopicModelingTopic[];
    corpus_sizes?: number[];
    meta?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
  message?: string;
} | null;

type ExactTopicCountSliderProps = {
  currentExactTopicCount?: number | null;
  exactTopicCountRange: { min: number; max: number };
  isUpdatingExactTopicCount: boolean;
  onUpdateExactTopicCount: (value: number) => Promise<void> | void;
};

function ExactTopicCountSlider({
  currentExactTopicCount,
  exactTopicCountRange,
  isUpdatingExactTopicCount,
  onUpdateExactTopicCount,
}: ExactTopicCountSliderProps) {
  const initialValue = currentExactTopicCount ?? exactTopicCountRange.min;
  const [sliderValue, setSliderValue] = useState(initialValue);
  const lastSubmittedValueRef = useRef<number | null>(null);
  const [isSliderTooltipVisible, setIsSliderTooltipVisible] = useState(false);

  const sliderDenominator = Math.max(1, exactTopicCountRange.max - exactTopicCountRange.min);
  const sliderProgressPercent =
    ((sliderValue - exactTopicCountRange.min) / sliderDenominator) * 100;

  const commitExactTopicCount = (rawValue: string, input?: HTMLInputElement | null) => {
    const parsed = Number(rawValue);
    const nextValue = Math.min(
      exactTopicCountRange.max,
      Math.max(
        exactTopicCountRange.min,
        Number.isFinite(parsed) ? Math.round(parsed) : exactTopicCountRange.min,
      ),
    );
    setSliderValue(nextValue);
    if (input) {
      input.value = String(nextValue);
    }
    if (nextValue === currentExactTopicCount || nextValue === lastSubmittedValueRef.current) return;
    lastSubmittedValueRef.current = nextValue;
    void onUpdateExactTopicCount(nextValue);
  };

  const handleExactTopicCountKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      return;
    }
    commitExactTopicCount(event.currentTarget.value, event.currentTarget);
  };

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-3">
      <div className="pointer-events-none absolute bottom-full right-0 mb-1 flex min-h-5 items-center justify-end gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Loader2 className={`h-3.5 w-3.5 animate-spin ${isUpdatingExactTopicCount ? 'opacity-100' : 'opacity-0'}`} />
          <span className={isUpdatingExactTopicCount ? 'opacity-100' : 'opacity-0'}>Re-aggregating</span>
        </span>
      </div>
      <span className="shrink-0 text-sm font-medium text-foreground">Exact Topic No.</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {exactTopicCountRange.min}
      </span>
      <div className="relative flex min-w-28 flex-1 items-center">
        {isSliderTooltipVisible ? (
          <div
            aria-live="polite"
            className="pointer-events-none absolute bottom-full z-10 mb-2 rounded border border-border bg-popover px-2 py-1 text-xs font-medium tabular-nums text-popover-foreground shadow-sm"
            style={{ left: `${sliderProgressPercent}%`, transform: 'translateX(-50%)' }}
          >
            {sliderValue}
          </div>
        ) : null}
        <input
          id="exact-topic-count"
          aria-label="Exact Topic No. after modelling"
          type="range"
          min={exactTopicCountRange.min}
          max={exactTopicCountRange.max}
          step={1}
          value={sliderValue}
          disabled={isUpdatingExactTopicCount}
          className="h-2 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
          onChange={(event) => setSliderValue(Math.round(Number(event.currentTarget.value)))}
          onFocus={() => setIsSliderTooltipVisible(true)}
          onBlur={(event) => {
            setIsSliderTooltipVisible(false);
            commitExactTopicCount(event.currentTarget.value, event.currentTarget);
          }}
          onMouseDown={() => setIsSliderTooltipVisible(true)}
          onMouseUp={(event) => {
            setIsSliderTooltipVisible(false);
            commitExactTopicCount(event.currentTarget.value, event.currentTarget);
          }}
          onTouchStart={() => setIsSliderTooltipVisible(true)}
          onTouchEnd={(event) => {
            setIsSliderTooltipVisible(false);
            commitExactTopicCount(event.currentTarget.value, event.currentTarget);
          }}
          onKeyUp={handleExactTopicCountKeyUp}
        />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {exactTopicCountRange.max}
      </span>
    </div>
  );
}

type Props = {
  topicWaitingBanner: { status: 'running' | 'queued'; taskId: string | null; message?: string } | null;
  runningTask?: {
    task_id: string;
    state?: string;
    message?: string;
    progress?: number;
    started_at?: string | null;
  } | null;
  result: TopicModelingResult;
  error?: string | null;
  topics: TopicModelingTopic[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  isDetachLoading: boolean;
  isDetaching: boolean;
  openDetachDialog: () => Promise<void> | void;
  chartRef: React.RefObject<HTMLDivElement | null>;
  handleResetZoom: () => void;
  isAtGlobalZoom: boolean;
  bubbleElements: React.ReactNode;
  tooltip: { topic: TopicModelingTopic | null; x: number; y: number };
  renderSizeComposition: (size: number[] | undefined, totalSize?: number | null) => React.ReactNode;
  hoveredTopicId: number | null;
  setHoveredTopicId: React.Dispatch<React.SetStateAction<number | null>>;
  selectedTopicIds: Set<number>;
  onToggleTopicSelection: (id: number) => void;
  onClearSelection: () => void;
  topicSearchQuery: string;
  onTopicSearchQueryChange: (query: string) => void;
  activeDomain: ZoomDomain | null;
  nodeNames?: string[];
  topicSizeMode?: string;
  topicSizeValue?: number;
  /**
   * The exact topic count currently displayed by the post-fit re-aggregation
   * slider. Derived from `result.data.meta.topic_size_value`; decoupled from
   * the "Target Topic Number" parameter input (which is the next-rerun
   * target). `null` when no fit has happened yet.
   */
  currentExactTopicCount?: number | null;
  randomSeed?: number;
  exactTopicCountRange?: { min: number; max: number } | null;
  isUpdatingExactTopicCount: boolean;
  onUpdateExactTopicCount: (value: number) => Promise<void> | void;
  detachDialogOpen: boolean;
  setDetachDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  detachNodeOptions: Array<{ node_id: string; node_name: string; available_columns: string[]; disabled_columns?: string[] }>;
  selectedDetachColumns: Record<string, string[]>;
  toggleDetachColumn: (nodeId: string, column: string, checked: boolean) => void;
  selectAllDetachColumns: () => void;
  deselectAllDetachColumns: () => void;
  handleDetachConfirm: () => Promise<void> | void;
  /** Post-fit stopword filter wiring. ``available`` is false when the run's
   * resolved language doesn't have a bundled stopword list — the toggle
   * is hidden in that case rather than greyed out, since there's no
   * meaningful action available. */
  stopwordFilterAvailable: boolean;
  stopwordFilterEnabled: boolean;
  onStopwordFilterToggle: (enabled: boolean) => void;
  /** Aggregated label for the toggle copy — e.g. ``"ZH"`` for a single
   *  language, ``"EN + ZH"`` for two. ``undefined`` collapses the
   *  language suffix entirely so it reads "Hide stopwords". */
  stopwordFilterLanguage?: string;
  /** Flat set the filter actually applies. Surfaced so the "view list"
   *  link can show a count without re-deriving from groups. Empty /
   *  undefined hides the link without disabling the toggle. */
  stopwordFilterSet?: Set<string>;
  /** Per-language groups (matching the order requested by
   *  ``useDefaultStopwords``). The popup renders one chip block per
   *  group with the language label as a header. */
  stopwordFilterByLanguage?: ReadonlyArray<{
    language: string;
    words: ReadonlyArray<string>;
  }>;
};

export function TopicModelingResultsPanel({
  topicWaitingBanner,
  runningTask,
  error,
  result,
  topics,
  containerRef,
  isDetachLoading,
  isDetaching,
  openDetachDialog,
  chartRef,
  handleResetZoom,
  isAtGlobalZoom,
  bubbleElements,
  tooltip,
  renderSizeComposition,
  hoveredTopicId,
  setHoveredTopicId,
  selectedTopicIds,
  onToggleTopicSelection,
  onClearSelection,
  topicSearchQuery,
  onTopicSearchQueryChange,
  activeDomain,
  nodeNames,
  topicSizeMode,
  topicSizeValue,
  currentExactTopicCount,
  randomSeed,
  exactTopicCountRange,
  isUpdatingExactTopicCount,
  onUpdateExactTopicCount,
  detachDialogOpen,
  setDetachDialogOpen,
  detachNodeOptions,
  selectedDetachColumns,
  toggleDetachColumn,
  selectAllDetachColumns,
  deselectAllDetachColumns,
  stopwordFilterAvailable,
  stopwordFilterEnabled,
  onStopwordFilterToggle,
  stopwordFilterLanguage,
  stopwordFilterSet,
  stopwordFilterByLanguage,
  handleDetachConfirm,
}: Props) {
  const [isAppliedStopwordsDialogOpen, setIsAppliedStopwordsDialogOpen] = useState(false);
  const appliedStopwordsCount = stopwordFilterSet?.size ?? 0;
  const isRunningState = Boolean(topicWaitingBanner) || result?.state === 'running';
  const runningMessage = runningTask?.message || topicWaitingBanner?.message || result?.message || 'Task running';
  const runningTaskId = runningTask?.task_id || topicWaitingBanner?.taskId;
  const runningProgress = typeof runningTask?.progress === 'number' ? runningTask.progress : null;
  const isFailedState = result?.state === 'failed' && !isRunningState;
  const isErrorState = Boolean(error) && result?.state !== 'failed' && !isRunningState;
  const isSuccessfulState = result?.state === 'successful' && !isRunningState;

  const cardTone: 'default' | 'error' = isFailedState || isErrorState ? 'error' : 'default';
  const cardTitle = 'Topic Modeling Results';
  const helperConfig = {
    targetKey: 'analysis.topic-modeling.results',
    label: 'Topic modeling results',
    tooltip: 'Shows running progress, failures, and final topic modeling outputs.',
  };
  const showExactTopicCountControl = Boolean(
    isSuccessfulState &&
    topicSizeMode === 'exact' &&
    exactTopicCountRange &&
    exactTopicCountRange.max >= exactTopicCountRange.min
  );

  return (
    <>
      <AnalysisCardLayout
        cardRef={isSuccessfulState ? containerRef : undefined}
        title={cardTitle}
        tone={cardTone}
        help={helperConfig}
      >
        {isRunningState ? (
          <AnalysisRunningStateCard
            message={runningMessage}
            taskId={runningTaskId}
            progress={runningProgress}
            startedAt={runningTask?.started_at}
          />
        ) : null}

        {isFailedState ? (
          <p className="text-sm text-muted-foreground">{result.message || 'Topic modeling failed'}</p>
        ) : null}

        {isErrorState ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : null}

        {isSuccessfulState ? (
          <div className="space-y-4">
            <TopicModelingBubbleChartSection
              topics={topics}
              chartRef={chartRef}
              handleResetZoom={handleResetZoom}
              isAtGlobalZoom={isAtGlobalZoom}
              bubbleElements={bubbleElements}
              tooltip={tooltip}
              renderSizeComposition={renderSizeComposition}
              hoveredTopicId={hoveredTopicId}
              setHoveredTopicId={setHoveredTopicId}
              selectedTopicIds={selectedTopicIds}
              onToggleTopicSelection={onToggleTopicSelection}
              onClearSelection={onClearSelection}
              topicSearchQuery={topicSearchQuery}
              onTopicSearchQueryChange={onTopicSearchQueryChange}
              activeDomain={activeDomain}
              nodeNames={nodeNames}
              topicSizeMode={topicSizeMode}
              topicSizeValue={topicSizeValue}
              randomSeed={randomSeed}
              stopwordsByLanguage={stopwordFilterByLanguage}
              stopwordsFilterEnabled={stopwordFilterEnabled}
              controlRowSlot={
                <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-x-6">
                  <div className="flex shrink-0 items-center gap-3">
                    <p className="text-sm text-muted-foreground">Topics ({topics.length})</p>
                    {stopwordFilterAvailable ? (
                      <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                        <label className="inline-flex cursor-pointer select-none items-center gap-2">
                          <input
                            type="checkbox"
                            checked={stopwordFilterEnabled}
                            onChange={(e) => onStopwordFilterToggle(e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-input"
                          />
                          Hide {stopwordFilterLanguage ? `${stopwordFilterLanguage.toUpperCase()} ` : ''}stopwords
                        </label>
                        {appliedStopwordsCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => setIsAppliedStopwordsDialogOpen(true)}
                            className="cursor-pointer text-xs underline-offset-2 hover:underline"
                            aria-label={`View the ${appliedStopwordsCount} stopwords being filtered`}
                          >
                            (view list)
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {showExactTopicCountControl && exactTopicCountRange ? (
                    <ExactTopicCountSlider
                      key={currentExactTopicCount ?? exactTopicCountRange.min}
                      currentExactTopicCount={currentExactTopicCount}
                      exactTopicCountRange={exactTopicCountRange}
                      isUpdatingExactTopicCount={isUpdatingExactTopicCount}
                      onUpdateExactTopicCount={onUpdateExactTopicCount}
                    />
                  ) : (
                    <div className="hidden lg:block" />
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="w-full shrink-0 lg:w-auto"
                    onClick={() => void openDetachDialog()}
                    disabled={isDetachLoading || isDetaching || isUpdatingExactTopicCount}
                  >
                    {isDetachLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Preparing Add to Workspace…
                      </>
                    ) : selectedTopicIds.size > 0 ? (
                      <>
                        <Plus className="mr-2 h-4 w-4" />
                        {`Add to Workspace (${selectedTopicIds.size} topics)`}
                      </>
                    ) : (
                      <>
                        <Plus className="mr-2 h-4 w-4" />
                        Add to Workspace (all)
                      </>
                    )}
                  </Button>
                </div>
              }
            />
          </div>
        ) : null}
      </AnalysisCardLayout>

      <TopicModelingDetachDialog
        open={detachDialogOpen}
        onOpenChange={setDetachDialogOpen}
        isDetaching={isDetaching}
        detachNodeOptions={detachNodeOptions}
        selectedDetachColumns={selectedDetachColumns}
        toggleDetachColumn={toggleDetachColumn}
        selectAllDetachColumns={selectAllDetachColumns}
        deselectAllDetachColumns={deselectAllDetachColumns}
        handleDetachConfirm={handleDetachConfirm}
      />

      {appliedStopwordsCount > 0 ? (
        <AppliedStopwordsDialog
          open={isAppliedStopwordsDialogOpen}
          onClose={() => setIsAppliedStopwordsDialogOpen(false)}
          totalCount={appliedStopwordsCount}
          byLanguage={stopwordFilterByLanguage ?? []}
        />
      ) : null}
    </>
  );
}
