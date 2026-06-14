import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFreshNodesStore } from '@/stores/freshNodesStore';
import type { SidebarWorkspaceNode } from './sidebar/types';
import { computeConnectorLayout, type NodeListEdge } from './nodeListConnectors';
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
  /** Parent -> child relationships drawn as connectors in the left gutter. */
  edges?: NodeListEdge[];
  selectedNodeIds?: string[];
  onToggleNodeSelection: (nodeId: string) => void;
  onClearSelection?: () => void;
  /** Deletes the selected visible rows after the header confirmation dialog. */
  onDeleteSelected?: (nodeIds: string[]) => Promise<void> | void;
  /** Commits a new node order after a drag-to-reorder gesture. When omitted, rows
   * are not draggable. The array is the full node id list in its new order and
   * maps directly to the backend-persisted workspace node list. */
  onReorder?: (orderedIds: string[]) => void;
  /** Optional trailing actions rendered at the end of each node row (e.g. the
   * right-panel list view's per-node action toolbar + schema magnifier). When
   * omitted, rows render without a toolbar. */
  renderRowActions?: (node: SidebarWorkspaceNode) => React.ReactNode;
}

/**
 * Renders a data-block name with a ChromeTabs-style right-edge fade instead of an
 * ellipsis, mirroring the analysis multi-tab strip.
 * Called by: WorkspaceNodeList row rendering because each row needs its own
 * overflow measurement to decide whether the fade stays on permanently.
 * Flow: measure the clipped text against its wrapper via ResizeObserver, then
 * keep the gradient overlay visible when the name overflows and otherwise reveal
 * it only while the row (the `group`) is hovered/focused — where the trailing
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
    <span ref={wrapRef} className="relative block min-w-0 flex-1 overflow-hidden">
      <span
        ref={textRef}
        className="block w-max whitespace-nowrap text-sm font-medium text-foreground"
      >
        {name}
      </span>
      {/* Right-edge fade: always visible while the name is clipped, otherwise
          revealed only on hover/focus (when the trailing actions overlay the
          text). Widens on hover so the text fades before reaching the actions. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-background via-background/90 to-transparent transition-all duration-150 group-hover:w-36',
          overflowing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
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

/** Connector gutter geometry (px). The gutter is a left strip where parent ->
 * child relationships are drawn as routed lines. Following the React Flow model,
 * each edge leaves a parent's left-centre point (marked with a small circle),
 * routes down its assigned lane, and arrives at a child's left-centre point
 * (marked with an arrowhead). Point coordinates are derived analytically from
 * the card's fixed left edge and the row layout, never measured per frame, so
 * resizing the panel width cannot make the connectors jiggle. */
const LANE_GAP = 8;
/** Horizontal gap between a card's anchor column and the first (rightmost) lane.
 * Kept larger than LANE_GAP so edges clearly break away from the card before
 * the lanes pack together. */
const FIRST_LANE_GAP = 14;
const GUTTER_BASE = 12;
const CORNER_R = 8;
/** Radius of the small open circle that marks each connector's start point. */
const START_R = 3;
/** Horizontal gap between the anchor points and the card's left edge, so the
 * arrow stops just short of the border instead of touching it. */
const EDGE_GAP = 5;
/** Fraction of row height between the top edge and the upper anchor. The two
 * anchors sit at this fraction and its mirror (1 - fraction), evenly spread
 * about the row centre: the "out" (start circle) at 0.25, the "in" (end arrow)
 * at 0.75. */
const POINT_SPREAD = 1 / 4;
/** Matches Tailwind's space-y-2 gap used between list rows. */
const ROW_GAP = 8;
/** Pointer travel before a press becomes a drag instead of a row click. */
const DRAG_THRESHOLD = 4;
/** Fallback used in tests and the first frame before row metrics are measured. */
const ROW_FALLBACK_HEIGHT = 40;

/** Total gutter width for a given lane count; collapses to nothing when there
 * are no drawable edges. Called by: WorkspaceNodeList render. */
const gutterWidthFor = (laneCount: number) =>
  laneCount > 0
    ? EDGE_GAP + FIRST_LANE_GAP + (laneCount - 1) * LANE_GAP + GUTTER_BASE
    : 0;

interface Point {
  x: number;
  y: number;
}

/** Formats a coordinate for an SVG path string (rounded to avoid float noise). */
const fmt = (value: number): string => (Math.round(value * 100) / 100).toString();

/**
 * Builds an SVG path for an orthogonal polyline with rounded corners so the
 * connectors read as one smooth, coherent line instead of segmented right
 * angles. Each interior corner is replaced by a quadratic curve whose radius is
 * clamped to half the shorter adjoining segment.
 * Called by: NodeListConnectorOverlay for every edge path.
 */
