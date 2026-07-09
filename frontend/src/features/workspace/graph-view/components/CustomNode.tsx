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
import { type WorkspaceNode } from '@/features/workspace/data-view/types';
import { cn } from '@/lib/utils';
import { normalizeNodeAccentColor } from '@/lib/nodeColor';
import {
  CUSTOM_NODE_TOOLBAR_BUTTON_CLASS,
  CustomNodeActionMenu,
} from './CustomNodeActionMenu';
import { CustomNodeRenameForm } from './CustomNodeRenameForm';
import {
  releaseToolbarOwner,
  setActiveToolbarOwner,
  useCustomNodeToolbarOwner,
} from './customNodeToolbarOwner';

interface CustomNodeData extends Record<string, unknown> {
  node: WorkspaceNode;
  isMultiSelected?: boolean;
  /** True for nodes that appeared mid-session (detach / join / stack /
   * clone outputs etc.) and haven't been interacted with yet. Triggers
   * the red "new" dot in the graph + sidebar. Cleared by ``markInteracted``
   * in useFreshNodesStore on first click / selection. */
  isFresh?: boolean;
  onDelete: (nodeId: string) => void;
  onRename?: (nodeId: string, newName: string) => void;
  onCopy?: (nodeId: string) => void;
  onUndo?: (nodeId: string) => void;
  onRedo?: (nodeId: string) => void;
  /** Requests that this node is added to the active view's node inputs. */
  onAddToSelection?: (nodeId: string) => void;
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
  isRenaming: boolean;
  newName: string;
  copied: boolean;
  isHovered: boolean;
  isToolbarHovered: boolean;
  showDeleteConfirm: boolean;
}

type CustomNodeUiAction =
  | { type: 'set-menu'; showMenu: boolean; opensUp?: boolean; opensRight?: boolean }
  | { type: 'start-rename'; name: string }
  | { type: 'set-rename-name'; name: string }
  | { type: 'cancel-rename' }
  | { type: 'copy-id' }
  | { type: 'copy-id-reset' }
  | { type: 'show-toolbar' }
  | { type: 'set-toolbar-hovered'; isToolbarHovered: boolean }
  | { type: 'hide-toolbar' }
  | { type: 'open-delete-confirm' }
  | { type: 'set-delete-confirm'; showDeleteConfirm: boolean };

const initialCustomNodeUiState: CustomNodeUiState = {
  showMenu: false,
  menuOpensUp: false,
  menuOpensRight: false,
  isRenaming: false,
  newName: '',
  copied: false,
  isHovered: false,
  isToolbarHovered: false,
  showDeleteConfirm: false,
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
    case 'start-rename':
      return {
        ...state,
        showMenu: false,
        isRenaming: true,
        newName: action.name,
      };
    case 'set-rename-name':
      return { ...state, newName: action.name };
    case 'cancel-rename':
      return { ...state, isRenaming: false, newName: '' };
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
    default:
      return state;
  }
}

/**
 * React Flow node renderer for a workspace node. Shows a compact card when zoomed
 * out, and a full card with metadata + action menu when zoomed in.
 * Rendered by: workspace/CustomNode module JSX because React Flow needs this custom node type for workspace data blocks.
 * Flow: React Flow passes node data, zoom and selection choose compact or full rendering, and actions invoke workspace mutations.
 */
