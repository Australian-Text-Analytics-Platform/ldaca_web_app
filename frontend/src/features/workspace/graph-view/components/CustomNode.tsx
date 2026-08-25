import { useEffect, useReducer, useRef } from 'react';
import {
  type NodeProps,
  Handle,
  NodeToolbar,
  Position,
  useStore,
  type Node as ReactFlowNode,
} from '@xyflow/react';
import { Copy, Check, Plus } from 'lucide-react';
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
import type { WorkspaceGraphNodeCard } from '../graphNodeModel';
import { cn } from '@/lib/utils';
import { normalizeNodeAccentColor } from '@/lib/nodeColor';
import { GREY, foregroundForVizColor } from '@/features/views/common/vizPalette';
import { DataBlockName } from '@/components/DataBlockName';
import type { NodeInputPointerPosition } from '@/stores/nodeInputRequestsStore';
import { CUSTOM_NODE_TOOLBAR_BUTTON_CLASS, CustomNodeActionMenu } from './CustomNodeActionMenu';
import { DataBlockExportDialog } from '@/features/workspace/common/components/DataBlockExportDialog';
import { DataBlockRenameDialog } from '@/features/workspace/common/components/DataBlockRenameDialog';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import {
  releaseToolbarOwner,
  setActiveToolbarOwner,
  useCustomNodeToolbarOwner,
} from './customNodeToolbarOwner';

interface CustomNodeData extends Record<string, unknown> {
  node: WorkspaceGraphNodeCard;
  /** True for nodes that appeared mid-session (analysis creation / join / stack /
   * clone outputs etc.) and haven't been interacted with yet. Triggers
   * the red "new" dot in the graph + sidebar. Cleared by ``markInteracted``
   * in useFreshNodesStore on first click / selection. */
  isFresh: boolean;
  onDelete: (nodeId: string) => void;
  onRename: (nodeId: string, newName: string) => void;
  onCopy: (nodeId: string) => void;
  onUndo: (nodeId: string) => void;
  onRedo: (nodeId: string) => void;
  /** Requests that this node is added to the active view's node inputs. */
  onAddToSelection: (nodeId: string, pointer?: NodeInputPointerPosition) => void;
}

const COMPACT_NODE_ZOOM_THRESHOLD = 0.6;

interface CustomNodeUiState {
  showMenu: boolean;
  /** When ``showMenu`` is open, whether the dropdown expands upward instead of
   * downward. Decided at open time from the space below the trigger so a node
   * near the graph's bottom edge shows a fully-visible menu rather than one
   * clipped by the viewport. */
  menuOpensUp: boolean;
  /** When ``showMenu`` is open, whether the dropdown extends to the right
   * (anchored ``left-0``) instead of the default leftward extension (``right-0``).
   * Decided at open time from the space beside the trigger so a node near the
   * graph's left edge isn't clipped on the left. */
  menuOpensRight: boolean;
  renameOpen: boolean;
  renameValue: string;
  copied: boolean;
  isHovered: boolean;
  isToolbarHovered: boolean;
  showDeleteConfirm: boolean;
  showExportDialog: boolean;
}

type CustomNodeUiAction =
  | { type: 'set-menu'; showMenu: boolean; opensUp?: boolean; opensRight?: boolean }
  | { type: 'open-rename'; name: string }
  | { type: 'set-rename-value'; value: string }
  | { type: 'set-rename-open'; open: boolean }
  | { type: 'copy-id' }
  | { type: 'copy-id-reset' }
  | { type: 'show-toolbar' }
  | { type: 'set-toolbar-hovered'; isToolbarHovered: boolean }
  | { type: 'hide-toolbar' }
  | { type: 'open-delete-confirm' }
  | { type: 'set-delete-confirm'; showDeleteConfirm: boolean }
  | { type: 'open-export-dialog' }
  | { type: 'set-export-dialog'; showExportDialog: boolean };

const initialCustomNodeUiState: CustomNodeUiState = {
  showMenu: false,
  menuOpensUp: false,
  menuOpensRight: false,
  renameOpen: false,
  renameValue: '',
  copied: false,
  isHovered: false,
  isToolbarHovered: false,
  showDeleteConfirm: false,
  showExportDialog: false,
};

