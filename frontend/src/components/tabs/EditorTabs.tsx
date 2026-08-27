/**
 * VS Code-style editor tab strip with dependency-free drag interaction based on
 * adamschwartz/chrome-tabs (MIT). Tabs use contiguous 32px hit targets with
 * inset 24px fills, matching VS Code's current Modern UI geometry.
 *
 * Controlled + reusable: the parent owns tab data and persistence while this
 * component owns only transient drag and inline-rename state.
 */

import { Plus, X } from 'lucide-react';
import type React from 'react';
import {
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  createEditorTabsInteractionState,
  editorTabsInteractionReducer,
} from './editorTabsInteractionState';
import {
  closestIndex,
  computeContentTabWidths,
  computeTabPositions,
  computeTotalWidth,
  moveInOrder,
  TAB_MAX_WIDTH,
} from './editorTabsLayout';

/** Optional per-tab identity colours that replace the theme's tab fills. */
interface EditorTabFill {
  /** Fill behind the active tab; also the hover fill of an inactive tab. */
  active: string;
  /** Fill behind an inactive tab. */
  inactive: string;
  /** Text colour legible on both fills. */
  foreground: string;
}

export interface EditorTabItem {
  id: string;
  title: string;
  icon?: ReactNode;
  fill?: EditorTabFill;
  tabDomId?: string;
  panelDomId?: string;
  'data-guidance'?: string;
}