function CustomNode({ id, data, selected }: NodeProps<ReactFlowNode<CustomNodeData>>) {
  const {
    node,
    isFresh = false,
    onDelete,
    onRename,
    onCopy,
    onUndo,
    onRedo,
    onAddToSelection,
  } = data;
  // Visual state is selection (React Flow ``selected``) plus an optional
  // per-node accent: a valid ``node.color`` paints a coloured left spine on the
  // card (see ``accentBorderStyle``) without tinting the header/body, so the
  // node name stays high-contrast.
  const isSelected = selected;
  const [uiState, dispatchUi] = useReducer(customNodeUiReducer, initialCustomNodeUiState);
  const {
    showMenu,
    menuOpensUp,
    menuOpensRight,
    isRenaming,
    newName,
    copied,
    isHovered,
    isToolbarHovered,
    showDeleteConfirm,
  } = uiState;
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const zoom = useStore((s) => s.transform[2]);
  const isZoomedOut = zoom < COMPACT_NODE_ZOOM_THRESHOLD;

  // Which node currently owns the visible hover toolbar (singleton across the
  // whole graph). When another node claims ownership, this re-renders and our
  // hover toolbar hides immediately.
  const activeToolbarId = useCustomNodeToolbarOwner();

  const nodeName = node.name || 'Loading...';
  const nodeShape = node.shape;

  // Optional per-node accent. A valid ``#rrggbb`` ``Node.color`` is drawn as a
  // solid left spine on both the full and compact card so the colour reads
  // clearly while the header/body backgrounds stay untouched for text contrast.
  // Empty object when unset spreads to nothing, leaving the default card look.
  const accentColor = normalizeNodeAccentColor(node.color);
  const accentBorderStyle: React.CSSProperties = accentColor
    ? { borderLeftColor: accentColor, borderLeftWidth: 6, borderLeftStyle: 'solid' }
    : {};

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
    if (node.node_id) {
      onDelete(node.node_id);
    }
    dispatchUi({ type: 'set-delete-confirm', showDeleteConfirm: false });
  };

  /**
   * Starts inline rename mode from the node settings menu.
   */
  const handleRenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatchUi({ type: 'start-rename', name: node.name || '' });
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 10);
  };

  /**
   * Submits the inline node rename form.
   */
  const handleRenameSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onRename && node.node_id && newName.trim()) {
      onRename(node.node_id, newName.trim());
    }
    dispatchUi({ type: 'cancel-rename' });
  };

  /**
   * Leaves inline rename mode without changing the node name.
   */
  const handleRenameCancel = () => {
    dispatchUi({ type: 'cancel-rename' });
  };

  /**
   * Lets Escape cancel inline rename without graph interaction.
   */
  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleRenameCancel();
    }
  };

  /**
   * Clones the node from the settings menu.
   */
  const handleCopyNode = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatchUi({ type: 'set-menu', showMenu: false });
    if (onCopy && node.node_id) {
      onCopy(node.node_id);
    }
  };

  /**
   * Runs node undo when the backend reports it is available.
   */
  const handleUndoNode = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatchUi({ type: 'set-menu', showMenu: false });
    if (onUndo && node.node_id && node.can_undo) {
      onUndo(node.node_id);
    }
  };

  /**
   * Runs node redo when the backend reports it is available.
   */
  const handleRedoNode = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatchUi({ type: 'set-menu', showMenu: false });
    if (onRedo && node.node_id && node.can_redo) {
      onRedo(node.node_id);
    }
  };

  /**
   * Copies the node id for debugging and user support workflows.
   */
  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.node_id) {
      void navigator.clipboard.writeText(node.node_id);
      dispatchUi({ type: 'copy-id' });
      setTimeout(() => {
        dispatchUi({ type: 'copy-id-reset' });
      }, 2000);
    }
  };

  // True when this node currently owns the popped-out action toolbar/menu: an
  // open settings menu, an open delete dialog, or a hover while this node is the
  // singleton toolbar owner. Drives both the toolbar's visibility and a matching
  // highlight on the node card. The toolbar is offset below the node, so
  // highlighting its owner removes any ambiguity about which node a floating
  // menu belongs to when nodes sit close together.
  const isToolbarActive =
    showMenu || showDeleteConfirm || ((isHovered || isToolbarHovered) && activeToolbarId === id);

  // Visual treatment: selected nodes get a primary border + ring; all
  // others use the flat default card look. ``node.color`` (when set) is layered
  // on as a coloured left spine via ``accentBorderStyle`` on the card element.
  // A node with its toolbar/menu popped out gets a stronger primary ring +
  // elevated shadow so the offset toolbar is clearly tied to it (twMerge lets
  // the active ring win over the softer selection ring when both apply).
  const nodeClasses = cn(
    'w-64 rounded-lg border-2 bg-white text-sm transition-all duration-150 ease-in-out shadow-md',
    isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
    isToolbarActive && 'border-primary ring-2 ring-primary shadow-lg',
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
    if (node.node_id) onAddToSelection?.(node.node_id);
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
      isVisible={isToolbarActive}
      position={Position.Bottom}
      align="center"
      offset={0}
      className="nodrag nopan flex items-center gap-1 rounded-lg border border-border bg-white/95 p-1 shadow-lg"
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
        canUndo={node.can_undo}
        canRedo={node.can_redo}
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
        onUndoNode={handleUndoNode}
        onRedoNode={handleRedoNode}
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
        aria-label="Add node to selection"
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
            This will permanently delete this node and its data. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteConfirm}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
      className="pointer-events-none absolute right-0 top-0 z-20 h-3 w-3 rounded-full bg-red-500 ring-2 ring-white"
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
      'flex items-start rounded-lg border-2 p-4 transition-all duration-150 ease-in-out shadow-md',
      isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
      // Match the full card: highlight the node whose toolbar/menu is popped out.
      isToolbarActive && 'border-primary ring-2 ring-primary shadow-lg',
    );
    return (
      <div
        className={compactClasses}
        onMouseEnter={showToolbar}
        onMouseLeave={hideToolbar}
        style={{
          minWidth: '180px',
          maxWidth: '300px',
          position: 'relative',
          // ``isFresh`` red "new" dot rendered below marks newly-created
          // nodes the user hasn't acknowledged yet.
          ...accentBorderStyle,
        }}
      >
        {newDot}
        {nodeToolbar}
        <div
          className="pr-16 font-bold text-3xl leading-snug whitespace-normal"
          style={{
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            hyphens: 'auto',
          }}
          title={nodeName}
        >
          {nodeName}
        </div>
        <Handle
          type="target"
          position={Position.Left}
          className="w-2! h-2! bg-gray-400! opacity-0 pointer-events-none"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="w-2! h-2! bg-gray-400! opacity-0 pointer-events-none"
        />
        {deleteDialog}
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
        minWidth: '256px',
        minHeight: '120px',
        position: 'relative',
        ...accentBorderStyle,
      }}
    >
      {newDot}
      {/* Node Header — primary-tinted strip when selected, muted otherwise. */}
      <div
        className={cn(
          'flex items-start justify-between p-2 rounded-t-lg border-b-2 min-h-fit relative',
          isSelected ? 'bg-primary/10 border-primary/40' : 'bg-muted border-border',
        )}
      >
        <div className="flex items-center flex-1 mr-2">
          {isRenaming ? (
            <CustomNodeRenameForm
              inputRef={renameInputRef}
              value={newName}
              onValueChange={(name) => {
                dispatchUi({ type: 'set-rename-name', name });
              }}
              onSubmit={handleRenameSubmit}
              onCancel={handleRenameCancel}
              onKeyDown={handleRenameKeyDown}
            />
          ) : (
            <div
              className="font-bold text-sm leading-tight overflow-hidden"
              style={{
                wordBreak: 'break-all',
                overflowWrap: 'anywhere',
                hyphens: 'auto',
              }}
              title={nodeName}
            >
              {nodeName}
            </div>
          )}
        </div>
      </div>

      {/* Node Body */}
      <div className="p-3 bg-white rounded-b-lg space-y-1">
        <div className="flex items-center justify-between group">
          <div className="font-mono text-xs text-gray-500 truncate max-w-45" title={node.node_id}>
            id: {node.node_id.substring(0, 8)}...
          </div>
          <button
            onClick={handleCopyId}
            className="p-1 hover:bg-gray-100 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            title="Copy ID"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3 text-gray-400" />
            )}
          </button>
        </div>
        {shapeLabel ? (
          <div className="font-mono text-xs text-gray-700">Shape: {shapeLabel}</div>
        ) : (
          <div className="font-mono text-xs text-gray-400 italic">Shape unavailable</div>
        )}
      </div>

      {/* Passive handles so backend edges can attach; UI connections remain disabled by parent ReactFlow props */}
      <Handle
        type="target"
        position={Position.Left}
        className="w-2! h-2! bg-gray-400! opacity-0 pointer-events-none"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-2! h-2! bg-gray-400! opacity-0 pointer-events-none"
      />
      {nodeToolbar}
      {deleteDialog}
    </div>
  );
}

export default CustomNode;
