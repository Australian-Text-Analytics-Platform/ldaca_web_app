import { LoaderCircle, Plus } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import type { TopicClustering, TopicModelingResponse, TopicModelingTopic } from '@/api';
import { Button } from '@/components/ui/button';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { Slider } from '@/components/ui/slider';
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
  tooltip: { topic: TopicModelingTopic | null; x: number; y: number };
  setTooltip: React.Dispatch<
    React.SetStateAction<{ topic: TopicModelingTopic | null; x: number; y: number }>
  >;
  hoveredTopicId: number | null;
  setHoveredTopicId: React.Dispatch<React.SetStateAction<number | null>>;
  selectedTopicIds: Set<number>;
  onToggleTopicSelection: (id: number) => void;
  onClearSelection: () => void;
  topicSearchQuery: string;
  onTopicSearchQueryChange: (query: string) => void;
  corpusCount: number;
  panelNodeIds: string[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  graphProjectionKey: string;
  onGraphViewReady: (projectionKey: string) => void;
  nodeNames?: string[];
  randomSeed?: number;
  maxSegmentTokens: number;
  onAddToWorkspace: () => void;
  isAddingToWorkspace: boolean;
  projectionPending: boolean;
  projectionError?: string | null;
  clustering: TopicClustering | null;
  onClusterCountCommit: (value: number) => void;
  onClusterProjectionRetry?: () => void;
  clusterSliderResetKey?: number;
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
  const activePointerIdRef = useRef<number | null>(null);
  const latestDraftRef = useRef(applied);
  const displayedValue = value[0] ?? applied;

  useEffect(() => {
    const handleWindowBlur = () => {
      if (activePointerIdRef.current === null) return;
      activePointerIdRef.current = null;
      latestDraftRef.current = applied;
      setValue([applied]);
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
  };

  return (
    <div className="grid min-w-56 gap-1 text-xs text-muted-foreground">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="topic-cluster-count">Number of clusters</label>
        <span className="tabular-nums text-foreground">{displayedValue}</span>
      </div>
      {clustering.adjustable ? (
        <Slider
          id="topic-cluster-count"
          data-testid="topic-cluster-slider"
          aria-label="Number of clusters"
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
            const next = latestDraftRef.current;
            if (next !== applied) onCommit(next);
          }}
          onPointerCancel={(event) => {
            rollBackPointerGesture(event.pointerId);
          }}
          onLostPointerCapture={(event) => {
            rollBackPointerGesture(event.pointerId);
          }}
          onValueChange={(nextValue) => {
            const next = nextValue[0] ?? applied;
            latestDraftRef.current = next;
            setValue(nextValue);
            if (activePointerIdRef.current === null && next !== applied) onCommit(next);
          }}
        />
      ) : (
        <input
          id="topic-cluster-count"
          aria-label="Number of clusters"
          type="range"
          min={clustering.cluster_count}
          max={clustering.cluster_count}
          value={clustering.cluster_count}
          disabled
          readOnly
          className="h-4 w-full accent-primary disabled:opacity-50"
        />
      )}
      {error ? (
        <span className="flex items-center gap-2 text-destructive">
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
    <label className="grid gap-1 text-xs text-muted-foreground">
      Words per topic
      <input
        aria-label="Words per topic"
        type="number"
        min={3}
        max={100}
        value={displayed}
        className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right text-sm"
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
  tooltip,
  setTooltip,
  hoveredTopicId,
  setHoveredTopicId,
  selectedTopicIds,
  onToggleTopicSelection,
  onClearSelection,
  topicSearchQuery,
  onTopicSearchQueryChange,
  corpusCount,
  panelNodeIds,
  nodeColors,
  defaultPalette,
  graphProjectionKey,
  onGraphViewReady,
  nodeNames,
  randomSeed,
  maxSegmentTokens,
  onAddToWorkspace,
  isAddingToWorkspace,
  projectionPending,
  projectionError,
  clustering,
  onClusterCountCommit,
  onClusterProjectionRetry,
  clusterSliderResetKey = 0,
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
  const truncatedSegmentCount = result?.data.meta.truncated_segment_count ?? 0;
  const totalSegmentCount = result?.data.meta.n_chunks ?? 0;
  const truncationWarning = (() => {
    if (truncatedSegmentCount <= 0) return null;
    const segmentLabel = totalSegmentCount === 1 ? 'Topic Segment' : 'Topic Segments';
    const verb = truncatedSegmentCount === 1 ? 'was' : 'were';
    const tailReference = truncatedSegmentCount === 1 ? 'that segment' : 'those segments';
    return `${String(truncatedSegmentCount)} of ${String(totalSegmentCount)} ${segmentLabel} ${verb} truncated to ${String(maxSegmentTokens)} tokens; later text in ${tailReference} was not modelled.`;
  })();

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

        {isErrorState ? <p className="text-sm text-muted-foreground">{error}</p> : null}

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
                {truncationWarning ? (
                  <p
                    className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
                    role="status"
                  >
                    {truncationWarning}
                  </p>
                ) : null}
                <TopicModelingBubbleChartSection
                  topics={topics}
                  exportTopics={exportTopics}
                  tooltip={tooltip}
                  setTooltip={setTooltip}
                  hoveredTopicId={hoveredTopicId}
                  setHoveredTopicId={setHoveredTopicId}
                  selectedTopicIds={selectedTopicIds}
                  onToggleTopicSelection={onToggleTopicSelection}
                  onClearSelection={onClearSelection}
                  topicSearchQuery={topicSearchQuery}
                  onTopicSearchQueryChange={onTopicSearchQueryChange}
                  corpusCount={corpusCount}
                  panelNodeIds={panelNodeIds}
                  nodeColors={nodeColors}
                  defaultPalette={defaultPalette}
                  projectionKey={graphProjectionKey}
                  onViewReady={onGraphViewReady}
                  nodeNames={nodeNames}
                  clusterCount={clustering?.cluster_count}
                  exportDisabled={projectionPending}
                  randomSeed={randomSeed}
                  controlRowSlot={
                    <div className="flex w-full flex-wrap items-end justify-between gap-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <p className="pb-2 text-sm text-muted-foreground">
                          Topics ({topics.length})
                        </p>
                        {clustering ? (
                          <ClusterCountControl
                            key={`${String(clustering.cluster_count)}:${String(clusterSliderResetKey)}`}
                            clustering={clustering}
                            pending={projectionPending}
                            error={projectionError}
                            onCommit={onClusterCountCommit}
                            onRetry={onClusterProjectionRetry}
                          />
                        ) : null}
                        <WordsPerTopicControl
                          value={wordsPerTopic}
                          onCommit={onWordsPerTopicChange}
                        />
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
                      <DisabledReasonTooltip
                        reason={
                          isAddingToWorkspace
                            ? 'A Data Block is being added to the workspace'
                            : undefined
                        }
                      >
                        <Button
                          data-guidance="topic-modeling-add-to-workspace"
                          size="sm"
                          onClick={onAddToWorkspace}
                          disabled={isAddingToWorkspace || projectionPending}
                        >
                          <Plus className="mr-1 h-4 w-4" />
                          Add to Workspace
                        </Button>
                      </DisabledReasonTooltip>
                    </div>
                  }
                />
              </div>
            </div>
            {projectionPending ? (
              <div
                role="status"
                aria-live="polite"
                className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-muted/45 backdrop-blur-[1px]"
              >
                <div className="flex items-center gap-2 rounded-md border bg-background px-4 py-3 text-sm font-medium shadow-sm">
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
