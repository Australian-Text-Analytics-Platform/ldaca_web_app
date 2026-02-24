import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card';
import { Button } from '../../../../../components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../../../components/ui/alert-dialog';
import { Checkbox } from '../../../../../components/ui/checkbox';
import HelpIcon from '../../../../../components/help/HelpIcon';
import AnalysisTaskBanner from '../../../../../components/tabs/AnalysisTaskBanner';
import { Loader2, Scan } from 'lucide-react';

type Props = {
  topicWaitingBanner: { status: 'running' | 'queued'; taskId: string | null; message?: string } | null;
  result: any;
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
  return (
    <>
      {topicWaitingBanner && (
        <AnalysisTaskBanner
          analysisName="Topic Modeling"
          status={topicWaitingBanner.status}
          taskId={topicWaitingBanner.taskId}
          message={topicWaitingBanner.message}
          className="mt-4"
        />
      )}

      {result && result.state === 'successful' && (
        <Card ref={containerRef}>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Topics ({topics.length})
                <HelpIcon
                  targetKey="analysis.topic-modeling.results"
                  label="Topic modeling results"
                  tooltip="Explore topics, bubble sizes, and labels; colors blend by the first vs second dataset share."
                />
              </CardTitle>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
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
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative w-full overflow-hidden rounded-lg border border-muted-foreground/30 bg-background" ref={chartRef}>
              <button
                type="button"
                className="react-flow__controls-button absolute top-2 right-2 z-20 border border-border bg-white/90"
                onClick={handleResetZoom}
                disabled={isAtGlobalZoom}
                title="Reset zoom to global view"
                aria-label="Reset zoom to global view"
                style={{ opacity: isAtGlobalZoom ? 0.5 : 1 }}
              >
                <Scan className="h-4 w-4" />
              </button>
              {bubbleElements}
              {tooltip.topic && (
                <div
                  className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-border bg-card p-3 text-xs shadow-lg"
                  style={{ left: tooltip.x, top: tooltip.y }}
                >
                  <div className="text-sm font-semibold">Topic {tooltip.topic.id}</div>
                  <div className="mt-1 wrap-break-word text-[10px] leading-snug text-muted-foreground">{tooltip.topic.label}</div>
                  <div className="mt-2">{renderSizeComposition(tooltip.topic.size, tooltip.topic.total_size)}</div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
              {topics.slice(0,10).map((t) => {
                const isHovered = hoveredTopicId === t.id;
                return (
                  <div
                    key={t.id}
                    className={`rounded-lg border border-border bg-muted/50 p-3 transition-shadow ${isHovered ? 'ring-2 ring-primary shadow-md' : ''}`}
                    onMouseEnter={() => setHoveredTopicId(t.id)}
                    onMouseLeave={() => setHoveredTopicId(null)}
                  >
                    <div className="font-medium text-foreground">Topic {t.id}</div>
                    <div className="truncate text-xs text-muted-foreground" title={t.label}>{t.label}</div>
                    <div className="mt-2">{renderSizeComposition(t.size, t.total_size)}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={detachDialogOpen} onOpenChange={setDetachDialogOpen}>
        <AlertDialogContent className="max-w-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Detach Topic Results</AlertDialogTitle>
            <AlertDialogDescription>
              Select metadata columns to include with the detached topic column. Existing source <code>topic</code> columns are shown but cannot be selected.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            {detachNodeOptions.map((node) => (
              <div key={node.node_id} className="rounded-md border p-3">
                <div className="mb-2 text-sm font-semibold text-foreground">{node.node_name}</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {node.available_columns.map((column) => {
                    const disabled = (node.disabled_columns || []).includes(column);
                    const checked = (selectedDetachColumns[node.node_id] || []).includes(column);
                    return (
                      <label key={`${node.node_id}-${column}`} className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-60' : ''}`}>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value: boolean | 'indeterminate') => toggleDetachColumn(node.node_id, column, value === true)}
                          disabled={disabled || isDetaching}
                        />
                        <span>{column}{disabled ? ' (disabled)' : ''}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDetaching}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDetachConfirm();
              }}
              disabled={isDetaching}
            >
              {isDetaching ? (
                <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Detaching…</span>
              ) : (
                'Detach'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
