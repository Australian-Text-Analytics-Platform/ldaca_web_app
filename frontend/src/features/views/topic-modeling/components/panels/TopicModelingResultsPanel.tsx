import React, { useState } from 'react';
import type { TopicModelingResponse, TopicModelingTopic } from '@/api';
import { TopicModelingBubbleChartSection } from '../results/TopicModelingBubbleChartSection';
import { AnalysisCardLayout } from '@/features/views/common/components/AnalysisCardLayout';
import { AnalysisRunningStateCard } from '@/features/views/common/components/AnalysisRunningStateCard';
import type { ZoomDomain } from '../../topicModelingAdapters';
import { Button } from '@/components/ui/button';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { Plus } from 'lucide-react';
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
  topicSizeValue?: number;
  randomSeed?: number;
  maxSegmentTokens: number;
  onAddToWorkspace: () => void;
  isAddingToWorkspace: boolean;
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
  topicSizeValue,
  randomSeed,
  maxSegmentTokens,
  onAddToWorkspace,
  isAddingToWorkspace,
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
              topicSizeValue={topicSizeValue}
              randomSeed={randomSeed}
              controlRowSlot={
                <div className="flex w-full flex-wrap items-end justify-between gap-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <p className="pb-2 text-sm text-muted-foreground">Topics ({topics.length})</p>
                    <WordsPerTopicControl value={wordsPerTopic} onCommit={onWordsPerTopicChange} />
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
                      disabled={isAddingToWorkspace}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Add to Workspace
                    </Button>
                  </DisabledReasonTooltip>
                </div>
              }
            />
          </div>
        ) : null}
      </AnalysisCardLayout>
    </>
  );
}
