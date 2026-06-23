/**
 * Chrome-style tab strip — our own dependency-free port of the interaction model
 * from adamschwartz/chrome-tabs (MIT). Tabs are absolutely positioned and moved
 * with ``translateX``; the dragged tab follows the pointer while every other tab
 * transitions to its new slot, so reordering visibly "squeezes" siblings aside
 * in real time. Tabs hug their title up to a max width (and shrink together when
 * the strip is crowded), with a fade + tooltip when a title is clipped.
 *
 * Controlled + reusable: it renders whatever ``tabs`` it is given and reports
 * intent through callbacks. A transient ``dragOrder`` drives the live preview
 * order during a drag and is dropped on release once the parent has persisted
 * the new order (both current consumers persist synchronously, so there is no
 * flicker).
 *
 * Used by:
 * - AnalysisTabbedPanel (create/close/rename/reorder, body-connected look).
 * - WorkspaceSelectionTabs (activate/close/reorder for multi-selected nodes).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  closestIndex,
  computeContentTabWidths,
  computeTabPositions,
  computeTotalWidth,
  moveInOrder,
  TAB_MAX_WIDTH,
} from './chromeTabsLayout';

export interface ChromeTabItem {
  id: string;
  title: string;
}

export interface ChromeTabsProps {
  tabs: ChromeTabItem[];
  activeTabId: string | null;
  /** Focuses a tab (single click / keyboard). */
  onActivate: (id: string) => void;
  /** Persists a reordered list of tab ids after a drag. Omit to disable drag. */
  onReorder?: (orderedIds: string[]) => void;
  /** Shows a per-tab close button. Omit to hide it. */
  onClose?: (id: string) => void;
  /** Shows a trailing "+" button. Omit to hide it. */
  onCreate?: () => void;
  /** Enables inline rename on a second click of the active tab. Omit to disable. */
  onRename?: (id: string, title: string) => void;
  /** Draws a body-connecting bottom bar so the active tab fuses with content below. */
  connectBelow?: boolean;
  className?: string;
  'aria-label'?: string;
}

/** Height of a single tab, in pixels (drives the strip height). */
const TAB_HEIGHT = 34;
/** Width reserved for the trailing "+" button slot. */
const CREATE_BUTTON_WIDTH = 32;
/** Pointer travel before a press becomes a drag (vs. a click). */
const DRAG_THRESHOLD = 4;
/** Pixels added to a measured title so the tab's content is not flush to its edge. */
const TITLE_WIDTH_SLACK = 4;

interface DragState {
  tabId: string;
  pointerId: number;
  startX: number;
  homeLeft: number;
  moved: boolean;
}

/**
 * Renders the tab strip and owns drag + inline-rename interaction state.
 * Used by: AnalysisTabbedPanel and WorkspaceSelectionTabs.
 * Flow: measure the container + each title, compute content-hugging widths and
 * slot positions, render each tab as an absolutely-positioned element
 * transitioned to its slot, and route pointer gestures into activate / reorder /
 * rename callbacks.
 */
