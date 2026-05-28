import { Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkspaceDataHeader } from './WorkspaceDataHeader';
import { WorkspaceSelectionTabs } from './WorkspaceSelectionTabs';
import { WorkspaceTable } from './WorkspaceTable';
import { useWorkspaceDataTable } from '../hooks/useWorkspaceDataTable';

export type WorkspaceDataTableFeatureProps = Record<string, never>;

/**
 * Loading placeholder shown while selected node rows are fetching.
 * Rendered by: workspace/WorkspaceDataTableFeature module JSX because data-view loading needs a table-shaped placeholder.
 * Flow: render a spinner label followed by table-shaped skeleton rows so the data view keeps its expected layout while rows load.
 */
const LoadingState = () => (
  <div className="space-y-4 p-6">
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>Loading data block…</span>
    </div>
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-6 w-20" />
      </div>
      <div className="space-y-3 rounded-lg border border-dashed border-border/50 p-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="grid grid-cols-4 gap-4">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

/**
 * Empty placeholder shown until a workspace graph node is selected.
 * Rendered by: workspace/WorkspaceDataTableFeature module JSX because the feature needs an idle state before node selection.
 * Flow: render the idle panel with an icon, heading, and prompt when the workspace has no active data block selection.
 */
const EmptyState = () => (
  <div className="p-6">
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/50 bg-muted/40 p-6 text-center">
      <svg
        className="h-6 w-6 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        />
      </svg>
      <h3 className="mt-3 text-sm font-semibold text-foreground">No Data Block Selected</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Select a data block from the graph to view its data.
      </p>
    </div>
  </div>
);

/**
 * Feature shell that renders selected-node tabs, header, and server table.
 * Rendered by: index module, WorkspaceView component, useWorkspaceDataTable hook (rg call sites/imports) because the workspace view needs one data-table feature shell.
 * Flow: read the table view model, branch to loading or empty states, then render selection tabs, header actions, and the server-backed table.
 */
export function WorkspaceDataTableFeature(_props: WorkspaceDataTableFeatureProps) {
  const { selectedNode, header, tabs, table, loading, nodeActions } = useWorkspaceDataTable();

  if (loading.nodeData) {
    return <LoadingState />;
  }

  if (!selectedNode) {
    return <EmptyState />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceSelectionTabs {...tabs} />
      <div className="flex min-h-0 flex-1 flex-col">
        <WorkspaceDataHeader
          info={header}
          onUndo={nodeActions.onUndo}
          onRedo={nodeActions.onRedo}
          onRename={nodeActions.onRename}
          onQueryPlan={nodeActions.onQueryPlan}
          canUndo={nodeActions.canUndo}
          canRedo={nodeActions.canRedo}
        />
        <div className="min-h-0 flex-1">
          <WorkspaceTable {...table} />
        </div>
      </div>
    </div>
  );
}
