import { Search } from 'lucide-react';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { mapColumnsToInfo } from '@/features/workspace/data-view/utils/columnTypes';
import type { SidebarWorkspaceNode } from '@/components/layout/sidebar/types';

export interface WorkspaceSchemaViewProps {
  /** Node whose schema to show; ``null`` renders the empty prompt. Set by the
   * list view's per-row schema magnifier. */
  nodeId: string | null;
}

/**
 * Schema-only data view shown in the bottom of the right panel when it's
 * collapsed (replacing the data table). Lists a node's columns and their
 * canonical types — no row data is fetched or rendered.
 *
 * Rendered by: WorkspaceView when ``collapsed`` is true.
 * Flow: look the node up in the workspace graph, derive column/type info via
 * ``mapColumnsToInfo``, then render the column list or an empty prompt.
 */
export function WorkspaceSchemaView({ nodeId }: WorkspaceSchemaViewProps) {
  const { workspaceGraph } = useWorkspaceData();
  const rawNodes = (workspaceGraph as { nodes?: unknown } | undefined)?.nodes;
  const nodes = Array.isArray(rawNodes) ? (rawNodes as SidebarWorkspaceNode[]) : [];
  const node = nodeId ? nodes.find((n) => n.id === nodeId) : undefined;

  if (!node) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <Search className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h3 className="mt-3 text-sm font-semibold text-foreground">No schema selected</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Click the magnifier on a data block above to view its schema.
        </p>
      </div>
    );
  }

  const columns = mapColumnsToInfo(node);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- fall through empty names to id
  const nodeName = node.name || node.label || node.id;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-baseline justify-between border-b border-border bg-muted px-3 py-2">
        <span className="truncate text-sm font-semibold text-foreground" title={nodeName}>
          {nodeName}
        </span>
        <span className="ml-2 shrink-0 text-xs text-muted-foreground">
          {columns.length} column{columns.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
        {columns.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">No columns.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {columns.map((column) => (
              <li
                key={column.name}
                className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate font-medium text-foreground" title={column.name}>
                  {column.name}
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {column.dataType}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default WorkspaceSchemaView;