export interface EditorTabsProps {
  tabs: EditorTabItem[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onReorder?: (orderedIds: string[]) => void;
  onClose?: (id: string) => void;
  onCreate?: () => void;
  onRename?: (id: string, title: string) => void;
  className?: string;
  'aria-label'?: string;
}

const TAB_HEIGHT = 32;
const CREATE_BUTTON_WIDTH = 32;
const DRAG_THRESHOLD = 4;
const TITLE_LEADING_WIDTH = 8;
const TITLE_TRAILING_WIDTH = 8;
const CLOSE_ACTION_WIDTH = 24;
const ICON_AND_GAP_WIDTH = 22;
const TITLE_WIDTH_SLACK = 4;

interface DragState {
  tabId: string;
  pointerId: number;
  startX: number;
  homeLeft: number;
  moved: boolean;
}

/** Renders the shared editor tab strip and owns drag and inline-rename state. */
export function EditorTabs({
  tabs,
  activeTabId,
  onActivate,
  onReorder,
  onClose,
  onCreate,
  onRename,
  className,
  'aria-label': ariaLabel = 'Tabs',
}: EditorTabsProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [interactionState, dispatchInteraction] = useReducer(
    editorTabsInteractionReducer,
    undefined,
    createEditorTabsInteractionState,
  );
  const {
    drag: { order: dragOrder, tabId: dragTabId, deltaX: dragDeltaX, homeLeft: dragHomeLeft },
    rename: { id: renamingId, draftTitle },
  } = interactionState;
  const dragRef = useRef<DragState | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const titleMeasureRefs = useRef(new Map<string, HTMLSpanElement>());
  const [naturalWidths, setNaturalWidths] = useState<Map<string, number>>(() => new Map());

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
  const orderIds = (() => {
    const propIds = tabs.map((tab) => tab.id);
    if (!dragOrder) return propIds;
    const ordered = dragOrder.filter((id) => tabsById.has(id));
    for (const id of propIds) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    return ordered;
  })();

  const orderedNatural = orderIds.map((id) => naturalWidths.get(id) ?? TAB_MAX_WIDTH);
  const widths = computeContentTabWidths(orderedNatural);
  const positions = computeTabPositions(widths);
  const totalWidth = computeTotalWidth(widths);

  const titlesKey = tabs.map((tab) => `${tab.id}:${tab.title}`).join('|');
  const widthsKey = widths.join(',');
  useEffect(() => {
    setNaturalWidths((previous) => {
      const next = new Map(previous);
      let changed = false;
      for (const [id, element] of titleMeasureRefs.current) {
        const natural =
          element.offsetWidth +
          TITLE_LEADING_WIDTH +
          TITLE_TRAILING_WIDTH +
          (tabsById.get(id)?.icon ? ICON_AND_GAP_WIDTH : 0) +
          (onClose ? CLOSE_ACTION_WIDTH : 0) +
          TITLE_WIDTH_SLACK;
        if (next.get(id) !== natural) {
          next.set(id, natural);
          changed = true;
        }
      }
      for (const id of next.keys()) {
        if (!tabsById.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : previous;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by layout signature; maps update functionally
  }, [titlesKey, widthsKey, containerWidth]);

  const finishRename = () => {
    if (renamingId) {
      const trimmed = draftTitle.trim();
      if (trimmed) onRename?.(renamingId, trimmed);
    }
    dispatchInteraction({ type: 'renameCancelled' });
  };

  const beginRename = (tab: EditorTabItem) => {
    dispatchInteraction({ type: 'renameStarted', tabId: tab.id, title: tab.title });
  };

  const clearDrag = () => {
    dragRef.current = null;
    dispatchInteraction({ type: 'dragCleared' });
  };

  const handlePointerDown = (tab: EditorTabItem, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || renamingId) return;
    const index = orderIds.indexOf(tab.id);
    dragRef.current = {
      tabId: tab.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      homeLeft: positions[index] ?? 0,
      moved: false,
    };
    if (onReorder) event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    const wasMoved = drag.moved;

    if (!wasMoved) {
      if (Math.abs(delta) < DRAG_THRESHOLD || !onReorder) return;
      drag.moved = true;
      dispatchInteraction({
        type: 'dragStarted',
        tabId: drag.tabId,
        order: orderIds,
        homeLeft: drag.homeLeft,
      });
      onActivate(drag.tabId);
    }

    const order = wasMoved ? (dragOrder ?? orderIds) : orderIds;
    const fromIndex = order.indexOf(drag.tabId);
    const destIndex = closestIndex(drag.homeLeft + delta, positions);
    dispatchInteraction({
      type: 'dragMoved',
      deltaX: delta,
      order: moveInOrder(order, fromIndex, destIndex),
    });
  };

  const handlePointerUp = (tab: EditorTabItem, event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (onReorder && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag.moved) {
      const finalOrder = dragOrder ?? orderIds;
      const changed = finalOrder.some((id, index) => id !== tabs[index]?.id);
      if (changed) onReorder?.(finalOrder);
      clearDrag();
      return;
    }

    dragRef.current = null;
    if (tab.id === activeTabId && onRename) beginRename(tab);
    else onActivate(tab.id);
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') finishRename();
    else if (event.key === 'Escape') dispatchInteraction({ type: 'renameCancelled' });
  };

  const handleTabKeyDown = (tab: EditorTabItem, event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = orderIds.indexOf(tab.id);
    let targetIndex: number | null = null;

    if (event.key === 'ArrowRight') targetIndex = (currentIndex + 1) % orderIds.length;
    else if (event.key === 'ArrowLeft') {
      targetIndex = (currentIndex - 1 + orderIds.length) % orderIds.length;
    } else if (event.key === 'Home') targetIndex = 0;
    else if (event.key === 'End') targetIndex = orderIds.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate(tab.id);
      return;
    }

    if (targetIndex === null) return;
    event.preventDefault();
    const targetId = orderIds[targetIndex];
    if (!targetId) return;
    onActivate(targetId);
    tabRefs.current.get(targetId)?.focus();
  };

  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={100}>
      <div
        ref={scrollRef}
        className={cn('relative overflow-x-auto overflow-y-hidden px-[8px] pt-[8px]', className)}
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
            const isOverflowing =
              (naturalWidths.get(id) ?? TAB_MAX_WIDTH) > (widths[index] ?? TAB_MAX_WIDTH) + 1;
            const displayTitle = tab.title || 'Untitled';
            const slotLeft = positions[index] ?? 0;
            const translateX = isDragging ? dragHomeLeft + dragDeltaX : slotLeft;
            const fill = tab.fill;

            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <div
                    ref={(element) => {
                      if (element) tabRefs.current.set(id, element);
                      else tabRefs.current.delete(id);
                    }}
                    id={tab.tabDomId}
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={tab.panelDomId}
                    tabIndex={isActive ? 0 : -1}
                    data-guidance={tab['data-guidance']}
                    data-editor-tab
                    onKeyDown={(event) => {
                      handleTabKeyDown(tab, event);
                    }}
                    onPointerDown={(event) => {
                      handlePointerDown(tab, event);
                    }}
                    onPointerMove={handlePointerMove}
                    onPointerUp={(event) => {
                      handlePointerUp(tab, event);
                    }}
                    style={{
                      width: widths[index],
                      transform: `translateX(${String(translateX)}px)`,
                      ...(fill ? { color: fill.foreground } : {}),
                    }}
                    className={cn(
                      'group absolute top-0 left-0 flex h-[32px] items-center text-[13px] select-none',
                      isDragging
                        ? 'z-20 cursor-grabbing'
                        : cn(
                            'z-1 transition-[transform,color] duration-150 ease-out',
                            onReorder ? 'cursor-grab' : 'cursor-default',
                          ),
                      isActive ? 'z-10' : 'hover:text-foreground',
                      !fill && (isActive ? 'text-foreground' : 'text-description'),
                      fill && !isActive && 'opacity-80 hover:opacity-100',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      data-testid="editor-tab-fill"
                      style={
                        fill
                          ? ({
                              '--editor-tab-fill': isActive ? fill.active : fill.inactive,
                              '--editor-tab-fill-hover': fill.active,
                            } as React.CSSProperties)
                          : undefined
                      }
                      className={cn(
                        'pointer-events-none absolute inset-x-[2px] inset-y-[4px] rounded-[4px] transition-colors duration-150',
                        fill
                          ? 'bg-(--editor-tab-fill) group-hover:bg-(--editor-tab-fill-hover) group-focus-within:bg-(--editor-tab-fill-hover)'
                          : isActive
                            ? 'bg-editor-tab-active-background'
                            : 'bg-transparent group-hover:bg-editor-tab-hover-background group-focus-within:bg-editor-tab-hover-background',
                      )}
                    />

                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        value={draftTitle}
                        onChange={(event) => {
                          dispatchInteraction({
                            type: 'renameDraftChanged',
                            title: event.target.value,
                          });
                        }}
                        onBlur={finishRename}
                        onKeyDown={handleRenameKeyDown}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
                        className="relative z-10 mx-[8px] h-[24px] w-full min-w-0 bg-transparent text-[13px] outline-none"
                        aria-label="Rename tab"
                      />
                    ) : (
                      <span
                        className={cn(
                          'pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-[6px] pl-[8px] text-left whitespace-nowrap',
                          onClose ? 'pr-[28px]' : 'pr-[8px]',
                        )}
                        data-testid="editor-tab-title"
                      >
                        {tab.icon ? <span className="shrink-0">{tab.icon}</span> : null}
                        <span
                          className="min-w-0 overflow-hidden [text-overflow:clip]"
                          style={
                            isOverflowing
                              ? {
                                  maskImage:
                                    'linear-gradient(to right, black calc(100% - 24px), transparent)',
                                  WebkitMaskImage:
                                    'linear-gradient(to right, black calc(100% - 24px), transparent)',
                                }
                              : undefined
                          }
                        >
                          {displayTitle}
                        </span>
                      </span>
                    )}

                    <span
                      ref={(element) => {
                        if (element) titleMeasureRefs.current.set(id, element);
                        else titleMeasureRefs.current.delete(id);
                      }}
                      aria-hidden="true"
                      data-testid="editor-tab-title-measure"
                      className="pointer-events-none invisible absolute w-max text-[13px] whitespace-nowrap"
                    >
                      {displayTitle}
                    </span>

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
                          'group/close absolute top-[4px] right-[2px] z-20 flex size-[24px] items-center justify-center transition-[color,opacity] hover:text-foreground focus-visible:text-foreground focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100 group-focus-within:opacity-100',
                          isActive
                            ? 'text-foreground/70 opacity-100'
                            : 'text-description opacity-0',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          data-testid="close-tab-highlight"
                          className="pointer-events-none absolute inset-[2px] rounded-[3px] bg-transparent transition-colors group-hover/close:bg-foreground/10 group-focus-visible/close:bg-foreground/10"
                        />
                        <X className="relative z-10 size-[16px]" />
                      </button>
                    ) : null}
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="max-w-xs border border-surface-border bg-widget px-3 py-2 text-body text-widget-foreground"
                >
                  {displayTitle}
                </TooltipContent>
              </Tooltip>
            );
          })}

          {onCreate ? (
            <button
              type="button"
              aria-label="New tab"
              onClick={onCreate}
              style={{ transform: `translateX(${String(totalWidth)}px)` }}
              className="group/create absolute top-0 left-0 z-1 flex size-[32px] items-center justify-center text-description transition-colors hover:text-foreground focus-visible:outline-none"
            >
              <span className="flex size-[24px] items-center justify-center rounded-[4px] group-hover/create:bg-panel group-focus-visible/create:bg-panel">
                <Plus className="size-[16px]" />
              </span>
            </button>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}
