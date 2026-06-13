import React from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFreshNodesStore } from '@/stores/freshNodesStore';
import type { SidebarWorkspaceNode } from './types';

interface SidebarNodesSectionProps {
  nodes: SidebarWorkspaceNode[];
  selectedNodeIds?: string[];
  onToggleNodeSelection: (nodeId: string) => void;
  onClearSelection?: () => void;
}

/**
 * Sidebar selection glyph used by `SidebarNodesSection`. Shows a filled
 * check circle when the node is selected and an empty circle otherwise.
 * Why: the sidebar mirrors the graph's selected/unselected state without any
 * per-node colour.
 * Flow: fill the circle for selected rows, then render the checkmark only when selected.
 */
function NodeCheckIcon({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        'pointer-events-none flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
        checked ? 'border-primary bg-primary' : 'border-muted-foreground/40 bg-transparent',
      )}
      aria-hidden="true"
    >
      {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
    </span>
  );
}

/**
 * Called by: SidebarNodesSection row rendering to build data-block tooltips because the caller needs a focused rendering boundary for layout, accessibility, and state handoff steps.
 * Flow: read shape from node data or top-level payload, format numeric row/column parts, then fall back to unknown markers.
 */
const formatShapeLabel = (node: SidebarWorkspaceNode): string => {
  const rawShape = node.data?.shape ?? (node as { shape?: [number | null, number | null] }).shape;
  if (!rawShape) {
    return '—';
  }
  const [rows, cols] = rawShape;
  /** Called by: formatShapeLabel for row and column tooltip fragments because the caller needs one documented boundary for the lookup, event, or state handoff step. */
  const formatPart = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '?';
  return `${formatPart(rows)} × ${formatPart(cols)}`;
};

/** Called by: SidebarNodesSection sorting and row labels because the caller needs one documented boundary for the lookup, event, or state handoff step. */
const getNodeDisplayName = (node: SidebarWorkspaceNode): string =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- fall through empty-string names to the next candidate, not only null/undefined
  node.data?.nodeName || node.data?.label || node.label || node.name || node.id;

/** Called by: SidebarNodesSection row onKeyDown handlers because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
const isActivationKey = (event: React.KeyboardEvent<HTMLDivElement>): boolean =>
  event.key === 'Enter' || event.key === ' ';

/**
 * Data-block section used inside the app sidebar. It presents selectable nodes
 * in a stable order and bridges sidebar clicks back to workspace selection and
 * fresh-node acknowledgement stores.
 * Rendered by: Sidebar's Data Blocks section because graph selection and fresh-node acknowledgement must stay aligned.
 * Flow: read fresh state, order selected nodes first, then render counts, clear action, and toggleable node rows.
 */
function SidebarNodesSection({
  nodes,
  selectedNodeIds,
  onToggleNodeSelection,
  onClearSelection,
}: SidebarNodesSectionProps) {
  const nodeCount = nodes.length;
  const selectedCount = selectedNodeIds?.length ?? 0;

  const freshIds = useFreshNodesStore((state) => state.freshIds);
  const markInteracted = useFreshNodesStore((state) =>
    // eslint-disable-next-line @typescript-eslint/unbound-method -- zustand action is bound to the store and does not rely on `this`
    state.markInteracted,
  );

  /** Called by: SidebarNodesSection row click and keyboard activation handlers because the caller needs one documented boundary for the lookup, event, or state handoff step. */
  const handleToggle = (nodeId: string) => {
    markInteracted([nodeId]);
    onToggleNodeSelection(nodeId);
  };

  /** Orders selected nodes first for context, then unselected nodes alphabetically for scanning. */
  const orderedNodes = (() => {
    const selectedIds = selectedNodeIds ?? [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const selectedSet = new Set(selectedIds);
    const selectedOrdered: SidebarWorkspaceNode[] = [];
    for (const id of [...selectedIds].reverse()) {
      const node = nodeById.get(id);
      if (node) selectedOrdered.push(node);
    }
    const unselectedSorted = nodes
      .filter((node) => !selectedSet.has(node.id))
      .sort((a, b) =>
        getNodeDisplayName(a).localeCompare(getNodeDisplayName(b), undefined, {
          sensitivity: 'base',
        }),
      );
    return [...selectedOrdered, ...unselectedSorted];
  })();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Total: {nodeCount}</span>
        <div className="flex items-center gap-1">
          <span>Selected: {selectedCount}</span>
          {selectedCount > 0 && onClearSelection && (
            <button
              type="button"
              onClick={onClearSelection}
              title="Clear selection"
              className="rounded p-0.5 hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <div className="space-y-2 pr-1">
        {orderedNodes.length ? (
          orderedNodes.map((node) => {
            const displayName = getNodeDisplayName(node) || 'Untitled data block';
            const shape = formatShapeLabel(node);
            const checked = selectedNodeIds?.includes(node.id) ?? false;
            const tooltip = `${displayName}\nShape: ${shape}`;
            const isFresh = freshIds.has(node.id);

            return (
              <div
                key={node.id}
                onClick={() => { handleToggle(node.id); }}
                onKeyDown={(event) => {
                  if (!isActivationKey(event)) {
                    return;
                  }
                  event.preventDefault();
                  handleToggle(node.id);
                }}
                title={tooltip}
                role="button"
                tabIndex={0}
                aria-pressed={checked}
                aria-label={`${checked ? 'Deselect' : 'Select'} ${displayName}`}
                className={cn(
                  'group relative flex w-full items-center gap-3 overflow-hidden rounded-md border border-transparent bg-background/40 px-2 py-2 text-left text-sm transition-colors duration-150 ease-out focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
                  checked
                    ? 'border-primary/60 bg-primary/10'
                    : 'hover:border-border/60 hover:bg-accent/60',
                )}
              >
                <NodeCheckIcon checked={checked} />
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-foreground">
                  {displayName}
                </span>
                {isFresh && (
                  <span
                    className="pointer-events-none ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-red-500"
                    title="New data block"
                    aria-label="New data block"
                  />
                )}
              </div>
            );
          })
        ) : (
          <div className="rounded-md bg-accent/40 px-2 py-2 text-xs text-muted-foreground">
            No data blocks
          </div>
        )}
      </div>
    </div>
  );
}

export default SidebarNodesSection;