function roundedOrthPath(points: Point[], radius: number): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return '';
  let d = `M ${fmt(first.x)} ${fmt(first.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    if (!prev || !cur || !next) continue;
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const enter = { x: cur.x + ((prev.x - cur.x) / inLen) * r, y: cur.y + ((prev.y - cur.y) / inLen) * r };
    const exit = { x: cur.x + ((next.x - cur.x) / outLen) * r, y: cur.y + ((next.y - cur.y) / outLen) * r };
    d += ` L ${fmt(enter.x)} ${fmt(enter.y)} Q ${fmt(cur.x)} ${fmt(cur.y)} ${fmt(exit.x)} ${fmt(exit.y)}`;
  }
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}

/** Analytic connector points for a node card, relative to the rows container.
 * x is a fixed column just left of the card edge. The two anchors are evenly
 * spread about the row centre: outY (outgoing start circle) at 0.75 of the row
 * height, inY (incoming end arrow) at 0.25. */
interface RowPoint {
  x: number;
  inY: number;
  outY: number;
}

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
 * SVG overlay that draws the relationship connectors inside the row gutter. It
 * is purely decorative (aria-hidden) and never intercepts pointer events so row
 * clicks still toggle selection.
 * Rendered by: WorkspaceNodeList from analytic point coordinates.
 * Flow: route each edge from its parent's left-centre point, left into the
 * edge's assigned lane, down/up to the child's point, drawing a smooth rounded
 * (React Flow smoothstep-style) path that ends in an arrow. Edges sharing a
 * child share a lane, so their vertical lines overlap and their arrows merge.
 * A small open circle marks each unique source point so the start of every
 * relationship is visible without cluttering non-source nodes.
 */
function NodeListConnectorOverlay({
  layout,
  points,
  height,
  gutterWidth,
}: {
  layout: ReturnType<typeof computeConnectorLayout>;
  points: Map<string, RowPoint>;
  height: number;
  gutterWidth: number;
}) {
  // Lane 0 is the rightmost lane, set FIRST_LANE_GAP left of the anchor column;
  // each further lane steps left by the smaller LANE_GAP.
  const laneX = (lane: number) => gutterWidth - EDGE_GAP - FIRST_LANE_GAP - lane * LANE_GAP;

  // Unique source points get one start circle each, even when a parent fans out
  // to several children.
  const sourcePoints = new Map<string, RowPoint>();
  for (const segment of layout.segments) {
    const from = points.get(segment.source);
    if (from) sourcePoints.set(segment.source, from);
  }

  return (
    <svg
      aria-hidden="true"
      width={gutterWidth}
      height={height}
      className="pointer-events-none absolute top-0 left-0 overflow-visible text-muted-foreground/70"
    >
      <defs>
        <marker
          id="nodeListArrow"
          viewBox="0 0 8 8"
          refX="6.5"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
        </marker>
      </defs>
      {layout.segments.map((segment) => {
        const from = points.get(segment.source);
        const to = points.get(segment.target);
        if (!from || !to) return null;
        const x = laneX(segment.lane);
        const path = roundedOrthPath(
          [
            { x: from.x - START_R, y: from.outY },
            { x, y: from.outY },
            { x, y: to.inY },
            { x: to.x, y: to.inY },
          ],
          CORNER_R,
        );
        return (
          <path
            key={`${segment.source}->${segment.target}`}
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            markerEnd="url(#nodeListArrow)"
          />
        );
      })}
      {Array.from(sourcePoints.entries()).map(([id, point]) => (
        <circle
          key={`start-${id}`}
          cx={point.x}
          cy={point.outY}
          r={START_R}
          className="fill-background stroke-current"
          strokeWidth={1.25}
        />
      ))}
    </svg>
  );
}

/**
 * Selectable node list shown in the collapsed right panel's list view. It
 * presents nodes in their original workspace order and bridges row clicks back
 * to workspace selection and fresh-node acknowledgement stores.
 * Rendered by: WorkspaceListView (the collapsed list-view top pane) because
 * graph selection and fresh-node acknowledgement must stay aligned.
 * Flow: read fresh state, measure row anchor points, then render counts, the
 * selected-delete action, the connector gutter overlay, and the toggleable node rows.
 */
function WorkspaceNodeList({
  nodes,
  edges,
  selectedNodeIds,
  onToggleNodeSelection,
  onClearSelection,
  onDeleteSelected,
  onReorder,
  renderRowActions,
}: WorkspaceNodeListProps) {
  const nodeCount = nodes.length;
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
  const orderedNodes = effectiveOrder
    .map((id) => nodeById.get(id))
    .filter((node): node is SidebarWorkspaceNode => node !== undefined);

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

  // Single source of truth for order: render nodes in the effective (live) order.
  const orderedIds = orderedNodes.map((node) => node.id);
  const visibleEdges = edges ?? [];
  const layout = computeConnectorLayout(orderedIds, visibleEdges);
  const gutterWidth = gutterWidthFor(layout.laneCount);

  // Row heights drive the analytic vertical layout that anchors the connectors.
  // Following the React Flow model, handle positions come from layout maths, not
  // per-frame DOM rects: offsetHeight is an integer that only changes when a row
  // actually grows/shrinks, so dragging the panel width never re-runs layout and
  // the connectors stay rock steady.
  const rowsRef = useRef<HTMLDivElement | null>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  // Measured per-row geometry (offsetTop + offsetHeight) relative to the rows
  // container, which is also the connector SVG's coordinate origin. Anchors are
  // read straight from these boxes so they land exactly on each card instead of
  // accumulating per-row height errors down the list.
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

  // Effective (live drag preview) tops, used to position rows + connectors
  // while a drag is in progress.
  const effectiveSlotTops = slotTopsForOrder(effectiveOrder);
  const visualTopById = new Map<string, number>();
  effectiveOrder.forEach((id, index) => {
    visualTopById.set(id, effectiveSlotTops[index] ?? 0);
  });

  const isDragActive = dragNodeId !== null;

  // Handle coordinates: x is the card's fixed left edge (just inside gutterWidth);
  // y comes straight from the measured card box so anchors sit exactly at the
  // card's quarter points. During a drag the dragged row follows the pointer and
  // the rest fall back to analytic preview slots.
  const connectorHeight = effectiveOrder.reduce(
    (sum, id) => sum + getRowHeight(id) + ROW_GAP,
    0,
  );
  const visualPoints = new Map<string, RowPoint>();
  for (const id of effectiveOrder) {
    let top: number;
    if (dragNodeId === id) {
      top = dragHomeTop + dragDeltaY;
    } else if (isDragActive) {
      top = visualTopById.get(id) ?? 0;
    } else {
      top = rowBoxes.get(id)?.top ?? visualTopById.get(id) ?? 0;
    }
    const height = getRowHeight(id);
    visualPoints.set(id, {
      x: gutterWidth - EDGE_GAP,
      outY: top + height * (1 - POINT_SPREAD),
      inY: top + height * POINT_SPREAD,
    });
  }

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
      <div className="flex items-center justify-between gap-2">
        <span className="rounded border border-border bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm">
          {selectedCount}/{nodeCount} selected
        </span>
        {onDeleteSelected && (
          <button
            type="button"
            onClick={() => { setDeleteConfirmOpen(true); }}
            disabled={isDeleting}
            title="Delete the selected data blocks"
            aria-label="Delete selected data blocks"
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              canBatchDelete && !isDeleting
                ? 'border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:border-destructive/90'
                : 'border-border bg-white text-gray-600 hover:bg-muted hover:text-gray-900',
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete ({selectedCount})</span>
          </button>
        )}
      </div>
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
          <>
            {connectorHeight > 0 && gutterWidth > 0 && (
              <NodeListConnectorOverlay
                layout={layout}
                points={visualPoints}
                height={connectorHeight}
                gutterWidth={gutterWidth}
              />
            )}
            {/* Rows live in their own in-flow wrapper so the absolutely
                positioned overlay above does not perturb the space-y gaps the
                analytic layout assumes. */}
            <div className="space-y-2 pr-1">
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
                    'group relative block w-full rounded-md text-left focus-visible:outline-hidden',
                    reorderable && 'cursor-grab touch-none select-none active:cursor-grabbing',
                    activeDragOrder && !isDragging && 'transition-transform duration-150 ease-out motion-reduce:transition-none',
                    isDragging && 'cursor-grabbing shadow-lg',
                  )}
                >
                  {/* Inner box carries the border/background so it wraps only the
                      node content, leaving the connector gutter to its left
                      transparent (lines never run under the box). */}
                  <div
                    style={{ marginLeft: gutterWidth }}
                    className={cn(
                      'relative flex items-center gap-3 overflow-visible rounded-md border bg-background/70 px-2 py-2 text-sm transition-colors duration-150 ease-out group-focus-visible:ring-1 group-focus-visible:ring-ring',
                      checked
                        ? 'border-primary/70 bg-primary/10 ring-1 ring-primary/20'
                        : 'border-border/60 group-hover:border-border group-hover:bg-accent/60',
                    )}
                  >
                    <NodeRowName name={displayName} />
                    {isFresh && (
                      <span
                        className="pointer-events-none h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 transition-opacity duration-150 group-hover:opacity-0"
                        title="New data block"
                        aria-label="New data block"
                      />
                    )}
                    {renderRowActions && (
                      // Hover-revealed trailing actions, absolutely positioned so they
                      // overlay the faded name edge instead of reserving row space.
                      // Stop row-toggle when interacting with the actions.
                      <div
                        className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-events-none"
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
          </>
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
