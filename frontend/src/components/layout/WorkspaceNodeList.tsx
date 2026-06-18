import React, { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFreshNodesStore } from '@/stores/freshNodesStore';
import { usePinnedNodesStore } from '@/stores/pinnedNodesStore';
import type { SidebarWorkspaceNode } from './sidebar/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface WorkspaceNodeListProps {
  nodes: SidebarWorkspaceNode[];
  selectedNodeIds?: string[];
  onToggleNodeSelection: (nodeId: string) => void;
  onClearSelection?: () => void;
  /** Deletes the selected visible rows after the header confirmation dialog. */
  onDeleteSelected?: (nodeIds: string[]) => Promise<void> | void;
  /** Optional action rendered for a pinned row while the row is not hovered. */
  renderPinnedRowAction?: (node: SidebarWorkspaceNode) => React.ReactNode;
  /** Optional actions rendered for each node row (e.g. the
   * right-panel list view's per-node action toolbar + schema magnifier). When
   * omitted, rows render without a toolbar. */
  renderRowActions?: (node: SidebarWorkspaceNode) => React.ReactNode;
}

/**
 * Renders a data-block name with a ChromeTabs-style left-edge fade instead of an
 * ellipsis, mirroring the analysis multi-tab strip.
 * Called by: WorkspaceNodeList row rendering because each row needs its own
 * overflow measurement to decide whether the fade stays on permanently.
 * Flow: measure the clipped text against its wrapper via ResizeObserver, then
 * keep the gradient overlay visible when the name overflows and otherwise reveal
 * it only while the row (the `group`) is hovered/focused — where the leading
 * actions overlay the text.
 */