/**
 * Keeps CustomNode's transient interaction modes in one reducer.
 * Used by: CustomNode because menu, rename, copy feedback, hover toolbar, and
 * delete confirmation are mutually related UI modes for the same graph card.
 * Flow: menu actions can enter rename/delete, rename owns the draft name until
 * submit/cancel, hover actions reveal or hide the floating toolbar, and copy id
 * toggles short-lived feedback without affecting graph selection.
 */
function customNodeUiReducer(
  state: CustomNodeUiState,
  action: CustomNodeUiAction,
): CustomNodeUiState {
  switch (action.type) {
    case 'set-menu':
      return {
        ...state,
        showMenu: action.showMenu,
        menuOpensUp: action.opensUp ?? false,
        menuOpensRight: action.opensRight ?? false,
      };
    case 'open-rename':
      return {
        ...state,
        showMenu: false,
        renameOpen: true,
        renameValue: action.name,
      };
    case 'set-rename-value':
      return { ...state, renameValue: action.value };
    case 'set-rename-open':
      return {
        ...state,
        renameOpen: action.open,
        renameValue: action.open ? state.renameValue : '',
      };
    case 'copy-id':
      return { ...state, copied: true };
    case 'copy-id-reset':
      return { ...state, copied: false };
    case 'show-toolbar':
      return { ...state, isHovered: true };
    case 'set-toolbar-hovered':
      return { ...state, isToolbarHovered: action.isToolbarHovered };
    case 'hide-toolbar':
      return { ...state, isHovered: false, isToolbarHovered: false };
    case 'open-delete-confirm':
      return { ...state, showMenu: false, showDeleteConfirm: true };
    case 'set-delete-confirm':
      return { ...state, showDeleteConfirm: action.showDeleteConfirm };
    case 'open-export-dialog':
      return { ...state, showMenu: false, showExportDialog: true };
    case 'set-export-dialog':
      return { ...state, showExportDialog: action.showExportDialog };
    default:
      return state;
  }
}

/**
 * React Flow node renderer for a workspace node. Shows a compact card when zoomed
 * out, and a full card with metadata + action menu when zoomed in.
 * Rendered within `CustomNode` because React Flow needs this custom node type for workspace data blocks.
 * Flow: React Flow passes node data, zoom and selection choose compact or full rendering, and actions invoke workspace mutations.
 */
