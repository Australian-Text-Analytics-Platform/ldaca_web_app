import { useEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import {
  type NodeProps,
  Handle,
  NodeToolbar,
  Position,
  useStore,
  type Node as ReactFlowNode,
} from '@xyflow/react';
import { Settings2, Copy, Check, Plus } from 'lucide-react';
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
const TOOLBAR_HIDE_DELAY_MS = 350;

interface CustomNodeUiState {
  showMenu: boolean;
  isRenaming: boolean;
  newName: string;
  copied: boolean;
  isHovered: boolean;
  isToolbarHovered: boolean;
  showDeleteConfirm: boolean;
}

type CustomNodeUiAction =
  | { type: 'set-menu'; showMenu: boolean }
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
      return { ...state, showMenu: action.showMenu };
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
 * Module-level singleton tracking which node currently owns the visible hover
 * toolbar. Because each ``CustomNode`` keeps its own hover state, this shared
 * owner is what guarantees only ONE hover toolbar is shown across the whole
 * graph: when a node claims ownership (on hover), every other node re-renders
 * and immediately hides its hover toolbar.
 *
 * Used by: CustomNode via ``useSyncExternalStore`` (read) and the
 * show/hide handlers (write).
 */
let activeToolbarNodeId: string | null = null;
const toolbarOwnerListeners = new Set<() => void>();

/** Sets the active toolbar owner and notifies subscribed nodes. No-op when unchanged. */
function setActiveToolbarOwner(nodeId: string | null): void {
  if (activeToolbarNodeId === nodeId) return;
  activeToolbarNodeId = nodeId;
  for (const listener of toolbarOwnerListeners) listener();
}

/** Subscribes a node to owner changes; used by ``useSyncExternalStore``. */
function subscribeToolbarOwner(listener: () => void): () => void {
  toolbarOwnerListeners.add(listener);
  return () => {
    toolbarOwnerListeners.delete(listener);
  };
}

/** Returns the current owner id; used by ``useSyncExternalStore``. */
function getToolbarOwnerSnapshot(): string | null {
  return activeToolbarNodeId;
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
  // Selection is the only visual state now (no per-node colours): a node
  // is either selected (React Flow ``selected``) or not.
  const isSelected = selected;
  const [uiState, dispatchUi] = useReducer(customNodeUiReducer, initialCustomNodeUiState);
  const { showMenu, isRenaming, newName, copied, isHovered, isToolbarHovered, showDeleteConfirm } =
    uiState;
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const toolbarHideTimeoutRef = useRef<number | null>(null);

  const zoom = useStore((s) => s.transform[2]);
  const isZoomedOut = zoom < COMPACT_NODE_ZOOM_THRESHOLD;

  // Which node currently owns the visible hover toolbar (singleton across the
  // whole graph). When another node claims ownership, this re-renders and our
  // hover toolbar hides immediately.
  const activeToolbarId = useSyncExternalStore(
    subscribeToolbarOwner,
    getToolbarOwnerSnapshot,
    getToolbarOwnerSnapshot,
  );

  const nodeName = node.name || 'Loading...';
  const nodeShape = node.shape;

  /** Cancels any pending delayed toolbar hide. */
  const cancelToolbarHide = () => {
    if (toolbarHideTimeoutRef.current !== null) {
      window.clearTimeout(toolbarHideTimeoutRef.current);
      toolbarHideTimeoutRef.current = null;
    }
  };

  /** Shows this node's toolbar immediately and claims singleton ownership so any
   * other node's hover toolbar hides at once. Called on node mouse-enter. */
  const showToolbar = () => {
    cancelToolbarHide();
    dispatchUi({ type: 'show-toolbar' });
    setActiveToolbarOwner(id);
  };

  /** Hides this node's toolbar with no delay and releases ownership. Called when
   * the pointer leaves the toolbar itself — there's no node/toolbar gap to
   * bridge in that direction, so the toolbar should vanish at once. */
  const hideToolbarImmediately = () => {
    cancelToolbarHide();
    dispatchUi({ type: 'hide-toolbar' });
    if (activeToolbarNodeId === id) setActiveToolbarOwner(null);
  };

  /** Hides the toolbar after a short grace period. Used when the pointer leaves
   * the NODE so the small gap to the offset toolbar can be crossed without the
   * toolbar flickering away. Skips releasing ownership if another node has
   * already claimed it. */
  const scheduleToolbarHide = () => {
    cancelToolbarHide();
    toolbarHideTimeoutRef.current = window.setTimeout(() => {
      dispatchUi({ type: 'hide-toolbar' });
      if (activeToolbarNodeId === id) setActiveToolbarOwner(null);
      toolbarHideTimeoutRef.current = null;
    }, TOOLBAR_HIDE_DELAY_MS);
  };

  useEffect(
    () => () => {
      cancelToolbarHide();
      if (activeToolbarNodeId === id) setActiveToolbarOwner(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only on unmount
    [],
  );

  // Close menu when clicking outside (capture to beat React Flow internal handlers)
  useEffect(() => {
    if (!showMenu) return;
    /**
     * Closes the node menu when a captured pointer event lands outside it.
     * Called by: CustomNode internal event, effect, or helper flow.
     * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
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
   * Called by: CustomNode internal event, effect, or helper flow.
   * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
   */
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatchUi({ type: 'open-delete-confirm' });
  };

  /**
   * Confirms deletion through the graph action passed from useWorkspaceGraph.
   * Called by: CustomNode internal event, effect, or helper flow.
   * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
   */
  const handleDeleteConfirm = () => {
    if (node.node_id) {
      onDelete(node.node_id);
    }
    dispatchUi({ type: 'set-delete-confirm', showDeleteConfirm: false });
  };

  /**
   * Starts inline rename mode from the node settings menu.
   * Called by: CustomNode internal event, effect, or helper flow.
   * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
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
   * Called by: CustomNode internal event, effect, or helper flow.
   * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
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
   * Called by: CustomNode internal event, effect, or helper flow.
   * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
   */
  const handleRenameCancel = () => {
    dispatchUi({ type: 'cancel-rename' });
  };

  /**
   * Lets Escape cancel inline rename without graph interaction.
   * Called by: CustomNode internal event, effect, or helper flow.
   * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
   */
  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleRenameCancel();
    }
  };

  /**
   * Clones the node from the settings menu.
   * Called by: CustomNode internal event, effect, or helper flow.
   * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
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
   * Called by: CustomNode internal event, effect, or helper flow.
   * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
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
   * Called by: CustomNode internal event, effect, or helper flow.
   * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
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
   * Called by: CustomNode internal event, effect, or helper flow.
   * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
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

  // Visual treatment: selected nodes get a primary border + ring; all
  // others use the flat default card look. No per-node colours anymore.
  const nodeClasses = cn(
    'w-64 rounded-lg border-2 bg-white text-sm transition-all duration-150 ease-in-out shadow-md',
    isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
  );

  /**
   * Formats row/column counts for the node shape label.
   * Called by: CustomNode internal event, effect, or helper flow.
   * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
   */
  const formatShapePart = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '?';

  const shapeLabel = `${formatShapePart(nodeShape[0])} × ${formatShapePart(nodeShape[1])}`;

  const menuButtonClassName =
    'relative flex h-8 w-8 items-center justify-center rounded-md border border-border bg-white text-gray-600 shadow-sm transition-colors hover:bg-muted hover:text-gray-900';

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
      isVisible={
        // A menu/dialog keeps the toolbar open regardless of the singleton
        // owner; a plain hover only shows while this node owns the toolbar so
        // exactly one hover toolbar is ever visible.
        showMenu || showDeleteConfirm || ((isHovered || isToolbarHovered) && activeToolbarId === id)
      }
      position={Position.Bottom}
      align="center"
      offset={0}
      className="nodrag nopan flex items-center gap-1 rounded-lg border border-border bg-white/95 p-1 shadow-lg"
      onMouseEnter={() => {
        cancelToolbarHide();
        dispatchUi({ type: 'set-toolbar-hovered', isToolbarHovered: true });
        setActiveToolbarOwner(id);
      }}
      onMouseLeave={hideToolbarImmediately}
      onPointerDownCapture={stopGraphControlEvent}
      onMouseDownCapture={stopGraphControlEvent}
    >
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onPointerDown={stopGraphControlEvent}
          onMouseDown={stopGraphControlEvent}
          onClick={(e) => {
            e.stopPropagation();
            dispatchUi({ type: 'set-menu', showMenu: !showMenu });
            setActiveToolbarOwner(id);
          }}
          className={menuButtonClassName}
          title="More options"
          aria-label="Node settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>

        {showMenu && (
          <div className="absolute right-0 top-9 z-30 min-w-36 rounded-md border border-border bg-white shadow-lg">
            <button
              onClick={handleRenameClick}
              className="w-full rounded-md px-3 py-2 text-left text-xs hover:bg-muted/60"
            >
              Rename
            </button>

            <button
              onClick={handleCopyNode}
              className="w-full border-t border-border/60 px-3 py-2 text-left text-xs hover:bg-muted/60"
            >
              Clone
            </button>

            <button
              onClick={handleUndoNode}
              disabled={!node.can_undo}
              className="w-full border-t border-border/60 px-3 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent hover:bg-muted/60"
            >
              Undo
            </button>

            <button
              onClick={handleRedoNode}
              disabled={!node.can_redo}
              className="w-full border-t border-border/60 px-3 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent hover:bg-muted/60"
            >
              Redo
            </button>

            <button
              onClick={handleDeleteClick}
              className="w-full border-t border-border/60 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        onPointerDown={stopGraphControlEvent}
        onMouseDown={stopGraphControlEvent}
        onClick={handleAddClick}
        className={menuButtonClassName}
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
  const newDot = isFresh ? (
    <span
      className="pointer-events-none absolute -right-1 -top-1 z-20 h-3 w-3 rounded-full bg-red-500 ring-2 ring-white"
      title="New data block"
      aria-label="New data block"
    />
  ) : null;

  if (isZoomedOut) {
    // Compact view keeps critical controls visible while preserving the compact footprint.
    const compactClasses = cn(
      'flex items-start rounded-lg border-2 p-4 transition-all duration-150 ease-in-out shadow-md',
      isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
    );
    return (
      <div
        className={compactClasses}
        onMouseEnter={showToolbar}
        onMouseLeave={scheduleToolbarHide}
        style={{
          minWidth: '180px',
          maxWidth: '300px',
          position: 'relative',
          // ``isFresh`` red "new" dot rendered below marks newly-created
          // nodes the user hasn't acknowledged yet.
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
      onMouseEnter={showToolbar}
      onMouseLeave={scheduleToolbarHide}
      style={{
        minWidth: '256px',
        minHeight: '120px',
        position: 'relative',
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
            <form onSubmit={handleRenameSubmit} className="flex-1 relative z-50">
              <input
                ref={renameInputRef}
                type="text"
                value={newName}
                onChange={(e) => {
                  dispatchUi({ type: 'set-rename-name', name: e.target.value });
                }}
                onBlur={handleRenameCancel}
                onKeyDown={handleRenameKeyDown}
                onMouseDown={(e) => {
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                className="nodrag nopan relative z-50 w-full rounded border border-blue-300 bg-white px-1 py-0.5 text-sm font-bold focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                style={{
                  fontSize: '14px',
                  lineHeight: '1.2',
                }}
              />
            </form>
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
