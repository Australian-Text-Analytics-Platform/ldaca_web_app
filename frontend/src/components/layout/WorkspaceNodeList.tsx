import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFreshNodesStore } from '@/stores/freshNodesStore';
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
  /** Commits a new node order after a drag-to-reorder gesture. When omitted, rows
   * are not draggable. The array is the full node id list in its new order and
   * maps directly to the backend-persisted workspace node list. */
  onReorder?: (orderedIds: string[]) => void;
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
      className="relative block min-w-0 flex-1 overflow-hidden"
    >
      <span
        ref={textRef}
        dir="ltr"
        className="block w-max whitespace-nowrap text-xs font-medium text-foreground"
      >
        {name}
      </span>
      {/* Left-edge fade: always visible while the name is clipped, otherwise
          revealed only on hover/focus (when the leading actions overlay the text).
          Widens on hover so the text fades before reaching the actions. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-10 bg-linear-to-r from-background via-background/90 to-transparent transition-all duration-150 group-hover/row:w-36',
          overflowing ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100',
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

/** Matches Tailwind's space-y-1.5 gap used between list rows. */
const ROW_GAP = 6;
/** Pointer travel before a press becomes a drag instead of a row click. */
const DRAG_THRESHOLD = 4;
/** Fallback used in tests and the first frame before row metrics are measured. */
const ROW_FALLBACK_HEIGHT = 30;

interface DragGesture {
  id: string;
  pointerId: number;
  startY: number;
  homeTop: number;
  order: string[];
  moved: boolean;
}

/** Returns the closest visual slot to a pointer coordinate. */
function closestRowIndex(value: number, slotCenters: number[]): number {
  let best = Number.POSITIVE_INFINITY;
  let bestIndex = 0;
  slotCenters.forEach((center, index) => {
    const distance = Math.abs(value - center);
    if (distance < best) {
      best = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

/** Immutably moves the item at ``fromIndex`` to ``toIndex`` within ``order``. */
function moveInOrder(order: string[], fromIndex: number, toIndex: number): string[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= order.length ||
    toIndex >= order.length
  ) {
    return order;
  }
  const next = [...order];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return order;
  next.splice(toIndex, 0, moved);
  return next;
}

/** Called by: WorkspaceNodeList to clear a held drag preview once props catch up. */
function sameOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

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
  onReorder,
  renderRowActions,
}: WorkspaceNodeListProps) {
  const selectedCount = selectedNodeIds?.length ?? 0;
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  // ChromeTabs-style drag state. While a row is being dragged, the DOM keeps the
  // persisted prop order and rows move with translateY instead of being removed
  // and reinserted on every hover. This avoids the native drag ghost + FLIP
  // feedback loop that made the previous implementation jiggle.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [dragDeltaY, setDragDeltaY] = useState(0);
  const [dragHomeTop, setDragHomeTop] = useState(0);
  const dragRef = useRef<DragGesture | null>(null);
  const suppressClickRef = useRef(false);
  const reorderable = Boolean(onReorder) && nodes.length > 1;

  const baseOrder = nodes.map((node) => node.id);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const activeDragOrder = dragOrder && !sameOrder(dragOrder, baseOrder) ? dragOrder : null;
  // Effective visual order: drag preview while dragging, else the prop order.
  // Unknown ids are dropped and newly-added ids are appended so a node is never lost.
  const effectiveOrder = (() => {
    if (!activeDragOrder) return baseOrder;
    const ordered = activeDragOrder.filter((id) => nodeById.has(id));
    for (const id of baseOrder) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    return ordered;
  })();

  const selectedIdSet = new Set(selectedNodeIds ?? []);
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

  // Row heights drive the analytic vertical layout for active drag-to-reorder transitions.
  const rowsRef = useRef<HTMLDivElement | null>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const [rowBoxes, setRowBoxes] = useState<Map<string, { top: number; height: number }>>(new Map());

  const rowSetKey = baseOrder.join('|');

  /** Measured row height, or the fallback before the first measurement. */
  const getRowHeight = (id: string): number => rowBoxes.get(id)?.height ?? ROW_FALLBACK_HEIGHT;

  /**
   * Accumulates each row's top offset for a given order. Used only for the live
   * drag preview, where rows are mid-reorder and have no stable measured top.
   */
  const slotTopsForOrder = (order: string[]): number[] => {
    const tops: number[] = [];
    let top = 0;
    for (const id of order) {
      tops.push(top);
      top += getRowHeight(id) + ROW_GAP;
    }
    return tops;
  };

  // Natural (prop-order) tops: the real measured offsetTop once available, with
  // an analytic fallback for the first paint before measurement runs.
  const baseSlotTops = slotTopsForOrder(baseOrder);
  const baseTopById = new Map<string, number>();
  baseOrder.forEach((id, index) => {
    baseTopById.set(id, rowBoxes.get(id)?.top ?? baseSlotTops[index] ?? 0);
  });

  // Effective (live drag preview) tops, used to position rows while a drag is in progress.
  const effectiveSlotTops = slotTopsForOrder(effectiveOrder);
  const visualTopById = new Map<string, number>();
  effectiveOrder.forEach((id, index) => {
    visualTopById.set(id, effectiveSlotTops[index] ?? 0);
  });

  const isDragActive = dragNodeId !== null;

  const clearDrag = () => {
    dragRef.current = null;
    setDragNodeId(null);
    setDragDeltaY(0);
    setDragHomeTop(0);
    setDragOrder(null);
  };

  /**
   * Starts tracking a possible reorder gesture without committing to drag until
   * the pointer crosses the threshold. Called by: each reorderable row.
   */
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (!reorderable || event.button !== 0) return;
    const homeTop = rowBoxes.get(id)?.top ?? baseTopById.get(id) ?? 0;
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startY: event.clientY,
      homeTop,
      order: baseOrder,
      moved: false,
    };
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  /**
   * Moves the dragged row with the pointer and slides siblings into their
   * preview slots. Called by: pointer capture on the pressed row.
   */
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    const delta = event.clientY - drag.startY;

    if (!drag.moved) {
      if (Math.abs(delta) < DRAG_THRESHOLD || !onReorder) return;
      drag.moved = true;
      setDragNodeId(drag.id);
      setDragHomeTop(drag.homeTop);
      setDragOrder(baseOrder);
    }

    event.preventDefault();
    setDragDeltaY(delta);
    setDragOrder((current) => {
      const order = current ?? baseOrder;
      const fromIndex = order.indexOf(drag.id);
      const slotTops = slotTopsForOrder(order);
      const slotCenters = order.map((id, index) => (slotTops[index] ?? 0) + getRowHeight(id) / 2);
      const rowHeight = getRowHeight(drag.id);
      const pointerCenter = drag.homeTop + delta + rowHeight / 2;
      const toIndex = closestRowIndex(pointerCenter, slotCenters);
      const nextOrder = moveInOrder(order, fromIndex, toIndex);
      drag.order = nextOrder;
      return nextOrder;
    });
  };

  /**
   * Commits the preview order on release, or lets an ordinary click flow through
   * when the pointer never crossed the drag threshold. Called by: each row.
   */
  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId) &&
      typeof event.currentTarget.releasePointerCapture === 'function'
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!drag.moved) {
      dragRef.current = null;
      return;
    }

    event.preventDefault();
    suppressClickRef.current = true;
    const finalOrder = drag.order;
    const changed = finalOrder.length !== baseOrder.length || finalOrder.some((id, index) => id !== baseOrder[index]);
    if (changed) onReorder?.(finalOrder);
    dragRef.current = null;
    setDragNodeId(null);
    setDragDeltaY(0);
    setDragHomeTop(0);
    setDragOrder(changed ? finalOrder : null);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    suppressClickRef.current = true;
    clearDrag();
  };

  // Measure each row's integer offsetTop + offsetHeight and only commit when a
  // value actually changes. Both are layout (pre-transform) metrics that stay
  // constant when only the panel width changes, so this never fires during a
  // width drag and the connectors cannot jiggle. offsetTop is measured against
  // the rows container (the SVG's origin), giving anchors that match the cards.
  useLayoutEffect(() => {
    const measure = () => {
      setRowBoxes((prev) => {
        const next = new Map<string, { top: number; height: number }>();
        for (const [id, el] of rowEls.current) {
          next.set(id, {
            top: el.offsetTop,
            height: el.offsetHeight || ROW_FALLBACK_HEIGHT,
          });
        }
        let changed = next.size !== prev.size;
        if (!changed) {
          for (const [id, value] of next) {
            const before = prev.get(id);
            if (!before) {
              changed = true;
              break;
            }
            if (before.top !== value.top || before.height !== value.height) {
              changed = true;
              break;
            }
          }
        }
        return changed ? next : prev;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const el of rowEls.current.values()) {
      observer.observe(el);
    }
    return () => {
      observer.disconnect();
    };
    // rowSetKey captures additions/removals; heights are stable across width changes.
  }, [rowSetKey]);

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
      <div ref={rowsRef} className="relative">
        {nodes.length ? (
          <div className="space-y-1.5 pr-1">
            {nodes.map((node) => {
              const displayName = getNodeDisplayName(node) || 'Untitled data block';
              const shape = formatShapeLabel(node);
              const checked = selectedNodeIds?.includes(node.id) ?? false;
              const tooltip = `${displayName}\nShape: ${shape}`;
              const isFresh = freshIds.has(node.id);
              const isDragging = dragNodeId === node.id;
              const naturalTop = baseTopById.get(node.id) ?? 0;
              const targetTop = visualTopById.get(node.id) ?? naturalTop;
              // Static rows render at their real CSS slot (no transform); only an
              // active drag shifts rows into preview slots.
              const translateY = !isDragActive
                ? 0
                : isDragging
                  ? dragHomeTop + dragDeltaY - naturalTop
                  : targetTop - naturalTop;
              const rowStyle: React.CSSProperties = {
                transform: translateY === 0 ? undefined : `translateY(${String(translateY)}px)`,
                zIndex: isDragging ? 20 : undefined,
              };

              return (
                <div
                  key={node.id}
                  ref={(el) => {
                    if (el) rowEls.current.set(node.id, el);
                    else rowEls.current.delete(node.id);
                  }}
                  style={rowStyle}
                  onPointerDown={reorderable ? (event) => { handlePointerDown(event, node.id); } : undefined}
                  onPointerMove={reorderable ? handlePointerMove : undefined}
                  onPointerUp={reorderable ? handlePointerUp : undefined}
                  onPointerCancel={reorderable ? handlePointerCancel : undefined}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
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
                  className={cn(
                    'group/row relative block w-full rounded-md text-left focus-visible:outline-hidden',
                    reorderable && 'cursor-grab touch-none select-none active:cursor-grabbing',
                    activeDragOrder && !isDragging && 'transition-transform duration-150 ease-out motion-reduce:transition-none',
                    isDragging && 'cursor-grabbing shadow-lg',
                  )}
                >
                  {/* Inner box carries the border/background. */}
                  <div
                    className={cn(
                      'relative flex items-center gap-2 overflow-visible rounded-md border bg-background/70 px-2 py-1 text-xs transition-colors duration-150 ease-out group-focus-visible/row:ring-1 group-focus-visible/row:ring-ring',
                      checked
                        ? 'border-primary/70 bg-primary/10 ring-1 ring-primary/20'
                        : 'border-border/60 group-hover/row:border-border group-hover/row:bg-accent/60',
                    )}
                  >
                    <NodeRowName name={displayName} />
                    {isFresh && (
                      <span
                        className="pointer-events-none h-2 w-2 shrink-0 rounded-full bg-red-500 transition-opacity duration-150 group-hover/row:opacity-0"
                        title="New data block"
                        aria-label="New data block"
                      />
                    )}
                    {renderRowActions && (
                      // Hover-revealed leading actions, absolutely positioned on the left.
                      // Stop row-toggle when interacting with the actions.
                      <div
                        className="absolute top-1/2 left-1 flex -translate-y-1/2 items-center opacity-0 transition-opacity duration-150 group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 pointer-events-none"
                        onPointerDown={(event) => { event.stopPropagation(); }}
                        onClick={(event) => { event.stopPropagation(); }}
                        onKeyDown={(event) => { event.stopPropagation(); }}
                        role="toolbar"
                        tabIndex={-1}
                        aria-label={`Actions for ${displayName}`}
                      >
                        {renderRowActions(node)}
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
