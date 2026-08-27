import type React from 'react';
import { cn } from '@/lib/utils';
import { normalizeNodeAccentColor } from '@/lib/nodeColor';
import { GREY, VIZ_TINT_FOREGROUND, toBgColor } from '@/features/views/common/vizPalette';
import { DataBlockName } from '@/components/DataBlockName';
import { useFreshNodesStore } from '@/stores/freshNodesStore';
import { usePinnedNodesStore } from '@/stores/pinnedNodesStore';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { WorkspaceGraphNode } from '@/api';

const EMPTY_FRESH_IDS = new Set<string>();

interface WorkspaceNodeListProps {
  workspaceId: string | null;
  nodes: WorkspaceGraphNode[];
  selectedNodeIds: string[];
  onToggleNodeSelection: (nodeId: string) => void;
  /** Action rendered for a pinned row while the row is not hovered. */
  renderPinnedRowAction: (node: WorkspaceGraphNode) => React.ReactNode;
  /** Hover actions rendered for every node row. */
  renderRowActions: (node: WorkspaceGraphNode) => React.ReactNode;
}

/** Called by: WorkspaceNodeList row onKeyDown handlers. */
const isActivationKey = (event: React.KeyboardEvent<HTMLDivElement>): boolean =>
  event.key === 'Enter' || event.key === ' ';

/**
 * Selectable node list shown in the sidebar's Data Blocks section. It
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
      (workspaceId ? state.freshIdsByWorkspace.get(workspaceId) : undefined) ?? EMPTY_FRESH_IDS,
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
  const selectedIdSet = new Set(selectedNodeIds);
  const pinnedIdSet = new Set(pinnedNodeIds.filter((id) => nodeById.has(id)));
  const pinnedNodes = pinnedNodeIds
    .map((id) => nodeById.get(id))
    .filter((node): node is WorkspaceGraphNode => node !== undefined);
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
                const displayName = node.name || 'Untitled data block';
                const checked = selectedNodeIds.includes(node.id);
                const isFresh = freshIds.has(node.id);
                const isPinned = pinnedIdSet.has(node.id);
                const pinnedRowAction = isPinned ? renderPinnedRowAction(node) : null;
                const rowActions = renderRowActions(node);
                // Block colour: the row is filled with the light background tint of
                // the block's colour (grey for unset / un-analysed blocks) with a 4px
                // full-colour spine on the left. The tint is theme-independent, so
                // the name always uses the dark tint foreground. Selection is
                // independent and uses one detached theme-inverse outline.
                const effectiveColor = normalizeNodeAccentColor(node.color) ?? GREY;
                const rowBackgroundColor = toBgColor(effectiveColor);

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
                        {/* Inner box carries the tinted surface, colour spine, and selection halo. */}
                        <div
                          className={cn(
                            'relative flex min-h-control items-center gap-2 overflow-visible rounded-md border border-surface-border px-3 py-1 text-body group-focus-visible/row:ring-1 group-focus-visible/row:ring-inset group-focus-visible/row:ring-focus',
                            isPinned && pinnedRowAction && 'pl-8',
                            checked &&
                              'outline outline-2 outline-offset-2 outline-data-block-selection',
                          )}
                          data-testid={`workspace-node-row-${node.id}`}
                          style={{
                            backgroundColor: rowBackgroundColor,
                            color: VIZ_TINT_FOREGROUND,
                            borderLeftColor: effectiveColor,
                            borderLeftWidth: 4,
                            borderLeftStyle: 'solid',
                          }}
                        >
                          {pinnedRowAction && (
                            <div
                              data-testid="pinned-row-pin-action"
                              className="absolute top-1/2 left-1 z-10 flex -translate-y-1/2 items-center opacity-100 group-hover/row:invisible group-hover/row:pointer-events-none group-hover/row:opacity-0 group-focus-within/row:invisible group-focus-within/row:pointer-events-none group-focus-within/row:opacity-0"
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
                          <DataBlockName
                            name={displayName}
                            backgroundColor={rowBackgroundColor}
                            maxLines={1}
                            fadeEdge="head"
                            className="min-w-0 flex-1 text-body font-semibold leading-snug"
                            fadeClassName="group-hover/row:w-28 group-hover/row:opacity-100 group-focus-within/row:w-28 group-focus-within/row:opacity-100"
                          />
                          {isFresh && (
                            <span
                              className="pointer-events-none h-2 w-2 shrink-0 rounded-full bg-error transition-opacity duration-150 group-hover/row:opacity-0 group-focus-within/row:opacity-0"
                              title="New data block"
                              aria-label="New data block"
                            />
                          )}
                          {rowActions && (
                            // Hover-revealed leading buttons sit directly on the
                            // identity surface without a second card around them.
                            // Stop row-toggle when interacting with the actions.
                            <div
                              className="invisible pointer-events-none absolute top-1/2 left-1 flex -translate-y-1/2 items-center opacity-0 group-hover/row:visible group-hover/row:!pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:visible group-focus-within/row:!pointer-events-auto group-focus-within/row:opacity-100"
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
                              aria-label={`Actions for ${displayName}`}
                            >
                              {rowActions}
                            </div>
                          )}
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      align="center"
                      className="max-w-80 wrap-break-word"
                    >
                      {displayName}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md bg-list-hover/40 px-2 py-2 text-label-secondary text-description">
              No data blocks
            </div>
          )}
        </div>
      </TooltipProvider>
    </div>
  );
}

export default WorkspaceNodeList;
