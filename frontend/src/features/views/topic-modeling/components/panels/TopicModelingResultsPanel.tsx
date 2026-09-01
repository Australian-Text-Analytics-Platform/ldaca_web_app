import { CircleHelp, LoaderCircle, Plus } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import type {
  TopicClustering,
  TopicInclusion,
  TopicModelingResponse,
  TopicModelingTopic,
} from '@/api';
import { Button } from '@/components/ui/button';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AnalysisCardLayout } from '@/features/views/common/components/AnalysisCardLayout';
import { AnalysisRunningStateCard } from '@/features/views/common/components/AnalysisRunningStateCard';
import { TopicModelingBubbleChartSection } from '../results/TopicModelingBubbleChartSection';
import { TopicModelingStopWordsControl } from '../TopicModelingStopWordsControl';

interface Props {
  topicWaitingBanner: {
    status: 'running' | 'queued';
    taskId: string | null;
    message?: string;
  } | null;
  runningTask?: {
    task_id: string;
    state?: string;
    message?: string;
    progress?: number;
    started_at?: string | null;
  } | null;
  result: TopicModelingResponse | null;
  error?: string | null;
  topics: TopicModelingTopic[];
  exportTopics?: TopicModelingTopic[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  selectedTopicIds: Set<number>;
  onToggleTopicSelection: (id: number) => void;
  onClearSelection: () => void;
  topicSearchQuery: string;
  onTopicSearchQueryChange: (query: string) => void;
  panelNodeIds: string[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  graphProjectionKey: string;
  onGraphViewReady: (projectionKey: string) => void;
  nodeNames?: string[];
  randomSeed?: number;
  onAddToWorkspace: () => void;
  isAddingToWorkspace: boolean;
  projectionPending: boolean;
  projectionError?: string | null;
  clustering: TopicClustering | null;
  topicInclusion: TopicInclusion | null;
  onClusterCountCommit: (value: number) => void;
  onTopNTopicsCommit: (value: number) => void;
  onProjectionRetry?: () => void;
  projectionControlResetKey?: number;
  wordsPerTopic?: number;
  onWordsPerTopicChange?: (value: number) => void;
  stopWordsEnabled: boolean;
  onStopWordsEnabledChange: (enabled: boolean) => void;
  stopWords: string[];
  stopWordsDetectionTarget: {
    workspaceId: string | null;
    nodeId: string | null;
    column: string | null;
  };
  onStopWordsChange: (words: string[]) => Promise<void>;
}

function ClusterCountControl({
  clustering,
  pending,
  error,
  onCommit,
  onRetry,
}: {
  clustering: TopicClustering;
  pending: boolean;
  error?: string | null;
  onCommit: (value: number) => void;
  onRetry?: () => void;
}) {
  const applied = clustering.cluster_count;
  const [value, setValue] = useState<number[]>([applied]);
  const [numberDraft, setNumberDraft] = useState(String(applied));
  const activePointerIdRef = useRef<number | null>(null);
  const latestDraftRef = useRef(applied);
  const latestCommitRef = useRef(applied);
  const displayedValue = value[0] ?? applied;

  const boundedTopicCount = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return Math.min(
      clustering.max_cluster_count,
      Math.max(clustering.min_cluster_count, Math.round(parsed)),
    );
  };

  const setTopicCountDraft = (next: number) => {
    latestDraftRef.current = next;
    setValue([next]);
    setNumberDraft(String(next));
  };

  const commitTopicCount = (next: number) => {
    if (next === applied || latestCommitRef.current === next) return;
    latestCommitRef.current = next;
    onCommit(next);
  };

  const commitNumberDraft = (raw: string) => {
    const next = boundedTopicCount(raw);
    if (next === null) {
      setTopicCountDraft(applied);
      return;
    }
    setTopicCountDraft(next);
    commitTopicCount(next);
  };

  useEffect(() => {
    const handleWindowBlur = () => {
      if (activePointerIdRef.current === null) return;
      activePointerIdRef.current = null;
      latestDraftRef.current = applied;
      setValue([applied]);
      setNumberDraft(String(applied));
    };
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [applied]);

  const rollBackPointerGesture = (pointerId: number) => {
    if (activePointerIdRef.current !== pointerId) return;
    activePointerIdRef.current = null;
    latestDraftRef.current = applied;
    setValue([applied]);
    setNumberDraft(String(applied));
  };

  return (
    <div className="grid min-w-0 gap-1 text-label-secondary text-description">
      <div className="flex items-center gap-3">
        <label htmlFor="topic-cluster-count" className="font-medium">
          Number of topics
        </label>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-label="Minimum number of topics"
          className="w-5 shrink-0 text-center tabular-nums text-foreground"
        >
          {clustering.min_cluster_count}
        </span>
        <div className="min-w-24 flex-1">
          {clustering.adjustable ? (
            <Slider
              id="topic-cluster-count"
              data-testid="topic-cluster-slider"
              aria-label="Number of topics"
              min={clustering.min_cluster_count}
              max={clustering.max_cluster_count}
              step={1}
              value={value}
              disabled={pending}
              onPointerDown={(event) => {
                if (pending) return;
                activePointerIdRef.current = event.pointerId;
                latestDraftRef.current = displayedValue;
              }}
              onPointerUp={(event) => {
                if (activePointerIdRef.current !== event.pointerId) return;
                activePointerIdRef.current = null;
                commitTopicCount(latestDraftRef.current);
              }}
              onPointerCancel={(event) => {
                rollBackPointerGesture(event.pointerId);
              }}
              onLostPointerCapture={(event) => {
                rollBackPointerGesture(event.pointerId);
              }}
              onValueChange={(nextValue) => {
                const next = nextValue[0] ?? applied;
                setTopicCountDraft(next);
                if (activePointerIdRef.current === null) commitTopicCount(next);
              }}
            />
          ) : (
            <input
              id="topic-cluster-count"
              aria-label="Number of topics"
              type="range"
              min={clustering.cluster_count}
              max={clustering.cluster_count}
              value={clustering.cluster_count}
              disabled
              readOnly
              className="h-4 w-full accent-primary disabled:opacity-50"
            />
          )}
        </div>
        <input
          id="topic-cluster-count-input"
          aria-label="Number of topics"
          type="number"
          min={clustering.min_cluster_count}
          max={clustering.max_cluster_count}
          step={1}
          value={numberDraft}
          disabled={pending || !clustering.adjustable}
          className="h-9 w-16 shrink-0 rounded-md border border-input-border bg-editor px-2 text-right text-body tabular-nums disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(event) => {
            const raw = event.target.value;
            setNumberDraft(raw);
            if (raw.trim() === '') return;
            const next = boundedTopicCount(raw);
            if (next === null) return;
            latestDraftRef.current = next;
            setValue([next]);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commitNumberDraft(event.currentTarget.value);
            event.currentTarget.blur();
          }}
          onBlur={(event) => {
            commitNumberDraft(event.currentTarget.value);
          }}
        />
      </div>
      {error ? (
        <span className="flex items-center gap-2 text-error">
          {error}
          {onRetry ? (
            <button type="button" className="underline" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function WordsPerTopicControl({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState({ source: value, value: String(value) });
  const displayed = draft.source === value ? draft.value : String(value);
  return (
    <label
      htmlFor="topic-words-per-topic"
      className="grid gap-1 text-label-secondary text-description"
    >
      <span className="font-medium">Words per topic</span>
      <input
        id="topic-words-per-topic"
        aria-label="Words per topic"
        type="number"
        min={3}
        max={100}
        value={displayed}
        className="h-9 w-full rounded-md border border-input-border bg-editor px-2 text-right text-body"
        onChange={(event) => {
          setDraft({ source: value, value: event.target.value });
        }}
        onBlur={(event) => {
          const raw = Number(event.currentTarget.value);
          const next = Math.min(100, Math.max(3, Number.isFinite(raw) ? Math.round(raw) : 15));
          setDraft({ source: next, value: String(next) });
          onCommit(next);
        }}
      />
    </label>
  );
}

function TopNTopicsControl({
  inclusion,
  pending,
  onCommit,
}: {
  inclusion: TopicInclusion;
  pending: boolean;
  onCommit: (value: number) => void;
}) {
  const applied = inclusion.top_n_topics;
  const [draft, setDraft] = useState({ source: applied, value: String(applied) });
  const latestCommitRef = useRef(applied);
  const displayed = draft.source === applied ? draft.value : String(applied);

  useEffect(() => {
    latestCommitRef.current = applied;
  }, [applied]);

  const commit = (rawValue: string) => {
    if (rawValue.trim() === '') {
      setDraft({ source: applied, value: String(applied) });
      return;
    }
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      setDraft({ source: applied, value: String(applied) });
      return;
    }
    const next = Math.min(
      inclusion.max_top_n_topics,
      Math.max(inclusion.min_top_n_topics, Math.round(parsed)),
    );
    setDraft({ source: next, value: String(next) });
    if (next === applied || latestCommitRef.current === next) return;
    latestCommitRef.current = next;
    onCommit(next);
  };

  return (
    <div className="grid gap-1 text-label-secondary text-description">
      <div className="flex items-center gap-1.5">
        <label htmlFor="topic-top-n" className="font-medium">
          Top topics per document
        </label>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="About Top topics per document"
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-description transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <CircleHelp className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-72">
            Each row may count toward multiple bubbles. Cutoff ties can include more than this
            number.
          </TooltipContent>
        </Tooltip>
      </div>
      <input
        id="topic-top-n"
        aria-label="Top topics per document"
        type="number"
        min={inclusion.min_top_n_topics}
        max={inclusion.max_top_n_topics}
        step={1}
        value={displayed}
        disabled={pending || !inclusion.adjustable}
        className="h-9 w-full rounded-md border border-input-border bg-editor px-2 text-right text-body"
        onChange={(event) => {
          setDraft({ source: applied, value: event.target.value });
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commit(event.currentTarget.value);
          event.currentTarget.blur();
        }}
        onBlur={(event) => {
          commit(event.currentTarget.value);
        }}
      />
    </div>
  );
}

/**
 * Maps topic-modeling task state to running, error, or successful result content.
 * Rendered by: TopicModelingFeature whenever a banner, result, or local error exists.
 * Flow: derive the task-state card, render TopicModelingBubbleChartSection for
 * successful results.
 */
export function TopicModelingResultsPanel({
  topicWaitingBanner,
  runningTask,
  error,
  result,
  topics,
  exportTopics = topics,
  containerRef,
  selectedTopicIds,
  onToggleTopicSelection,
  onClearSelection,
  topicSearchQuery,
  onTopicSearchQueryChange,
  panelNodeIds,
  nodeColors,
  defaultPalette,
  graphProjectionKey,
  onGraphViewReady,
  nodeNames,
  randomSeed,
  onAddToWorkspace,
  isAddingToWorkspace,
  projectionPending,
  projectionError,
  clustering,
  topicInclusion,
  onClusterCountCommit,
  onTopNTopicsCommit,
  onProjectionRetry,
  projectionControlResetKey = 0,
  wordsPerTopic = 15,
  onWordsPerTopicChange = () => undefined,
  stopWordsEnabled,
  onStopWordsEnabledChange,
  stopWords,
  stopWordsDetectionTarget,
  onStopWordsChange,
}: Props) {
  const isRunningState = Boolean(topicWaitingBanner);
  const runningMessage =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty message should fall back to the next source, not render blank
    runningTask?.message || topicWaitingBanner?.message || 'Task running';
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty task id should fall back to the banner's id, so falsy '' must fall through
  const runningTaskId = runningTask?.task_id || topicWaitingBanner?.taskId;
  const runningProgress = typeof runningTask?.progress === 'number' ? runningTask.progress : null;
  const isErrorState = Boolean(error) && !isRunningState;
  const isSuccessfulState = Boolean(result) && !isRunningState && !isErrorState;

  const cardTone: 'default' | 'error' = isErrorState ? 'error' : 'default';
  const cardTitle = 'Topic Modelling Results';
  const helperConfig = {
    targetKey: 'analysis.topic-modeling.results',
    label: 'Topic modelling results',
    tooltip: 'Shows running progress, failures, and final topic modelling outputs.',
  };
  return (
    <>
      <AnalysisCardLayout
        cardRef={isSuccessfulState ? containerRef : undefined}
        title={cardTitle}
        titleGuidanceTarget={isSuccessfulState ? 'topic-modeling-results' : undefined}
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

        {isErrorState ? <p className="text-body text-description">{error}</p> : null}

        {isSuccessfulState ? (
          <div className="relative" aria-busy={projectionPending}>
            <div
              data-testid="topic-modeling-result-content"
              aria-hidden={projectionPending || undefined}
              inert={projectionPending ? true : undefined}
              className={
                projectionPending
                  ? 'pointer-events-none select-none opacity-40 grayscale'
                  : undefined
              }
            >
              <div className="space-y-4">
                <TopicModelingBubbleChartSection
                  topics={topics}
                  exportTopics={exportTopics}
                  selectedTopicIds={selectedTopicIds}
                  onToggleTopicSelection={onToggleTopicSelection}
                  onClearSelection={onClearSelection}
                  topicSearchQuery={topicSearchQuery}
                  onTopicSearchQueryChange={onTopicSearchQueryChange}
                  corpusSizes={result?.data.corpus_sizes ?? []}
                  panelNodeIds={panelNodeIds}
                  nodeColors={nodeColors}
                  defaultPalette={defaultPalette}
                  projectionKey={graphProjectionKey}
                  onViewReady={onGraphViewReady}
                  nodeNames={nodeNames}
                  clusterCount={clustering?.cluster_count}
                  topNTopics={topicInclusion?.top_n_topics}
                  exportDisabled={projectionPending}
                  randomSeed={randomSeed}
                  controlRowSlot={
                    <div className="flex w-full flex-col gap-3">
                      <section
                        aria-labelledby="topic-result-settings-heading"
                        className="rounded-lg border border-surface-border/70 bg-panel/20 p-3"
                      >
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <h3
                            id="topic-result-settings-heading"
                            className="text-body font-medium text-foreground"
                          >
                            Result settings
                          </h3>
                          <span className="rounded-full border bg-editor px-2.5 py-1 text-label-secondary tabular-nums text-description">
                            Topics ({topics.length})
                          </span>
                        </div>

                        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-x-6 gap-y-4">
                          <section aria-labelledby="topic-structure-settings" className="space-y-2">
                            <h4
                              id="topic-structure-settings"
                              className="text-label-secondary font-semibold uppercase tracking-wide text-description"
                            >
                              Topic structure
                            </h4>
                            <div className="flex flex-wrap items-end gap-3">
                              {clustering ? (
                                <div className="min-w-56 flex-[2_1_16rem]">
                                  <ClusterCountControl
                                    key={`clusters:${String(clustering.cluster_count)}:${String(projectionControlResetKey)}`}
                                    clustering={clustering}
                                    pending={projectionPending}
                                    error={projectionError}
                                    onCommit={onClusterCountCommit}
                                    onRetry={onProjectionRetry}
                                  />
                                </div>
                              ) : null}
                              {topicInclusion ? (
                                <div className="min-w-40 flex-[1_1_10rem]">
                                  <TopNTopicsControl
                                    key={`top-n:${String(topicInclusion.top_n_topics)}:${String(projectionControlResetKey)}`}
                                    inclusion={topicInclusion}
                                    pending={projectionPending}
                                    onCommit={onTopNTopicsCommit}
                                  />
                                </div>
                              ) : null}
                            </div>
                          </section>

                          <section aria-labelledby="topic-word-settings" className="space-y-2">
                            <h4
                              id="topic-word-settings"
                              className="text-label-secondary font-semibold uppercase tracking-wide text-description"
                            >
                              Representative words
                            </h4>
                            <div className="flex flex-wrap items-end gap-3">
                              <div className="min-w-32 flex-[0_1_9rem]">
                                <WordsPerTopicControl
                                  value={wordsPerTopic}
                                  onCommit={onWordsPerTopicChange}
                                />
                              </div>
                              <div className="min-w-0 flex-[1_1_18rem]">
                                <TopicModelingStopWordsControl
                                  enabled={stopWordsEnabled}
                                  onEnabledChange={onStopWordsEnabledChange}
                                  savedWords={stopWords}
                                  workspaceId={stopWordsDetectionTarget.workspaceId}
                                  nodeId={stopWordsDetectionTarget.nodeId}
                                  column={stopWordsDetectionTarget.column}
                                  onSavedWordsChange={onStopWordsChange}
                                />
                              </div>
                            </div>
                          </section>
                        </div>
                      </section>

                      <div className="flex justify-end">
                        <DisabledReasonTooltip
                          reason={
                            isAddingToWorkspace
                              ? 'A Data Block is being added to the workspace'
                              : (clustering?.cluster_count ?? 0) === 0
                                ? 'No Topics were discovered'
                              : undefined
                          }
                        >
                          <Button
                            data-guidance="topic-modeling-add-to-workspace"
                            size="sm"
                            onClick={onAddToWorkspace}
                            disabled={
                              isAddingToWorkspace ||
                              projectionPending ||
                              (clustering?.cluster_count ?? 0) === 0
                            }
                          >
                            <Plus className="mr-1 h-4 w-4" />
                            Add to Workspace
                          </Button>
                        </DisabledReasonTooltip>
                      </div>
                    </div>
                  }
                />
              </div>
            </div>
            {projectionPending ? (
              <div
                role="status"
                aria-live="polite"
                className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-panel/45"
              >
                <div className="flex items-center gap-2 rounded-md border bg-editor px-4 py-3 text-body font-medium">
                  <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
                  Updating topics…
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </AnalysisCardLayout>
    </>
  );
}
