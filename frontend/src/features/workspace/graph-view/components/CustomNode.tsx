import { useState, useEffect, useRef } from 'react';
import {
  type NodeProps,
  Handle,
  NodeToolbar,
  Position,
  useStore,
  type Node as ReactFlowNode,
} from '@xyflow/react';
import { Settings2, Copy, Check, Plus, Trash2 } from 'lucide-react';
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
import { DEFAULT_GREY_PAIR } from '@/lib/color';
import type { NodeVisualInfo } from '@/lib/nodeVisualState';

interface CustomNodeData extends Record<string, unknown> {
  node: WorkspaceNode;
  isMultiSelected?: boolean;
  /** Pre-computed node visual state (active / focus / unselected +
   * X/Y colour pair) from ``useWorkspaceGraph``. See the strategy doc:
   * ``frontend/docs/developer-guide/node-colour-strategy.md``. */
  visualInfo?: NodeVisualInfo;
  /** True for nodes that appeared mid-session (detach / join / stack /
   * clone outputs etc.) and haven't been interacted with yet. Triggers
   * the "find me" black outline overlay in the graph + sidebar.
   * Cleared by ``markInteracted`` in useFreshNodesStore on first
   * click / selection. */
  isFresh?: boolean;
  onDelete: (nodeId: string) => void;
  onRename?: (nodeId: string, newName: string) => void;
  onCopy?: (nodeId: string) => void;
  onUndo?: (nodeId: string) => void;
  onRedo?: (nodeId: string) => void;
  /** Requests that this node is added to the active view's node inputs. */
  onAddToSelection?: (nodeId: string) => void;
}

const COMPACT_NODE_ZOOM_THRESHOLD = 0.5;
const TOOLBAR_HIDE_DELAY_MS = 350;

/**
 * React Flow node renderer for a workspace node. Shows a compact card when zoomed
 * out, and a full card with metadata + action menu when zoomed in.
 * Rendered by: workspace/CustomNode module JSX because React Flow needs this custom node type for workspace data blocks.
 * Flow: React Flow passes node data, zoom and selection choose compact or full rendering, and actions invoke workspace mutations.
 */
