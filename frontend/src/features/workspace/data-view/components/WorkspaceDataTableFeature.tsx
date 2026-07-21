import { Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkspaceDataHeader } from './WorkspaceDataHeader';
import { WorkspaceSelectionTabs } from './WorkspaceSelectionTabs';
import { WorkspaceTable } from './WorkspaceTable';
import { useWorkspaceDataTable } from '../hooks/useWorkspaceDataTable';

export type WorkspaceDataTableFeatureProps = Record<string, never>;

/**
 * Loading placeholder shown while selected node rows are fetching.
 * Rendered within `WorkspaceDataTableFeature` because data-view loading needs a table-shaped placeholder.
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
 * Rendered within `WorkspaceDataTableFeature` because the feature needs an idle state before node selection.
 * Flow: render the heading and prompt directly on the data surface when the workspace has no active data block selection.
 */
const EmptyState = () => (
  <div className="flex h-full items-center justify-center p-6 text-center">
    <div>
      <h3 className="text-sm font-semibold text-foreground">No Data Block Selected</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Select a data block from the graph to view its data.
      </p>
    </div>
  </div>
);

/**
 * Feature shell that renders selected-node tabs, header, and server table.
 * Rendered by `WorkspaceView`; `useWorkspaceDataTable` supplies its view model.
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
          onRename={nodeActions.onRename}
          onUndo={nodeActions.onUndo}
          onRedo={nodeActions.onRedo}
        />
        <div className="min-h-0 flex-1">
          <WorkspaceTable {...table} />
        </div>
      </div>
    </div>
  );
}
