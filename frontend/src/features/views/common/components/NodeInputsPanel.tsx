import { ListPlus, OctagonX, Plus, Search, Trash2, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores';
import { useNodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import type { NodeAddRejection, ResolvedNodeInput } from '../nodeInputs/nodeInputsCore';
import { VIZ_PALETTE } from '../vizPalette';
import { NodeColorPicker } from './NodeColorPicker';
import { NodeColumnSelector } from './NodeColumnSelector';
import {
  NodeSelectionList,
  type NodeSelectionItem,
  type NodeSelectionRenderArgs,
  type UnavailableNodeSelection,
} from './NodeSelectionList';

const CLEAR_COLUMN_VALUE = '__ldaca__clear__';

/** Args passed to a feature-provided per-node column addon (e.g. tokenizer model picker). */
export interface NodeInputColumnAddonArgs extends NodeSelectionRenderArgs {
  column: string;
  columns: string[];
}

export interface NodeInputsPanelProps {
  /** Resolved (live, stale-dropped) inputs from useNodeInputs. */
  resolvedNodes: ResolvedNodeInput[];
  /** Saved inputs whose Data Blocks no longer exist in the live Workspace. */
  unavailableNodes?: UnavailableNodeSelection[];
  /** Full saved input order when live and unavailable cards must remain interleaved. */
  inputOrder?: string[];
  /** Live workspace nodes not yet added — the Add dropdown's candidate list. */
  availableNodes: WorkspaceNodeMetadata[];
  /** Whether another node may be added (max-nodes gate). */
  canAddMore: boolean;
  /** Show one action that adds every currently available Data Block. */
  showAddAll?: boolean;
  /** Exact max supplied by the active feature; the shared panel never invents a generic cap. */
  maxNodes?: number;
  /** Number of cards shown before the selected list scrolls horizontally. */
  maxVisibleCards?: number;
  /** Append nodes by id; returns rejections so the panel can surface reasons. */
  onAddNodes: (ids: string[]) => NodeAddRejection[];
  /** Remove one node. */
  onRemoveNode: (id: string) => void;
  /** Clear all inputs. */
  onClear: () => void;
  /** Change a node's chosen column. */
  onColumnChange: (nodeId: string, column: string) => void;
  /** Palette used to assign fallback colours by position when a node lacks Node.color. */
  defaultPalette?: string[];
  /** Effective per-node colours for analyses that colour results by selected source node. */
  nodeColors?: Record<string, string>;
  /** Optional persisted colour change handler rendered inside selected-node cards. */
  onNodeColorChange?: (nodeId: string, color: string) => void;
  showColumnPicker?: boolean;
  columnLabel?: ReactNode | ((args: NodeSelectionRenderArgs) => ReactNode);
  title?: string;
  /** Optional compact header anchor for Contextual Hints. */
  guidanceTarget?: string;
  emptyMessage?: React.ReactNode;
  renderExtraNodeContent?: (args: NodeInputColumnAddonArgs) => React.ReactNode;
  /** Disable all mutation controls (e.g. while a run is in flight). */
  disabled?: boolean;
  /** Optional control rendered after each node's column picker (e.g. tokenizer model). */
  renderColumnAddon?: (args: NodeInputColumnAddonArgs) => React.ReactNode;
  /** Whether a column add-on should fill its grid track or keep its intrinsic width. */
  columnAddonWidth?: 'fill' | 'auto';
}

/**
 * Node-input selection panel for the add-node-as-needed model.
 *
 * Owns the searchable Add control, per-node remove (x), and Clear all,
 * on top of the existing column picker rendered via NodeSelectionList.
 *
 * Used by: every analysis *Feature and preprocessing subtab through their
 * ``useNodeInputs`` result, so each view shares one curate-your-inputs surface
 * while persistence (tab inputs / preprocessing store / local state) differs.
 *
 * Flow: surface add affordances bound to ``onAddNodes`` (reporting rejections
 * via toast), then render each resolved node as a removable card with its
 * column picker fed by the node's resolved ``columnOptions``; when a feature's
 * type filter leaves no options, the node stays selected and the picker renders
 * empty. Single-selector views consume graph/sidebar additions immediately;
 * in multi-selector views each panel renders a dashed placement target for the
 * shared carried stack.
 */
export function NodeInputsPanel({
  resolvedNodes,
  unavailableNodes = [],
  inputOrder,
  availableNodes,
  canAddMore,
  showAddAll = false,
  maxNodes,
  maxVisibleCards,
  onAddNodes,
  onRemoveNode,
  onClear,
  onColumnChange,
  defaultPalette = VIZ_PALETTE,
  nodeColors,
  onNodeColorChange,
  showColumnPicker = true,
  columnLabel = 'Text Column:',
  title = 'Selected Data Blocks',
  guidanceTarget,
  emptyMessage,
  renderExtraNodeContent,
  disabled = false,
  renderColumnAddon,
  columnAddonWidth = 'fill',
}: NodeInputsPanelProps) {
  const { currentWorkspaceId } = useWorkspaceData();
  const currentView = useUIStore((state) => state.currentView);
  const consumeInputRequest = useNodeInputRequestsStore((state) => state.consume);
  const pendingRequests = useNodeInputRequestsStore((state) => state.pendingRequests);
  const pendingInputRequest = pendingRequests.findLast(
    (request) => request.workspaceId === currentWorkspaceId && request.view === currentView,
  );
  const nodeIds = resolvedNodes.map((r) => r.id);
  const selectionItemById = new Map<string, NodeSelectionItem>([
    ...resolvedNodes.map((resolved): [string, NodeSelectionItem] => [
      resolved.id,
      { kind: 'available', id: resolved.id, node: resolved.node },
    ]),
    ...unavailableNodes.map((selection): [string, NodeSelectionItem] => [
      selection.id,
      { kind: 'unavailable', id: selection.id, selection },
    ]),
  ]);
  const selectionItems = (inputOrder ?? [...nodeIds, ...unavailableNodes.map((node) => node.id)])
    .map((nodeId) => selectionItemById.get(nodeId))
    .filter((item): item is NodeSelectionItem => item !== undefined);
  const columnByNode = new Map(resolvedNodes.map((r) => [r.id, r]));
  const [blockSearch, setBlockSearch] = useState('');
  const [blockOpen, setBlockOpen] = useState(false);

  /** Adds ids and reports any rejection reasons as a single toast. */
  const handleAdd = (ids: string[]) => {
    if (!ids.length) return false;
    const rejections = onAddNodes(ids);
    if (rejections.length === 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length===1 guarantees index 0 exists
      toast.warning(`Couldn't add node: ${rejections[0]!.reason}`);
    } else if (rejections.length > 1) {
      toast.warning(`Couldn't add ${String(rejections.length)} nodes (already added or full).`);
    }
    return rejections.length === 0;
  };

  /** Available nodes filtered by the search box (case-insensitive name match). */
  const normalizedBlockSearch = blockSearch.trim().toLowerCase();
  const filteredAvailableNodes = normalizedBlockSearch
    ? availableNodes.filter((node) => node.name.toLowerCase().includes(normalizedBlockSearch))
    : availableNodes;

  /** Renders the per-node column picker body inside each card. */
  const renderColumnBody = (args: NodeSelectionRenderArgs) => {
    if (!showColumnPicker) return null;
    const { nodeId } = args;
    const resolved = columnByNode.get(nodeId);
    const columns = (resolved?.columnOptions ?? []).map((c) => c.name);
    const value = resolved?.column.length ? resolved.column : CLEAR_COLUMN_VALUE;
    const label = typeof columnLabel === 'function' ? columnLabel(args) : columnLabel;
    const selector = (
      <NodeColumnSelector
        key="column"
        columns={columns}
        value={value}
        preserveValue={resolved?.column}
        clearOptionValue={CLEAR_COLUMN_VALUE}
        label={label}
        disabled={disabled}
        noColumnsMessage="No columns available"
        onChange={(next) => {
          onColumnChange(nodeId, next === CLEAR_COLUMN_VALUE ? '' : next);
        }}
      />
    );
    const addon = renderColumnAddon?.({ ...args, column: resolved?.column ?? '', columns });
    const colorControl = onNodeColorChange ? (
      <NodeColorPicker
        key="color"
        nodeName={args.node.name}
        color={args.color}
        presets={defaultPalette}
        disabled={disabled}
        onChange={(nextColor) => {
          onNodeColorChange(nodeId, nextColor);
        }}
      />
    ) : null;
    const controls = [
      selector,
      ...(addon
        ? [
            <div
              key="addon"
              className={cn('min-w-0', columnAddonWidth === 'auto' && 'w-max max-w-full')}
              data-testid="node-inputs-column-addon"
            >
              {addon}
            </div>,
          ]
        : []),
      ...(colorControl ? [colorControl] : []),
    ];
    if (controls.length === 1) return selector;
    let columnLayout = 'md:grid-cols-3';
    if (colorControl) {
      columnLayout =
        controls.length === 2
          ? 'md:grid-cols-[minmax(0,1fr)_auto]'
          : columnAddonWidth === 'auto'
            ? 'md:grid-cols-[minmax(0,1fr)_auto_auto]'
            : 'md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]';
    } else if (controls.length === 2) {
      columnLayout =
        columnAddonWidth === 'auto' ? 'md:grid-cols-[minmax(0,1fr)_auto]' : 'md:grid-cols-2';
    }
    return (
      <div className={cn('grid items-end gap-2', columnLayout)} data-testid="node-inputs-controls">
        {controls}
      </div>
    );
  };

  /** Renders optional per-node content with the same resolved column context as column add-ons. */
  const renderExtraNodeBody = renderExtraNodeContent
    ? (args: NodeSelectionRenderArgs) => {
        const resolved = columnByNode.get(args.nodeId);
        const columns = (resolved?.columnOptions ?? []).map((c) => c.name);
        return renderExtraNodeContent({
          ...args,
          column: resolved?.column ?? '',
          columns,
        });
      }
    : undefined;

  const count = selectionItems.length;
  const countLabel = maxNodes != null ? `${String(count)}/${String(maxNodes)}` : String(count);
  const showInputRequestTarget = pendingInputRequest !== undefined;
  const inputRequestTargetFilled = !canAddMore;
  const inputRequestTargetDisabled = disabled || !canAddMore;

  return (
    <div className="@container/node-inputs relative flex flex-col gap-2">
      <div
        data-guidance={guidanceTarget}
        role="group"
        aria-label={`${title} controls`}
        className="scroll-mt-16 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 px-3 pt-1.5"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label className="block text-body font-medium text-description">
            {title} ({countLabel})
          </label>
        </div>
        <div
          data-testid="node-inputs-actions"
          className="ml-auto flex flex-wrap items-center justify-end gap-1.5 @max-[430px]/node-inputs:ml-0 @max-[430px]/node-inputs:basis-full @max-[430px]/node-inputs:justify-start"
        >
          {selectionItems.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-label-secondary text-description"
              onClick={onClear}
              disabled={disabled}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Clear all
            </Button>
          )}

          {showAddAll && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-label-secondary"
              disabled={disabled || !canAddMore || availableNodes.length === 0}
              onClick={() => {
                handleAdd(availableNodes.map((node) => node.id));
              }}
            >
              <ListPlus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Add All
            </Button>
          )}

          {/* Add data block: searchable list of addable workspace nodes. */}
          <Popover
            open={blockOpen}
            onOpenChange={(open) => {
              setBlockOpen(open);
              if (!open) setBlockSearch('');
            }}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-label-secondary"
                disabled={disabled || !canAddMore || availableNodes.length === 0}
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Add data block
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-0">
              <div className="border-b p-2">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-description"
                    aria-hidden="true"
                  />
                  <Input
                    autoFocus
                    value={blockSearch}
                    onChange={(e) => {
                      setBlockSearch(e.target.value);
                    }}
                    placeholder="Search data blocks…"
                    className="h-8 pl-7 text-body"
                  />
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {filteredAvailableNodes.length === 0 ? (
                  <div className="px-3 py-3 text-center text-label-secondary text-description">
                    No matching data blocks
                  </div>
                ) : (
                  filteredAvailableNodes.map((node) => {
                    const id = node.id;
                    return (
                      <button
                        key={id}
                        type="button"
                        className="flex w-full items-start px-3 py-2 text-left text-body hover:bg-panel/60"
                        onClick={() => {
                          handleAdd([id]);
                          setBlockOpen(false);
                          setBlockSearch('');
                        }}
                      >
                        <span className="truncate">{node.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {selectionItems.length === 0 ? (
        <div className="mx-3 rounded-md border border-dashed border-surface-border-foreground/40 bg-panel/40 p-3 text-body italic text-description">
          {emptyMessage ?? (
            <>
              No data blocks selected. Use{' '}
              <span className="font-medium not-italic">Add data block</span>, or carry one here from
              a Data Block&apos;s <span className="not-italic">+</span> button.
            </>
          )}
        </div>
      ) : (
        <NodeSelectionList
          items={selectionItems}
          palette={defaultPalette}
          nodeColors={nodeColors}
          maxCompare={maxVisibleCards ?? maxNodes ?? selectionItems.length}
          onRemoveNode={!disabled ? onRemoveNode : undefined}
          renderNodeBody={showColumnPicker ? renderColumnBody : undefined}
          renderExtraNodeContent={renderExtraNodeBody}
        />
      )}
      {maxNodes != null && count > maxNodes && (
        <div className="mt-1 flex items-center gap-1 px-3 text-body text-warning">
          Maximum {maxNodes} data block{maxNodes === 1 ? '' : 's'} allowed here. Currently {count}{' '}
          selected.
        </div>
      )}
      {showInputRequestTarget ? (
        <div className="absolute inset-0 z-10 rounded-lg bg-editor/75 p-1">
          <button
            type="button"
            aria-label={inputRequestTargetFilled ? `${title} is already filled` : `Add to ${title}`}
            disabled={inputRequestTargetDisabled}
            className={cn(
              'flex h-full min-h-24 w-full items-center justify-center gap-5 rounded-lg border-2 border-dashed border-surface-border-foreground/35 bg-surface/95 px-7 text-left transition-colors',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed',
              inputRequestTargetFilled
                ? 'border-error/60 bg-error/5'
                : 'hover:border-button/70 hover:bg-surface disabled:opacity-60',
            )}
            onClick={() => {
              if (handleAdd([pendingInputRequest.nodeId])) {
                consumeInputRequest(pendingInputRequest.id);
              }
            }}
          >
            {inputRequestTargetFilled ? (
              <OctagonX
                className="size-10 stroke-[1.7] text-error"
                data-testid="filled-selector-stop-icon"
                aria-hidden="true"
              />
            ) : (
              <Plus className="size-10 stroke-[1.7] text-description" aria-hidden="true" />
            )}
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-body font-semibold text-foreground">{title}</span>
              <span
                className={cn(
                  'text-label-secondary',
                  inputRequestTargetFilled ? 'text-error' : 'text-description',
                )}
              >
                {inputRequestTargetFilled
                  ? 'This selector is already filled. Choose another selector.'
                  : 'Place the latest carried Data Block here'}
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label="Discard latest carried Data Block"
            className="absolute right-3 top-3 inline-flex h-7 items-center gap-1 rounded-md bg-editor/90 px-2 text-label-secondary text-description hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus"
            onClick={() => {
              consumeInputRequest(pendingInputRequest.id);
            }}
          >
            <X className="size-3.5" aria-hidden="true" />
            Discard top
          </button>
        </div>
      ) : null}
    </div>
  );
}