function CustomNode({ id, data, selected }: NodeProps<ReactFlowNode<CustomNodeData>>) {
  const {
    node,
    isMultiSelected = false,
    visualInfo,
    isFresh = false,
    onDelete,
    onRename,
    onCopy,
    onUndo,
    onRedo,
    onAddToSelection,
  } = data;
  // Fall back to the unselected-grey treatment if no visual info was
  // attached (defensive — useWorkspaceGraph always provides one now,
  // but CustomNode tests render without it).
  const nodeVisualState = visualInfo?.state ?? 'unselected';
  const nodeColorPair = visualInfo?.pair ?? DEFAULT_GREY_PAIR;
  const isActive = nodeVisualState === 'active';
  const isFocus = nodeVisualState === 'focus';
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [copied, setCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isToolbarHovered, setIsToolbarHovered] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const toolbarHideTimeoutRef = useRef<number | null>(null);

  const zoom = useStore((s) => s.transform[2]);
  const isZoomedOut = zoom < COMPACT_NODE_ZOOM_THRESHOLD;

  const nodeName = node.name || 'Loading...';
  const nodeShape = node.shape;

  /** Cancels any pending delayed toolbar hide. */
  const cancelToolbarHide = () => {
    if (toolbarHideTimeoutRef.current !== null) {
      window.clearTimeout(toolbarHideTimeoutRef.current);
      toolbarHideTimeoutRef.current = null;
    }
  };

  /** Shows the toolbar immediately and keeps it stable while pointer crosses the node/toolbar gap. */
  const showToolbar = () => {
    cancelToolbarHide();
    setIsHovered(true);
  };

  /** Hides the toolbar after a short grace period unless the toolbar/menu is active. */
  const scheduleToolbarHide = () => {
    cancelToolbarHide();
    toolbarHideTimeoutRef.current = window.setTimeout(() => {
      setIsHovered(false);
      setIsToolbarHovered(false);
      toolbarHideTimeoutRef.current = null;
    }, TOOLBAR_HIDE_DELAY_MS);
  };

  useEffect(() => () => { cancelToolbarHide(); }, []);

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
        setShowMenu(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => { document.removeEventListener('pointerdown', handlePointerDown, { capture: true }); };
  }, [showMenu]);

  /**
   * Opens delete confirmation without letting the graph select the node.
   * Called by: CustomNode internal event, effect, or helper flow.
   * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
   */
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    setShowDeleteConfirm(true);
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
    setShowDeleteConfirm(false);
  };

  /**
   * Starts inline rename mode from the node settings menu.
   * Called by: CustomNode internal event, effect, or helper flow.
   * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
   */
  const handleRenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    setNewName(node.name || '');
    setIsRenaming(true);
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
    setIsRenaming(false);
    setNewName('');
  };

  /**
   * Leaves inline rename mode without changing the node name.
   * Called by: CustomNode internal event, effect, or helper flow.
   * Why: because node rendering helpers need to map graph metadata, selection state, and action affordances into one card.
   */
  const handleRenameCancel = () => {
    setIsRenaming(false);
    setNewName('');
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
    setShowMenu(false);
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
    setShowMenu(false);
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
    setShowMenu(false);
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
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    }
  };

  // Visual treatment driven by the node-colour strategy (see strategy
  // doc). Active = Y fill + X stroke. Focus = Y fill, no stroke ring.
  // Unselected (but with an assigned colour) = Y stroke, default fill.
  // Unselected + grey default = the existing flat card look.
  // ``selected`` from React Flow (single-click highlight) is treated as
  // Focus visually when the node isn't already in the analysis window.
  const isHighlighted = isActive || isFocus || selected;
  const nodeClasses =
    'w-64 rounded-lg border-2 bg-white text-sm transition-all duration-150 ease-in-out shadow-md';
  // Stroke and ring follow Active > Focus/selected > Unselected.
  const nodeBorderColor = isActive
    ? nodeColorPair.X
    : isFocus || selected
      ? 'transparent'
      : nodeColorPair.Y;
  const nodeBoxShadow = isActive
    ? `0 0 0 3px ${nodeColorPair.Y}, 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`
    : undefined;
  // For unselected nodes that carry an assigned colour, tint the
  // displayed name with X so the node's identity is recognisable at
  // rest. Default-grey unselected nodes keep the standard foreground
  // so never-analysed blocks stay visually quiet.
  const hasAssignedColour = visualInfo ? visualInfo.pair.X !== DEFAULT_GREY_PAIR.X : false;
  const nameColour = !isHighlighted && hasAssignedColour ? nodeColorPair.X : undefined;

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
  const dangerButtonClassName = cn(
    menuButtonClassName,
    'text-red-600 hover:bg-red-50 hover:text-red-700',
  );

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
      isVisible={isHovered || isToolbarHovered || showMenu || showDeleteConfirm}
      position={Position.Right}
      align="center"
      offset={8}
      className="nodrag nopan flex items-center gap-1 rounded-lg border border-border bg-white/95 p-1 shadow-lg"
      onMouseEnter={() => {
        cancelToolbarHide();
        setIsToolbarHovered(true);
      }}
      onMouseLeave={scheduleToolbarHide}
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
            setShowMenu(!showMenu);
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
      <button
        type="button"
        onPointerDown={stopGraphControlEvent}
        onMouseDown={stopGraphControlEvent}
        onClick={handleDeleteClick}
        className={dangerButtonClassName}
        title="Delete node"
        aria-label="Delete node"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </NodeToolbar>
  );

  const deleteDialog = (
    <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{nodeName}&rdquo;?</AlertDialogTitle>
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

  if (isZoomedOut) {
    // Compact view keeps critical controls visible while preserving the compact footprint.
    const compactClasses =
      'flex items-start rounded-lg border-2 p-4 transition-all duration-150 ease-in-out shadow-md';
    const compactBg = isHighlighted ? nodeColorPair.Y : undefined;
    return (
      <div
        className={compactClasses}
        onMouseEnter={showToolbar}
        onMouseLeave={scheduleToolbarHide}
        style={{
          minWidth: '180px',
          maxWidth: '300px',
          position: 'relative',
          borderColor: nodeBorderColor,
          backgroundColor: compactBg,
          boxShadow: nodeBoxShadow,
          // ``isFresh`` overlay: black outline around newly-created
          // nodes that the user hasn't acknowledged yet. Renders
          // outside the border-box, doesn't shift layout.
          ...(isFresh ? { outline: '3px solid #000', outlineOffset: '2px' } : {}),
        }}
      >
        {nodeToolbar}
        {isHighlighted && (
          <div
            className="w-3 h-3 rounded-full mr-2.5 mt-2 shrink-0"
            style={{ backgroundColor: nodeColorPair.X }}
          />
        )}
        <div
          className="pr-16 font-bold text-3xl leading-snug whitespace-normal"
          style={{
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            hyphens: 'auto',
            ...(nameColour ? { color: nameColour } : {}),
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
        borderColor: nodeBorderColor,
        boxShadow: nodeBoxShadow,
        // ``isFresh`` overlay: black outline around newly-created
        // nodes that the user hasn't acknowledged yet. Renders
        // outside the border-box, doesn't shift layout.
        ...(isFresh ? { outline: '3px solid #000', outlineOffset: '2px' } : {}),
      }}
    >
      {/* Node Header — top fill uses the Y (lighter) variant when the
          node has any selection state so the top-strip mirrors the
          assigned hue per the strategy doc's zoom-in fill pattern.
          Falls back to the standard muted strip when unselected. */}
      <div
        className={cn(
          'flex items-start justify-between p-2 rounded-t-lg border-b-2 min-h-fit relative',
          !isHighlighted && 'bg-muted border-border',
        )}
        style={{
          backgroundColor: isHighlighted ? nodeColorPair.Y : undefined,
          borderColor: isHighlighted ? nodeColorPair.X : undefined,
        }}
      >
        <div className="flex items-center flex-1 mr-2">
          {isHighlighted && (
            <div
              className="w-2 h-2 rounded-full mr-2 shrink-0"
              style={{ backgroundColor: nodeColorPair.X }}
              title={isMultiSelected ? 'Selected for joining' : 'Selected'}
            ></div>
          )}
          {isRenaming ? (
            <form onSubmit={handleRenameSubmit} className="flex-1 relative z-50">
              <input
                ref={renameInputRef}
                type="text"
                value={newName}
                onChange={(e) => { setNewName(e.target.value); }}
                onBlur={handleRenameCancel}
                onKeyDown={handleRenameKeyDown}
                onMouseDown={(e) => { e.stopPropagation(); }}
                onClick={(e) => { e.stopPropagation(); }}
                onPointerDown={(e) => { e.stopPropagation(); }}
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
                ...(nameColour ? { color: nameColour } : {}),
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