export function ChromeTabs({
  tabs,
  activeTabId,
  onActivate,
  onReorder,
  onClose,
  onCreate,
  onRename,
  connectBelow = false,
  className,
  'aria-label': ariaLabel = 'Tabs',
}: ChromeTabsProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Transient drag preview order; null when not dragging. While set it overrides
  // the prop order so siblings can slide before the parent persists the change.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragDeltaX, setDragDeltaX] = useState(0);
  // Slot left-offset of the dragged tab at drag start; kept in state (not the
  // ref) so the render-time ``translateX`` never reads a ref during render.
  const [dragHomeLeft, setDragHomeLeft] = useState(0);
  const dragRef = useRef<DragState | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Per-tab title measurement. ``titleRefs`` points at each rendered title span;
  // ``naturalWidths`` caches each title's intrinsic pixel width (so tabs size to
  // their content) and ``overflowingIds`` tracks which titles are clipped by
  // their tab (so the fade overlay shows permanently rather than only on hover).
  const titleRefs = useRef(new Map<string, HTMLSpanElement>());
  const [naturalWidths, setNaturalWidths] = useState<Map<string, number>>(() => new Map());
  const [overflowingIds, setOverflowingIds] = useState<Set<string>>(() => new Set());

  // Track the available width so widths recompute on container/window resize.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const update = () => {
      setContainerWidth(element.clientWidth);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  // Effective render order: drag preview while dragging, else the prop order.
  // Any unknown id (e.g. created mid-drag) is appended so a tab is never lost.
  const orderIds = (() => {
    const propIds = tabs.map((tab) => tab.id);
    if (!dragOrder) return propIds;
    const ordered = dragOrder.filter((id) => tabsById.has(id));
    for (const id of propIds) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    return ordered;
  })();

  const widthBudget = onCreate ? Math.max(0, containerWidth - CREATE_BUTTON_WIDTH) : containerWidth;
  // Until a title is measured, assume the max width so its scrollWidth (read
  // below) is captured before the tab is allowed to shrink to its content.
  const orderedNatural = orderIds.map((id) => naturalWidths.get(id) ?? TAB_MAX_WIDTH);
  const widths = computeContentTabWidths(orderedNatural, widthBudget);
  const positions = computeTabPositions(widths);
  const totalWidth = computeTotalWidth(widths);

  // Measure intrinsic title widths + clipping after layout. The title span is
  // ``w-max`` so its ``offsetWidth`` is the true content width (used to size the
  // tab); a title is clipped when that content is wider than its ``overflow``
  // wrapper. Keyed on titles + computed widths + container so it re-runs whenever
  // layout could change; functional updates keep the maps out of the dep list.
  const titlesKey = tabs.map((tab) => `${tab.id}:${tab.title}`).join('|');
  const widthsKey = widths.join(',');
  useEffect(() => {
    setNaturalWidths((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const [id, element] of titleRefs.current) {
        const natural = element.offsetWidth + TITLE_WIDTH_SLACK;
        if (next.get(id) !== natural) {
          next.set(id, natural);
          changed = true;
        }
      }
      // Drop cached widths for tabs that no longer exist (closed tabs).
      for (const id of next.keys()) {
        if (!tabsById.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setOverflowingIds((prev) => {
      const next = new Set<string>();
      for (const [id, element] of titleRefs.current) {
        const wrapperWidth = element.parentElement?.clientWidth ?? 0;
        if (element.offsetWidth > wrapperWidth + 1) next.add(id);
      }
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by layout signature; maps updated functionally
  }, [titlesKey, widthsKey, containerWidth]);

  const finishRename = useCallback(() => {
    setRenamingId((current) => {
      if (current) {
        const trimmed = draftTitle.trim();
        if (trimmed) onRename?.(current, trimmed);
      }
      return null;
    });
  }, [draftTitle, onRename]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
  }, []);

  const beginRename = useCallback((tab: ChromeTabItem) => {
    setRenamingId(tab.id);
    setDraftTitle(tab.title);
  }, []);

  const clearDrag = useCallback(() => {
    dragRef.current = null;
    setDragTabId(null);
    setDragDeltaX(0);
    setDragOrder(null);
  }, []);

  const handlePointerDown = (tab: ChromeTabItem, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || renamingId) return;
    const index = orderIds.indexOf(tab.id);
    dragRef.current = {
      tabId: tab.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      homeLeft: positions[index] ?? 0,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;

    if (!drag.moved) {
      if (Math.abs(delta) < DRAG_THRESHOLD || !onReorder) return;
      drag.moved = true;
      setDragTabId(drag.tabId);
      setDragHomeLeft(drag.homeLeft);
      setDragOrder(orderIds);
      onActivate(drag.tabId);
    }

    setDragDeltaX(delta);
    setDragOrder((current) => {
      const order = current ?? orderIds;
      const fromIndex = order.indexOf(drag.tabId);
      const destIndex = closestIndex(drag.homeLeft + delta, positions);
      return moveInOrder(order, fromIndex, destIndex);
    });
  };

  const handlePointerUp = (tab: ChromeTabItem, event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag.moved) {
      const finalOrder = dragOrder ?? orderIds;
      const changed = finalOrder.some((id, index) => id !== tabs[index]?.id);
      if (changed) onReorder?.(finalOrder);
      clearDrag();
      return;
    }

    // No drag travel → treat as a click: rename the active tab, else activate.
    dragRef.current = null;
    if (tab.id === activeTabId && onRename) beginRename(tab);
    else onActivate(tab.id);
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') finishRename();
    else if (event.key === 'Escape') cancelRename();
  };

  return (
    <div
      ref={scrollRef}
      className={cn('relative overflow-x-auto', className)}
      role="tablist"
      aria-label={ariaLabel}
    >
      <div
        className="relative"
        style={{ height: TAB_HEIGHT, width: totalWidth + (onCreate ? CREATE_BUTTON_WIDTH : 0) }}
      >
        {orderIds.map((id, index) => {
          const tab = tabsById.get(id);
          if (!tab) return null;
          const isActive = id === activeTabId;
          const isRenaming = id === renamingId;
          const isDragging = id === dragTabId;
          const isOverflowing = overflowingIds.has(id);
          const slotLeft = positions[index] ?? 0;
          const translateX = isDragging ? dragHomeLeft + dragDeltaX : slotLeft;
          return (
            <div
              key={id}
              role="tab"
              aria-selected={isActive}
              data-chrome-tab
              onPointerDown={(event) => {
                handlePointerDown(tab, event);
              }}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => {
                handlePointerUp(tab, event);
              }}
              style={{ width: widths[index], transform: `translateX(${String(translateX)}px)` }}
              className={cn(
                'group absolute top-0 left-0 flex h-full items-center rounded-t-lg text-sm select-none',
                isDragging
                  ? 'z-20 cursor-grabbing'
                  : 'z-1 cursor-grab transition-[transform,background-color,color] duration-150 ease-out',
                isActive
                  ? 'z-10 border border-b-0 border-border/60 bg-white font-medium text-gray-900 shadow-[0_-2px_4px_-2px_rgba(0,0,0,0.12)]'
                  : 'border border-transparent bg-gray-100/80 text-gray-500 hover:bg-gray-200 hover:text-gray-700',
              )}
            >
              {/* When fused with a body, paint over the body's border under the active tab. */}
              {connectBelow && isActive ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 -bottom-px z-10 h-0.5 bg-white"
                />
              ) : null}

              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  value={draftTitle}
                  onChange={(event) => {
                    setDraftTitle(event.target.value);
                  }}
                  onBlur={finishRename}
                  onKeyDown={handleRenameKeyDown}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  className="mx-2 w-full min-w-0 bg-transparent text-sm outline-none"
                  aria-label="Rename tab"
                />
              ) : (
                <span className="pointer-events-none relative block min-w-0 flex-1 overflow-hidden">
                  <span
                    ref={(element) => {
                      if (element) titleRefs.current.set(id, element);
                      else titleRefs.current.delete(id);
                    }}
                    // ``w-max`` sizes this span to its content so ``offsetWidth``
                    // is the title's true natural width (the parent wrapper clips
                    // it). The active tab's bold weight is captured because the
                    // span renders inside the styled tab.
                    className="block w-max pr-2 pl-3 text-left whitespace-nowrap"
                    // Native tooltip surfaces the full title only when it is clipped.
                    title={isOverflowing ? tab.title : undefined}
                  >
                    {tab.title || 'Untitled'}
                  </span>
                  {/* Right-edge fade: always visible while the title is clipped,
                      otherwise revealed only on hover/focus (when the close button
                      appears over the text). Gradient colours track the tab state
                      so the fade blends into the tab background. */}
                  <span
                    aria-hidden="true"
                    data-testid="tab-title-fade"
                    className={cn(
                      'pointer-events-none absolute inset-y-0 right-0 w-12 transition-opacity duration-150',
                      isOverflowing
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                      isActive
                        ? 'bg-linear-to-l from-white via-white/95 to-transparent'
                        : 'bg-linear-to-l from-gray-100 via-gray-100/95 to-transparent group-hover:from-gray-200 group-hover:via-gray-200/95',
                    )}
                  />
                </span>
              )}

              {onClose && !isRenaming ? (
                <button
                  type="button"
                  aria-label="Close tab"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(id);
                  }}
                  className={cn(
                    'absolute top-1/2 right-1 z-20 -translate-y-1/2 rounded p-0.5 opacity-0 transition hover:bg-gray-300/70 hover:text-gray-800 focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100',
                    isActive ? 'text-gray-500' : 'text-gray-400',
                  )}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          );
        })}

        {onCreate ? (
          <button
            type="button"
            aria-label="New tab"
            onClick={onCreate}
            style={{ transform: `translateX(${String(totalWidth)}px)` }}
            className="absolute top-1/2 left-0 z-1 -translate-y-1/2 ml-1 rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-800"
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
