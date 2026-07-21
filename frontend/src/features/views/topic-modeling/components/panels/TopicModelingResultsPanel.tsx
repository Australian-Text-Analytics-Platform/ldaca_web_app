import React from 'react';
import type { TopicModelingResponse, TopicModelingTopic } from '@/api';
import { TopicModelingBubbleChartSection } from '../results/TopicModelingBubbleChartSection';
import { AnalysisCardLayout } from '@/features/views/common/components/AnalysisCardLayout';
import { AnalysisRunningStateCard } from '@/features/views/common/components/AnalysisRunningStateCard';
import type { ZoomDomain } from '../../topicModelingAdapters';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

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
  onAddToWorkspace: () => void;
  isAddingToWorkspace: boolean;
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
  onAddToWorkspace,
  isAddingToWorkspace,
}: Props) {
  const isRunningState = Boolean(topicWaitingBanner) || result?.state === 'running';
  const runningMessage =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty message should fall back to the next source, not render blank
    runningTask?.message || topicWaitingBanner?.message || result?.message || 'Task running';
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty task id should fall back to the banner's id, so falsy '' must fall through
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
          <p className="text-sm text-muted-foreground">
            {result.message ?? 'Topic modeling failed'}
          </p>
        ) : null}

        {isErrorState ? <p className="text-sm text-muted-foreground">{error}</p> : null}

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
              topicSizeValue={topicSizeValue}
              randomSeed={randomSeed}
              controlRowSlot={
                <div className="flex w-full items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">Topics ({topics.length})</p>
                  <Button size="sm" onClick={onAddToWorkspace} disabled={isAddingToWorkspace}>
                    <Plus className="mr-1 h-4 w-4" />
                    Add to Workspace
                  </Button>
                </div>
              }
            />
          </div>
        ) : null}
      </AnalysisCardLayout>
    </>
  );
}
