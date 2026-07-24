import { Bookmark, OctagonX, Plus, Search, Trash2, X } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
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
import type { ResolvedPreset } from '../nodeInputs/useTabNodeInputs';
import { VIZ_PALETTE } from '../vizPalette';
import { NodeColorPicker } from './NodeColorPicker';
import { NodeColumnSelector } from './NodeColumnSelector';
import { NodeSelectionList, type NodeSelectionRenderArgs } from './NodeSelectionList';

const CLEAR_COLUMN_VALUE = '__ldaca__clear__';

/** Args passed to a feature-provided per-node column addon (e.g. tokenizer model picker). */
export interface NodeInputColumnAddonArgs extends NodeSelectionRenderArgs {
  column: string;
  columns: string[];
}

export interface NodeInputsPanelProps {
  /** Resolved (live, stale-dropped) inputs from useNodeInputs. */
  resolvedNodes: ResolvedNodeInput[];
  /** Live workspace nodes not yet added — the Add dropdown's candidate list. */
  availableNodes: WorkspaceNodeMetadata[];
  /** Node ids currently selected in the graph (source for "Add preset" → current selection). */
  graphSelectedIds?: string[];
  /** Recently-used node groups for the "Add preset" list. */
  recentPresets?: ResolvedPreset[];
  /** Whether another node may be added (max-nodes gate). */
  canAddMore: boolean;
  /** Exact max supplied by the active feature; the shared panel never invents a generic cap. */
  maxNodes?: number;
  /** Append nodes by id; returns rejections so the panel can surface reasons. */
  onAddNodes: (ids: string[]) => NodeAddRejection[];
  /** Per-candidate structural add-eligibility reason (null = addable). */
  getAddRejection: (id: string) => string | null;
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
  showAddControls?: boolean;
  showRemoveButtons?: boolean;
  columnLabel?: ReactNode | ((args: NodeSelectionRenderArgs) => ReactNode);
  title?: string;
  className?: string;
  originalCount?: number;
  emptyMessage?: React.ReactNode;
  statusMessage?: React.ReactNode;
  statusVariant?: 'info' | 'warning' | 'error';
  headerAddon?: React.ReactNode;
  renderNodeMeta?: (args: NodeSelectionRenderArgs) => React.ReactNode;
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
 * Owns the Add control (graph selection + per-node dropdown, structurally
 * invalid candidates greyed with a reason), per-node remove (x), and Clear all,
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
 * empty. Single-selector views consume graph/sidebar "+" requests directly in
 * ``useTabNodeInputs``; multi-selector views opt out there, leaving the pending
 * request for every visible panel with add controls to render as a dashed
 * choose-target overlay.
 */
export function NodeInputsPanel({
  resolvedNodes,
  availableNodes,
  graphSelectedIds = [],
  recentPresets = [],
  canAddMore,
  maxNodes,
  onAddNodes,
  getAddRejection,
  onRemoveNode,
  onClear,
  onColumnChange,
  defaultPalette = VIZ_PALETTE,
  nodeColors,
  onNodeColorChange,
  showColumnPicker = true,
  showAddControls = true,
  showRemoveButtons = true,
  columnLabel = 'Text Column:',
  title = 'Selected Data Blocks',
  className,
  originalCount,
  emptyMessage,
  statusMessage,
  statusVariant = 'warning',
  headerAddon,
  renderNodeMeta,
  renderExtraNodeContent,
  disabled = false,
  renderColumnAddon,
  columnAddonWidth = 'fill',
}: NodeInputsPanelProps) {
  const { currentWorkspaceId } = useWorkspaceData();
  const currentView = useUIStore((state) => state.currentView);
  const consumeInputRequest = useNodeInputRequestsStore((state) => state.consume);
  const pendingInputRequest = useNodeInputRequestsStore((state) =>
    state.requests.find(
      (request) => request.workspaceId === currentWorkspaceId && request.view === currentView,
    ),
  );
  const nodes = resolvedNodes.map((r) => r.node);
  const nodeIds = resolvedNodes.map((r) => r.id);
  const columnByNode = new Map(resolvedNodes.map((r) => [r.id, r]));
  const [blockSearch, setBlockSearch] = useState('');
  const [blockOpen, setBlockOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);

  /** Adds ids and reports any rejection reasons as a single toast. */
  const handleAdd = (ids: string[]) => {
    if (!ids.length) return;
    const rejections = onAddNodes(ids);
    if (rejections.length === 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length===1 guarantees index 0 exists
      toast.warning(`Couldn't add node: ${rejections[0]!.reason}`);
    } else if (rejections.length > 1) {
      toast.warning(`Couldn't add ${String(rejections.length)} nodes (already added or full).`);
    }
  };

  /** Graph-selected ids that aren't already inputs — the "current selection" preset. */
  const addableGraphIds = graphSelectedIds.filter((id) => !nodeIds.includes(id));

  /** Available nodes filtered by the search box (case-insensitive name match). */
  const filteredAvailableNodes = useMemo(() => {
    const q = blockSearch.trim().toLowerCase();
    if (!q) return availableNodes;
    return availableNodes.filter((node) => node.name.toLowerCase().includes(q));
  }, [availableNodes, blockSearch]);

  /** Resolves graph-selected addable ids to display names for the preset entry. */
  const graphSelectionLabels = useMemo(() => {
    const byId = new Map(availableNodes.map((node) => [node.id, node.name]));
    return addableGraphIds.map((id) => byId.get(id) ?? id);
  }, [availableNodes, addableGraphIds]);

  const hasPresets = addableGraphIds.length > 0 || recentPresets.length > 0;

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

  const count = originalCount ?? resolvedNodes.length;
  const countLabel = maxNodes != null ? `${String(count)}/${String(maxNodes)}` : String(count);
  const showInputRequestTarget = showAddControls && pendingInputRequest !== undefined;
  const inputRequestTargetFilled = !canAddMore;
  const inputRequestTargetDisabled = disabled || !canAddMore;
  const statusVariantClass = {
    info: 'border-sky-500/50 bg-sky-100/60 text-sky-900',
    warning: 'border-amber-500/60 bg-amber-100/60 text-amber-900',
    error: 'border-destructive/50 bg-destructive/10 text-destructive',
  }[statusVariant];

  return (
    <div className={cn('@container/node-inputs relative flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 px-3 pt-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label className="block text-sm font-medium text-muted-foreground">
            {title} ({countLabel})
          </label>
          {headerAddon}
        </div>
        {showAddControls && (
          <div
            data-testid="node-inputs-actions"
            className="ml-auto flex flex-wrap items-center justify-end gap-1.5 @max-[430px]/node-inputs:ml-0 @max-[430px]/node-inputs:basis-full @max-[430px]/node-inputs:justify-start"
          >
            {resolvedNodes.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={onClear}
                disabled={disabled}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Clear all
              </Button>
            )}

            {/* Add preset: current graph selection + recently-used groups. */}
            <Popover open={presetOpen} onOpenChange={setPresetOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={disabled || !canAddMore || !hasPresets}
                >
                  <Bookmark className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Add preset
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-0">
                <div className="max-h-72 overflow-y-auto py-1">
                  {addableGraphIds.length > 0 && (
                    <>
                      <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Current graph selection
                      </div>
                      <button
                        type="button"
                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted/60"
                        onClick={() => {
                          handleAdd(addableGraphIds);
                          setPresetOpen(false);
                        }}
                      >
                        <span className="truncate font-medium">
                          Current selection ({addableGraphIds.length})
                        </span>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {graphSelectionLabels.join(', ')}
                        </span>
                      </button>
                    </>
                  )}
                  {recentPresets.length > 0 && (
                    <>
                      <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Recent
                      </div>
                      {recentPresets.map((preset, idx) => (
                        <button
                          key={`${preset.ids.join('|')}-${String(idx)}`}
                          type="button"
                          disabled={preset.addableIds.length === 0}
                          title={
                            preset.addableIds.length === 0
                              ? 'All of these are already added or unavailable'
                              : undefined
                          }
                          className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            handleAdd(preset.addableIds);
                            setPresetOpen(false);
                          }}
                        >
                          <span className="truncate">{preset.labels.join(', ')}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </PopoverContent>
            </Popover>

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
                  className="h-7 px-2 text-xs"
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
                      className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      autoFocus
                      value={blockSearch}
                      onChange={(e) => {
                        setBlockSearch(e.target.value);
                      }}
                      placeholder="Search data blocks…"
                      className="h-8 pl-7 text-sm"
                    />
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto py-1">
                  {filteredAvailableNodes.length === 0 ? (
                    <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                      No matching data blocks
                    </div>
                  ) : (
                    filteredAvailableNodes.map((node) => {
                      const id = node.id;
                      const reason = getAddRejection(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          disabled={Boolean(reason)}
                          title={reason ?? undefined}
                          className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            handleAdd([id]);
                            setBlockOpen(false);
                            setBlockSearch('');
                          }}
                        >
                          <span className="truncate">{node.name}</span>
                          {reason && (
                            <span className="text-[10px] text-muted-foreground">{reason}</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      {statusMessage && (
        <div className="px-3">
          <div
            className={cn('rounded-md border px-3 py-2 text-xs leading-snug', statusVariantClass)}
          >
            {statusMessage}
          </div>
        </div>
      )}

      {resolvedNodes.length === 0 ? (
        <div className="mx-3 rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-3 text-sm italic text-muted-foreground">
          {emptyMessage ?? (
            <>
              No data blocks selected. Use{' '}
              <span className="font-medium not-italic">Add data block</span> or{' '}
              <span className="font-medium not-italic">Add preset</span>, or select node(s) in the
              workspace graph and add them from a node&apos;s <span className="not-italic">+</span>{' '}
              button.
            </>
          )}
        </div>
      ) : (
        <NodeSelectionList
          nodes={nodes}
          nodeIds={nodeIds}
          palette={defaultPalette}
          nodeColors={nodeColors}
          maxCompare={maxNodes ?? nodes.length}
          onRemoveNode={showRemoveButtons && !disabled ? onRemoveNode : undefined}
          renderNodeMeta={renderNodeMeta}
          renderNodeBody={showColumnPicker ? renderColumnBody : undefined}
          renderExtraNodeContent={renderExtraNodeBody}
        />
      )}
      {maxNodes != null && count > maxNodes && (
        <div className="mt-1 flex items-center gap-1 px-3 text-sm text-amber-600">
          Maximum {maxNodes} data block{maxNodes === 1 ? '' : 's'} allowed here. Currently {count}{' '}
          selected.
        </div>
      )}
      {showInputRequestTarget ? (
        <div className="absolute inset-0 z-10 rounded-lg bg-background/75 p-1 backdrop-blur-[1px]">
          <button
            type="button"
            aria-label={inputRequestTargetFilled ? `${title} is already filled` : `Add to ${title}`}
            disabled={inputRequestTargetDisabled}
            className={cn(
              'flex h-full min-h-24 w-full items-center justify-center gap-5 rounded-lg border-2 border-dashed border-muted-foreground/35 bg-card/95 px-7 text-left transition-colors',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
              inputRequestTargetFilled
                ? 'border-destructive/60 bg-destructive/5'
                : 'hover:border-primary/70 hover:bg-card disabled:opacity-60',
            )}
            onClick={() => {
              handleAdd(pendingInputRequest.nodeIds);
              consumeInputRequest(pendingInputRequest.id);
            }}
          >
            {inputRequestTargetFilled ? (
              <OctagonX
                className="size-10 stroke-[1.7] text-destructive"
                data-testid="filled-selector-stop-icon"
                aria-hidden="true"
              />
            ) : (
              <Plus className="size-10 stroke-[1.7] text-muted-foreground" aria-hidden="true" />
            )}
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-base font-semibold text-foreground">{title}</span>
              <span
                className={cn(
                  'text-xs',
                  inputRequestTargetFilled ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {inputRequestTargetFilled
                  ? 'This selector is already filled. Choose another selector.'
                  : `Add selected node${pendingInputRequest.nodeIds.length === 1 ? '' : 's'} here`}
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label="Cancel adding node"
            className="absolute right-3 top-3 inline-flex h-7 items-center gap-1 rounded-md bg-background/90 px-2 text-xs text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              consumeInputRequest(pendingInputRequest.id);
            }}
          >
            <X className="size-3.5" aria-hidden="true" />
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