function CustomNode({ id, data, selected }: NodeProps<ReactFlowNode<CustomNodeData>>) {
  const { node, isFresh, onDelete, onRename, onCopy, onUndo, onRedo, onAddToSelection } = data;
  const { currentWorkspaceId, currentWorkspace } = useWorkspaceData();
  // Selection and identity are deliberately independent: the persisted Data
  // Block colour fills the name surface, while React Flow selection adds one
  // detached, theme-inverse outline around the card.
  const isSelected = selected;
  const [uiState, dispatchUi] = useReducer(customNodeUiReducer, initialCustomNodeUiState);
  const {
    showMenu,
    menuOpensUp,
    menuOpensRight,
    renameOpen,
    renameValue,
    copied,
    isHovered,
    isToolbarHovered,
    showDeleteConfirm,
    showExportDialog,
  } = uiState;
  const menuRef = useRef<HTMLDivElement>(null);

  const zoom = useStore((s) => s.transform[2]);
  const isZoomedOut = zoom < COMPACT_NODE_ZOOM_THRESHOLD;

  // Which node currently owns the visible hover toolbar (singleton across the
  // whole graph). When another node claims ownership, this re-renders and our
  // hover toolbar hides immediately.
  const activeToolbarId = useCustomNodeToolbarOwner();

  const nodeName = node.name;
  const nodeShape = node.shape;

  // Per-node colour. A valid ``#rrggbb`` ``Node.color`` is the block's identity
  // colour; unset / un-analysed blocks default to grey. Saturated colour fills
  // the identity surface, with the higher-contrast light or dark name colour.
  const effectiveColor = normalizeNodeAccentColor(node.color) ?? GREY;
  const identityForeground = foregroundForVizColor(effectiveColor);

  /** Shows this node's toolbar and claims singleton ownership so any other
   * node's hover toolbar hides at once. Called on node/toolbar mouse-enter. */
  const showToolbar = () => {
    dispatchUi({ type: 'show-toolbar' });
    setActiveToolbarOwner(id);
  };

  /** Hides this node's toolbar immediately and releases ownership. Called when
   * the pointer leaves the node or the toolbar. There is no node/toolbar gap to
   * bridge (the toolbar sits flush against the node), so the toolbar can vanish
   * at once with no grace period. */
  const hideToolbar = () => {
    dispatchUi({ type: 'hide-toolbar' });
    releaseToolbarOwner(id);
  };

  useEffect(
    () => () => {
      releaseToolbarOwner(id);
    },
    [id],
  );

  // Close menu when clicking outside (capture to beat React Flow internal handlers)
  useEffect(() => {
    if (!showMenu) return;
    /**
     * Closes the node menu when a captured pointer event lands outside it.
     */
    const handlePointerDown = (event: Event) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        dispatchUi({ type: 'set-menu', showMenu: false });
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    };
  }, [showMenu]);

  /**
   * Opens delete confirmation without letting the graph select the node.
   */
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatchUi({ type: 'open-delete-confirm' });
  };

  /**
   * Confirms deletion through the graph action passed from useWorkspaceGraph.
   */
  const handleDeleteConfirm = () => {
    if (node.id) {
      onDelete(node.id);
    }
    dispatchUi({ type: 'set-delete-confirm', showDeleteConfirm: false });
  };

  /**
   * Opens the shared Data Block rename dialog from the node settings menu.
   */
  const handleRenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatchUi({ type: 'open-rename', name: node.name });
  };

  /**
   * Clones the node from the settings menu.
   */
  const handleCopyNode = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatchUi({ type: 'set-menu', showMenu: false });
    onCopy(node.id);
  };

  /** Opens single-Data-Block export from the settings menu. */
  const handleExportClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatchUi({ type: 'open-export-dialog' });
  };

  /** Undoes the Data Block's latest session edit from the settings menu. */
  const handleUndo = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatchUi({ type: 'set-menu', showMenu: false });
    onUndo(node.id);
  };

  /** Redoes the Data Block's latest undone session edit from the settings menu. */
  const handleRedo = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatchUi({ type: 'set-menu', showMenu: false });
    onRedo(node.id);
  };

  /**
   * Copies the node id for debugging and user support workflows.
   */
  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.id) {
      void navigator.clipboard.writeText(node.id);
      dispatchUi({ type: 'copy-id' });
      setTimeout(() => {
        dispatchUi({ type: 'copy-id-reset' });
      }, 2000);
    }
  };

  // The settings menu remains mounted when the pointer leaves the node. Plain
  // hover visibility still belongs to the singleton owner so only one graph
  // toolbar can be visible at a time. Dialogs do not keep toolbar chrome alive
  // behind their modal overlays.
  const isToolbarVisible = showMenu || ((isHovered || isToolbarHovered) && activeToolbarId === id);

  // The detached outline is the sole persistent node-state decoration.
  const nodeClasses = cn(
    'w-80 rounded-md border border-surface-border bg-surface text-body',
    isSelected && 'outline outline-2 outline-offset-2 outline-data-block-selection',
  );

  /**
   * Formats row/column counts for the node shape label.
   */
  const formatShapePart = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '?';

  const shapeLabel = `${formatShapePart(nodeShape[0])} × ${formatShapePart(nodeShape[1])}`;

  /** Stops React Flow from treating side-control pointer events as node clicks/drags. */
  const stopGraphControlEvent = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  /**
   * Requests this node as an input for the active view without letting the
   * click bubble into React Flow's node drag/select handlers.
   * Called by: the fixed-size NodeToolbar "+" button.
   */
  const handleAddClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToSelection(node.id, e.detail > 0 ? { x: e.clientX, y: e.clientY } : undefined);
  };

  /**
   * Fixed-pixel-size action toolbar rendered by React Flow outside the scaled
   * node transform. Best practice for zoomable canvases: keep interactive
   * controls out of the zoomed content layer and reveal them only for the
   * hovered item, so dense layouts are not permanently occluded. Selection
   * state intentionally does not affect visibility.
   */
  const nodeToolbar = (
    <NodeToolbar
      nodeId={id}
      isVisible={isToolbarVisible}
      position={Position.Bottom}
      align="center"
      offset={0}
      className="nodrag nopan flex items-center gap-1 rounded-md border border-surface-border bg-surface p-1"
      onMouseEnter={() => {
        dispatchUi({ type: 'set-toolbar-hovered', isToolbarHovered: true });
        setActiveToolbarOwner(id);
      }}
      onMouseLeave={hideToolbar}
      onPointerDownCapture={stopGraphControlEvent}
      onMouseDownCapture={stopGraphControlEvent}
    >
      <CustomNodeActionMenu
        menuRef={menuRef}
        showMenu={showMenu}
        menuOpensUp={menuOpensUp}
        menuOpensRight={menuOpensRight}
        onMenuChange={(willOpen, placement) => {
          dispatchUi({
            type: 'set-menu',
            showMenu: willOpen,
            opensUp: placement?.opensUp ?? false,
            opensRight: placement?.opensRight ?? false,
          });
          setActiveToolbarOwner(id);
        }}
        onRenameClick={handleRenameClick}
        onCopyNode={handleCopyNode}
        onExportClick={handleExportClick}
        canUndo={node.canUndo}
        canRedo={node.canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onDeleteClick={handleDeleteClick}
        stopGraphControlEvent={stopGraphControlEvent}
      />
      <button
        type="button"
        onPointerDown={stopGraphControlEvent}
        onMouseDown={stopGraphControlEvent}
        onClick={handleAddClick}
        className={CUSTOM_NODE_TOOLBAR_BUTTON_CLASS}
        title="Add to selection"
        aria-label="Add Data Block to selection"
      >
        <Plus className="h-4 w-4" />
      </button>
    </NodeToolbar>
  );

  const deleteDialog = (
    <AlertDialog
      open={showDeleteConfirm}
      onOpenChange={(open) => {
        dispatchUi({ type: 'set-delete-confirm', showDeleteConfirm: open });
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-all">
            Delete &ldquo;{nodeName}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this Data Block and its data. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteConfirm}
            className="bg-error text-button-foreground hover:bg-error/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const exportDialog = (
    <DataBlockExportDialog
      open={showExportDialog}
      onOpenChange={(open) => {
        dispatchUi({ type: 'set-export-dialog', showExportDialog: open });
      }}
      workspaceId={currentWorkspaceId ?? ''}
      workspaceName={currentWorkspace?.name ?? ''}
      dataBlock={{ id: node.id, name: node.name }}
    />
  );

  const renameDialog = (
    <DataBlockRenameDialog
      open={renameOpen}
      onOpenChange={(open) => {
        dispatchUi({ type: 'set-rename-open', open });
      }}
      currentName={node.name}
      value={renameValue}
      onValueChange={(value) => {
        dispatchUi({ type: 'set-rename-value', value });
      }}
      onRename={(name) => {
        onRename(node.id, name);
      }}
    />
  );

  // Red "new" dot for nodes that appeared mid-session and haven't been
  // interacted with yet (``isFresh``). Cleared on first click/selection
  // via markInteracted. Absolute-positioned in the node's top-right.
  //
  // The dot lives inside the zoom-scaled node, so at low zoom it would shrink to
  // near-invisible. Cancel the viewport zoom so it keeps a constant on-screen
  // size (and a constant 4px corner poke-out) at any zoom, matching the
  // fixed-size NodeToolbar menu. React Flow clamps zoom to [0.05, 4], so the
  // inverse is always finite. Transform order matters: ``scale`` pivots on the
  // top-right corner (pinned to the node corner via ``top-0 right-0``) to hold a
  // stable anchor, then the leading ``translate`` — authored in unscaled world
  // px as 4 / zoom — lands as a fixed 4px once the viewport multiplies it by
  // zoom, so the badge never drifts off the corner as you zoom in.
  const newDotInverseScale = 1 / zoom;
  const newDotPokeOutPx = 4 * newDotInverseScale;
  const newDot = isFresh ? (
    <span
      className="pointer-events-none absolute right-0 top-0 z-20 h-3 w-3 rounded-full bg-error ring-1 ring-surface"
      style={{
        transform: `translate(${String(newDotPokeOutPx)}px, ${String(-newDotPokeOutPx)}px) scale(${String(newDotInverseScale)})`,
        transformOrigin: 'top right',
      }}
      title="New data block"
      aria-label="New data block"
    />
  ) : null;

  if (isZoomedOut) {
    // Compact view keeps critical controls visible while preserving the compact footprint.
    const compactClasses = cn(
      'flex items-start rounded-md border border-surface-border p-3',
      isSelected && 'outline outline-2 outline-offset-2 outline-data-block-selection',
    );
    return (
      <div
        className={compactClasses}
        data-testid="custom-node-compact-card"
        onMouseEnter={showToolbar}
        onMouseLeave={hideToolbar}
        style={{
          minWidth: '220px',
          maxWidth: '360px',
          position: 'relative',
          backgroundColor: effectiveColor,
          color: identityForeground,
          // ``isFresh`` red "new" dot rendered below marks newly-created
          // nodes the user hasn't acknowledged yet.
        }}
      >
        {newDot}
        {nodeToolbar}
        <DataBlockName
          name={nodeName}
          backgroundColor={effectiveColor}
          maxLines={3}
          fadeEdge="head"
          className="w-full text-heading-1 font-semibold leading-snug"
          title={nodeName}
        />
        <Handle
          type="target"
          position={Position.Left}
          className="w-2! h-2! bg-panel-foreground! opacity-0 pointer-events-none"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="w-2! h-2! bg-panel-foreground! opacity-0 pointer-events-none"
        />
        {deleteDialog}
        {exportDialog}
        {renameDialog}
      </div>
    );
  }

  return (
    <div
      className={nodeClasses}
      data-testid="custom-node-card"
      onMouseEnter={showToolbar}
      onMouseLeave={hideToolbar}
      style={{
        minWidth: '320px',
        minHeight: '120px',
        position: 'relative',
      }}
    >
      {newDot}
      {/* The saturated header is the persistent identity surface; the neutral
          body keeps metadata quiet and selection stays outside the card. */}
      <div
        data-testid="custom-node-identity-header"
        className="relative flex min-h-fit items-start justify-between rounded-t-md border-b border-surface-border px-3 py-2"
        style={{ backgroundColor: effectiveColor, color: identityForeground }}
      >
        <div className="flex min-w-0 flex-1 items-center">
          <DataBlockName
            name={nodeName}
            backgroundColor={effectiveColor}
            maxLines={3}
            className="w-full text-body font-semibold leading-snug"
            title={nodeName}
          />
        </div>
      </div>

      {/* Node Body */}
      <div className="space-y-1 rounded-b-md bg-surface p-3">
        <div className="flex items-center justify-between group">
          <div
            className="font-mono text-label-secondary text-description truncate max-w-45"
            title={node.id}
          >
            id: {node.id.substring(0, 8)}…
          </div>
          <button
            onClick={handleCopyId}
            className="p-1 hover:bg-panel rounded-sm transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            title="Copy ID"
          >
            {copied ? (
              <Check className="h-3 w-3 text-[var(--vscode-charts-green)]" />
            ) : (
              <Copy className="h-3 w-3 text-description" />
            )}
          </button>
        </div>
        {shapeLabel ? (
          <div className="font-mono text-label-secondary text-foreground">Shape: {shapeLabel}</div>
        ) : (
          <div className="font-mono text-label-secondary text-description italic">
            Shape unavailable
          </div>
        )}
      </div>

      {/* Passive handles so backend edges can attach; UI connections remain disabled by parent ReactFlow props */}
      <Handle
        type="target"
        position={Position.Left}
        className="w-2! h-2! bg-panel-foreground! opacity-0 pointer-events-none"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-2! h-2! bg-panel-foreground! opacity-0 pointer-events-none"
      />
      {nodeToolbar}
      {deleteDialog}
      {exportDialog}
      {renameDialog}
    </div>
  );
}

export default CustomNode;
