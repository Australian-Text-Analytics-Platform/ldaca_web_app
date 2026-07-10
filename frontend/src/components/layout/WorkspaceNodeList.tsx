import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { cn } from '@/lib/utils';
import { normalizeNodeAccentColor } from '@/lib/nodeColor';
import { useFreshNodesStore } from '@/stores/freshNodesStore';
import { usePinnedNodesStore } from '@/stores/pinnedNodesStore';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { SidebarWorkspaceNode } from './sidebar/types';

const EMPTY_FRESH_IDS = new Set<string>();

interface WorkspaceNodeListProps {
  workspaceId: string | null;
  nodes: SidebarWorkspaceNode[];
  selectedNodeIds?: string[];
  onToggleNodeSelection: (nodeId: string) => void;
  /** Optional action rendered for a pinned row while the row is not hovered. */
  renderPinnedRowAction?: (node: SidebarWorkspaceNode) => React.ReactNode;
  /** Optional actions rendered for each node row (e.g. the
   * right-panel list view's per-node action toolbar + schema magnifier). When
   * omitted, rows render without a toolbar. */
  renderRowActions?: (node: SidebarWorkspaceNode) => React.ReactNode;
}

/**
 * Renders a data-block name with a left-edge fade and right-aligned text.
 * Used by: WorkspaceNodeList rows because long path-like node names are more
 * useful when their suffix stays visible and leading row actions fade over the
 * clipped prefix instead of forcing an ellipsis at the right edge.
 * Flow: measure text overflow, use RTL clipping only when the name exceeds the
 * row width, and show the left fade while clipped or while leading actions are
 * visible on hover/focus.
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
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    observer.observe(text);
    return () => {
      observer.disconnect();
    };
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
      <span
        data-testid="node-name-left-fade"
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-10 bg-linear-to-r from-background via-background/90 to-transparent group-hover/row:w-32',
          overflowing ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
        )}
      />
    </span>
  );
}

/** Called by: WorkspaceNodeList sorting and row labels. */
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
 * Rendered by: the sidebar Data Blocks section because graph selection and
 * fresh-node acknowledgement must stay aligned with visible rows.
 * Flow: read fresh state and pinned ids, order pinned/selected/regular nodes,
 * then render toggleable node rows.
 */
function WorkspaceNodeList({
  workspaceId,
  nodes,
  selectedNodeIds,
  onToggleNodeSelection,
  renderPinnedRowAction,
  renderRowActions,
}: WorkspaceNodeListProps) {
  const pinnedNodeIds = usePinnedNodesStore((state) => state.pinnedNodeIds);

  const freshIds = useFreshNodesStore(
    (state) =>
      (workspaceId ? state.freshnessByWorkspace.get(workspaceId)?.freshIds : undefined) ??
      EMPTY_FRESH_IDS,
  );
  const markInteracted = useFreshNodesStore(
    (state) =>
      // eslint-disable-next-line @typescript-eslint/unbound-method -- zustand action is bound to the store and does not rely on `this`
      state.markInteracted,
  );

  /** Called by: WorkspaceNodeList row click and keyboard activation handlers. */
  const handleToggle = (nodeId: string) => {
    if (workspaceId) markInteracted(workspaceId, [nodeId]);
    onToggleNodeSelection(nodeId);
  };

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const selectedIdSet = new Set(selectedNodeIds ?? []);
  const pinnedIdSet = new Set(pinnedNodeIds.filter((id) => nodeById.has(id)));
  const pinnedNodes = pinnedNodeIds
    .map((id) => nodeById.get(id))
    .filter((node): node is SidebarWorkspaceNode => node !== undefined);
  const selectedNodes = nodes.filter(
    (node) => selectedIdSet.has(node.id) && !pinnedIdSet.has(node.id),
  );
  const regularNodes = nodes.filter(
    (node) => !selectedIdSet.has(node.id) && !pinnedIdSet.has(node.id),
  );
  const orderedNodes = [...pinnedNodes, ...selectedNodes, ...regularNodes];

  return (
    <div className="flex flex-col gap-2">
      <TooltipProvider delayDuration={120} skipDelayDuration={0}>
        <div className="relative">
        {nodes.length ? (
          <div className="space-y-1.5 pr-1">
            {orderedNodes.map((node) => {
              const displayName = getNodeDisplayName(node) || 'Untitled data block';
              const checked = selectedNodeIds?.includes(node.id) ?? false;
              const isFresh = freshIds.has(node.id);
              const isPinned = pinnedIdSet.has(node.id);
              const pinnedRowAction = isPinned ? renderPinnedRowAction?.(node) : null;
              const rowActions = renderRowActions?.(node);
              // Persisted node colour drawn as a thin left spine on the row so
              // the right-aligned name and its left fade stay fully legible.
              const accentColor = normalizeNodeAccentColor(node.color);

              return (
                <Tooltip key={node.id}>
                  <TooltipTrigger asChild>
                    <div
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
                        data-testid={`workspace-node-row-${node.id}`}
                        style={
                          accentColor
                            ? {
                                borderLeftColor: accentColor,
                                borderLeftWidth: '4px',
                                borderLeftStyle: 'solid',
                              }
                            : undefined
                        }
                      >
                        {pinnedRowAction && (
                          <div
                            data-testid="pinned-row-pin-action"
                            className="absolute top-1/2 left-1 z-10 flex -translate-y-1/2 items-center opacity-100 group-hover/row:pointer-events-none group-hover/row:opacity-0"
                            onPointerDown={(event) => {
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                            }}
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
                          // Hover-revealed leading actions, absolutely positioned
                          // so the row keeps one stable height while names fade.
                          // Stop row-toggle when interacting with the actions.
                          <div
                            className="absolute top-1/2 left-1 flex -translate-y-1/2 items-center opacity-0 pointer-events-none group-hover/row:!pointer-events-auto group-hover/row:opacity-100"
                            onPointerDown={(event) => {
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                            }}
                            role="toolbar"
                            tabIndex={-1}
                            aria-label={`Actions for ${displayName}`}
                          >
                            {rowActions}
                          </div>
                        )}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" align="center" className="max-w-80 wrap-break-word">
                    {displayName}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ) : (
          <div className="rounded-md bg-accent/40 px-2 py-2 text-xs text-muted-foreground">
            No data blocks
          </div>
        )}
        </div>
      </TooltipProvider>
    </div>
  );
}

export default WorkspaceNodeList;
