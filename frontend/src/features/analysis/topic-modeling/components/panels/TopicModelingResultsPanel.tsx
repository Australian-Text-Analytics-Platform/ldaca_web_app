import React from 'react';
import { Button } from '../../../../../components/ui/button';
import { Progress } from '../../../../../components/ui/progress';
import { Loader2 } from 'lucide-react';
import { TopicModelingBubbleChartSection } from '../results/TopicModelingBubbleChartSection';
import { TopicModelingDetachDialog } from '../results/TopicModelingDetachDialog';
import { AnalysisCardLayout } from '../../../common/components/AnalysisCardLayout';

type Props = {
  topicWaitingBanner: { status: 'running' | 'queued'; taskId: string | null; message?: string } | null;
  runningTask?: {
    task_id: string;
    state?: string;
    message?: string;
    progress?: number;
  } | null;
  result: any;
  error?: string | null;
  topics: any[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  isDetachLoading: boolean;
  isDetaching: boolean;
  openDetachDialog: () => Promise<void> | void;
  chartRef: React.RefObject<HTMLDivElement | null>;
  handleResetZoom: () => void;
  isAtGlobalZoom: boolean;
  bubbleElements: React.ReactNode;
  tooltip: { topic: any; x: number; y: number };
  renderSizeComposition: (size: number[] | undefined, totalSize?: number | null) => React.ReactNode;
  hoveredTopicId: number | null;
  setHoveredTopicId: React.Dispatch<React.SetStateAction<number | null>>;
  detachDialogOpen: boolean;
  setDetachDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  detachNodeOptions: Array<{ node_id: string; node_name: string; available_columns: string[]; disabled_columns?: string[] }>;
  selectedDetachColumns: Record<string, string[]>;
  toggleDetachColumn: (nodeId: string, column: string, checked: boolean) => void;
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
  detachDialogOpen,
  setDetachDialogOpen,
  detachNodeOptions,
  selectedDetachColumns,
  toggleDetachColumn,
  handleDetachConfirm,
}: Props) {
  const isRunningState = Boolean(topicWaitingBanner) || result?.state === 'running';
  const runningMessage = runningTask?.message || topicWaitingBanner?.message || result?.message || 'Task running';
  const runningTaskId = runningTask?.task_id || topicWaitingBanner?.taskId;
  const runningProgress = typeof runningTask?.progress === 'number'
    ? Math.max(0, Math.min(100, runningTask.progress))
    : null;
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
          <div className="space-y-3 rounded-md border border-amber-300/60 bg-amber-50/60 p-4 text-amber-900">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin" />
              <div className="space-y-0.5 text-sm">
                <p className="font-medium">Task running</p>
                <p className="text-amber-800/90">{runningMessage}</p>
                {runningTaskId ? (
                  <p className="text-xs text-amber-800/80">Task ID: {runningTaskId}</p>
                ) : null}
              </div>
            </div>

            {runningProgress !== null ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-amber-900/90">
                  <span>Progress</span>
                  <span>{Math.round(runningProgress)}%</span>
                </div>
                <Progress value={runningProgress} className="h-2 bg-amber-100" />
              </div>
            ) : null}
          </div>
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
                    Loading Detach…
                  </>
                ) : (
                  'Detach'
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
        handleDetachConfirm={handleDetachConfirm}
      />
    </>
  );
}
