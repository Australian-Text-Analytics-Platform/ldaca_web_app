import React from 'react';
import { Button } from '../../../../../components/ui/button';
import { Loader2, Plus } from 'lucide-react';
import { TopicModelingBubbleChartSection } from '../results/TopicModelingBubbleChartSection';
import { TopicModelingDetachDialog } from '../results/TopicModelingDetachDialog';
import { AnalysisCardLayout } from '../../../common/components/AnalysisCardLayout';
import { AnalysisRunningStateCard } from '../../../common/components/AnalysisRunningStateCard';
import type { ZoomDomain } from '../../topicModelingAdapters';

type TopicModelingTopic = { id: number; label: string; size: number[]; total_size: number; x: number; y: number };
type TopicModelingResult = { state?: string; data?: { topics: TopicModelingTopic[]; corpus_sizes?: number[] }; metadata?: Record<string, unknown>; message?: string } | null;

type Props = {
  topicWaitingBanner: { status: 'running' | 'queued'; taskId: string | null; message?: string } | null;
  runningTask?: {
    task_id: string;
    state?: string;
    message?: string;
    progress?: number;
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
  detachDialogOpen: boolean;
  setDetachDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  detachNodeOptions: Array<{ node_id: string; node_name: string; available_columns: string[]; disabled_columns?: string[] }>;
  selectedDetachColumns: Record<string, string[]>;
  toggleDetachColumn: (nodeId: string, column: string, checked: boolean) => void;
  selectAllDetachColumns: () => void;
  deselectAllDetachColumns: () => void;
  handleDetachConfirm: () => Promise<void> | void;
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
  detachDialogOpen,
  setDetachDialogOpen,
  detachNodeOptions,
  selectedDetachColumns,
  toggleDetachColumn,
  selectAllDetachColumns,
  deselectAllDetachColumns,
  handleDetachConfirm,
}: Props) {
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

  return (
    <>
      <AnalysisCardLayout
        cardRef={isSuccessfulState ? containerRef : undefined}
        title={cardTitle}
        tone={cardTone}
        help={helperConfig}
      >
        {isRunningState ? (
          <AnalysisRunningStateCard message={runningMessage} taskId={runningTaskId} progress={runningProgress} />
        ) : null}

        {isFailedState ? (
          <p className="text-sm text-muted-foreground">{result.message || 'Topic modeling failed'}</p>
        ) : null}

        {isErrorState ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : null}

        {isSuccessfulState ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">Topics ({topics.length})</p>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => void openDetachDialog()}
                disabled={isDetachLoading || isDetaching}
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
    </>
  );
}