function NodeRowName({ name }: { name: string }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const text = textRef.current;
    if (!wrap || !text) return;
    const measure = () => {
      setOverflowing(text.offsetWidth > wrap.clientWidth + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    observer.observe(text);
    return () => { observer.disconnect(); };
  }, [name]);

  return (
    <span
      ref={wrapRef}
      dir={overflowing ? 'rtl' : 'ltr'}
      className={cn(
        'relative min-w-0 flex-1 overflow-hidden',
        overflowing ? 'block' : 'flex justify-end text-right',
      )}
    >
      <span
        ref={textRef}
        dir="ltr"
        className="block w-max whitespace-nowrap text-right text-xs font-medium text-foreground"
      >
        {name}
      </span>
      {/* Left-edge fade: always visible while the name is clipped, otherwise
          revealed only on hover/focus (when the leading actions overlay the text).
          Widens on hover so the text fades before reaching the actions. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-10 bg-linear-to-r from-background via-background/90 to-transparent group-hover/row:w-32',
          overflowing ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
        )}
      />
    </span>
  );
}

/**
 * Called by: WorkspaceNodeList row rendering to build data-block tooltips because the caller needs a focused rendering boundary for layout, accessibility, and state handoff steps.
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

/** Called by: WorkspaceNodeList sorting and row labels because the caller needs one documented boundary for the lookup, event, or state handoff step. */
const getNodeDisplayName = (node: SidebarWorkspaceNode): string =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- fall through empty-string names to the next candidate, not only null/undefined
  node.data?.nodeName || node.data?.label || node.label || node.name || node.id;

/** Called by: WorkspaceNodeList row onKeyDown handlers because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
const isActivationKey = (event: React.KeyboardEvent<HTMLDivElement>): boolean =>
  event.key === 'Enter' || event.key === ' ';

/**
 * Selectable node list shown in the collapsed right panel's list view. It
 * presents nodes in their original workspace order and bridges row clicks back
 * to workspace selection and fresh-node acknowledgement stores.
 * Rendered by: WorkspaceListView (the collapsed list-view top pane) because
 * graph selection and fresh-node acknowledgement must stay aligned.
 * Flow: read fresh state, measure row anchor points, then render counts, the
 * selected-delete action, and the toggleable node rows.
 */
function WorkspaceNodeList({
  nodes,
  selectedNodeIds,
  onToggleNodeSelection,
  onClearSelection,
  onDeleteSelected,
  renderPinnedRowAction,
  renderRowActions,
}: WorkspaceNodeListProps) {
  const selectedCount = selectedNodeIds?.length ?? 0;
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const pinnedNodeIds = usePinnedNodesStore((state) => state.pinnedNodeIds);

  const freshIds = useFreshNodesStore((state) => state.freshIds);
  const markInteracted = useFreshNodesStore((state) =>
    // eslint-disable-next-line @typescript-eslint/unbound-method -- zustand action is bound to the store and does not rely on `this`
    state.markInteracted,
  );

  /** Called by: WorkspaceNodeList row click and keyboard activation handlers because the caller needs one documented boundary for the lookup, event, or state handoff step. */
  const handleToggle = (nodeId: string) => {
    markInteracted([nodeId]);
    onToggleNodeSelection(nodeId);
  };

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const selectedIdSet = new Set(selectedNodeIds ?? []);
  const pinnedIdSet = new Set(pinnedNodeIds.filter((id) => nodeById.has(id)));
  const pinnedNodes = pinnedNodeIds
    .map((id) => nodeById.get(id))
    .filter((node): node is SidebarWorkspaceNode => node !== undefined);
  const selectedNodes = nodes.filter((node) => selectedIdSet.has(node.id) && !pinnedIdSet.has(node.id));
  const regularNodes = nodes.filter((node) => !selectedIdSet.has(node.id) && !pinnedIdSet.has(node.id));
  const orderedNodes = [...pinnedNodes, ...selectedNodes, ...regularNodes];

  const selectedForDelete = nodes
    .filter((node) => selectedIdSet.has(node.id))
    .map((node) => ({
      id: node.id,
      name: getNodeDisplayName(node) || 'Untitled data block',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const canBatchDelete = selectedForDelete.length > 0;

  /** Deletes the currently selected visible rows, then clears stale selection ids. */
  const handleBatchDelete = async () => {
    if (!onDeleteSelected || !canBatchDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDeleteSelected(selectedForDelete.map((item) => item.id));
      onClearSelection?.();
      setDeleteConfirmOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {onDeleteSelected && canBatchDelete && (
        <div className="flex items-center justify-end gap-2 pb-1">
          <button
            type="button"
            onClick={() => { setDeleteConfirmOpen(true); }}
            disabled={isDeleting}
            title="Delete the selected data blocks"
            aria-label="Delete selected data blocks"
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              'border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:border-destructive/90'
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete ({selectedCount})</span>
          </button>
        </div>
      )}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedForDelete.length} data block
              {selectedForDelete.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The following data blocks will be removed:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-60 overflow-y-auto rounded border bg-muted/40 p-2 text-sm">
            {selectedForDelete.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleBatchDelete();
              }}
              disabled={isDeleting || !canBatchDelete}
              className="bg-destructive text-white hover:bg-destructive/90 disabled:opacity-50"
            >
              {isDeleting ? 'Deleting…' : `Delete ${String(selectedForDelete.length)}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="relative">
        {nodes.length ? (
          <div className="space-y-1.5 pr-1">
            {orderedNodes.map((node) => {
              const displayName = getNodeDisplayName(node) || 'Untitled data block';
              const shape = formatShapeLabel(node);
              const checked = selectedNodeIds?.includes(node.id) ?? false;
              const tooltip = `${displayName}\nShape: ${shape}`;
              const isFresh = freshIds.has(node.id);
              const isPinned = pinnedIdSet.has(node.id);
              const pinnedRowAction = isPinned ? renderPinnedRowAction?.(node) : null;
              const rowActions = renderRowActions?.(node);

              return (
                <div
                  key={node.id}
                  onClick={() => {
                    handleToggle(node.id);
                  }}
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
                  className="group/row relative block w-full rounded-md text-left focus-visible:outline-hidden"
                >
                  {/* Inner box carries the border/background. */}
                  <div
                    className={cn(
                      'relative flex items-center gap-2 overflow-visible rounded-md border bg-background/70 px-2 py-1 text-xs transition-colors duration-150 ease-out group-focus-visible/row:ring-1 group-focus-visible/row:ring-ring',
                      isPinned && pinnedRowAction && 'pl-8',
                      checked
                        ? 'border-primary/70 bg-primary/10 ring-1 ring-primary/20'
                        : 'border-border/60 group-hover/row:border-border group-hover/row:bg-accent/60',
                    )}
                  >
                    {pinnedRowAction && (
                      <div
                        data-testid="pinned-row-pin-action"
                        className="absolute top-1/2 left-1 z-10 flex -translate-y-1/2 items-center opacity-100 group-hover/row:pointer-events-none group-hover/row:opacity-0"
                        onPointerDown={(event) => { event.stopPropagation(); }}
                        onClick={(event) => { event.stopPropagation(); }}
                        onKeyDown={(event) => { event.stopPropagation(); }}
                      >
                        {pinnedRowAction}
                      </div>
                    )}
                    <NodeRowName name={displayName} />
                    {isFresh && (
                      <span
                        className="pointer-events-none h-2 w-2 shrink-0 rounded-full bg-red-500 transition-opacity duration-150 group-hover/row:opacity-0"
                        title="New data block"
                        aria-label="New data block"
                      />
                    )}
                    {rowActions && (
                      // Hover-revealed leading actions, absolutely positioned on the left.
                      // Stop row-toggle when interacting with the actions.
                      <div
                        className="absolute top-1/2 left-1 flex -translate-y-1/2 items-center opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 pointer-events-none"
                        onPointerDown={(event) => { event.stopPropagation(); }}
                        onClick={(event) => { event.stopPropagation(); }}
                        onKeyDown={(event) => { event.stopPropagation(); }}
                        role="toolbar"
                        tabIndex={-1}
                        aria-label={`Actions for ${displayName}`}
                      >
                        {rowActions}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-md bg-accent/40 px-2 py-2 text-xs text-muted-foreground">
            No data blocks
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkspaceNodeList;
