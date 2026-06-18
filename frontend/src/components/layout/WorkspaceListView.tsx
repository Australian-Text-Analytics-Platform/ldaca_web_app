import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useNodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import { useFreshNodesStore } from '@/stores/freshNodesStore';
import { usePinnedNodesStore } from '@/stores/pinnedNodesStore';
import { useUIStore } from '@/stores';
import WorkspaceNodeList from '@/components/layout/WorkspaceNodeList';
import type { SidebarWorkspaceNode } from '@/components/layout/sidebar/types';
import { NodeActionsToolbar, NodePinButton } from './NodeActionsToolbar';

export interface WorkspaceListViewProps {
  /** Opens the schema view for a node (drives the collapsed data pane). */
  onShowSchema: (nodeId: string) => void;
}

/**
 * Compact node list shown in the top of the right panel when it's collapsed
 * (replacing the graph). Reuses ``WorkspaceNodeList`` for selection + the
 * red "new" dot, and renders a per-row ``NodeActionsToolbar`` (the same actions
 * as the graph node toolbar) plus a schema magnifier via the section's
 * ``renderRowActions`` slot.
 *
 * Rendered by: WorkspaceView when ``collapsed`` is true.
 * Flow: read nodes + selection + workspace actions, then render the shared node
 * list with pinned/selected grouping, a leading pin action, the row toolbar
 * wired to rename/clone/undo/redo, a header batch-delete action, and the
 * node-input add request.
 */
export function WorkspaceListView({ onShowSchema }: WorkspaceListViewProps) {
  const { workspaceGraph, currentWorkspaceId } = useWorkspaceData();
  const { selectedNodeIds } = useWorkspaceSelection();
  const {
    toggleNodeSelection,
    clearSelection,
    deleteNode,
    copyNode,
    renameNode,
    undoNode,
    redoNode,
  } = useWorkspaceActions();
  const requestNodeInputAdd = useNodeInputRequestsStore((state) => state.requestAdd);
  const currentView = useUIStore((state) => state.currentView);
  const pinnedNodeIds = usePinnedNodesStore((state) => state.pinnedNodeIds);
  const togglePinnedNode = usePinnedNodesStore((state) => state.togglePinnedNode);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- zustand action is bound to the store and does not rely on `this`
  const markInteracted = useFreshNodesStore((state) => state.markInteracted);

  const rawNodes = (workspaceGraph as { nodes?: unknown } | undefined)?.nodes;
  const nodes = Array.isArray(rawNodes) ? (rawNodes as SidebarWorkspaceNode[]) : [];
  const pinnedIdSet = new Set(pinnedNodeIds);

  const getToolbarNode = (node: SidebarWorkspaceNode) => ({
    id: node.id,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- fall through empty names to id
    name: node.name || node.label || node.id,
    canUndo: node.can_undo,
    canRedo: node.can_redo,
  });

  /** Queues this node as an input for the active analysis view (matches the
   * graph node "+" affordance) and clears its fresh highlight. */
  const handleAddToSelection = (nodeId: string) => {
    requestNodeInputAdd(currentWorkspaceId, currentView, nodeId);
    markInteracted([nodeId]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scrollbar-none px-2 py-2">
      <WorkspaceNodeList
        nodes={nodes}
        selectedNodeIds={selectedNodeIds}
        onToggleNodeSelection={toggleNodeSelection}
        onClearSelection={clearSelection}
        onDeleteSelected={async (nodeIds) => {
          await Promise.allSettled(nodeIds.map((id) => deleteNode(id)));
        }}
        renderPinnedRowAction={(node: SidebarWorkspaceNode) => (
          <NodePinButton
            node={getToolbarNode(node)}
            isPinned={pinnedIdSet.has(node.id)}
            onTogglePin={togglePinnedNode}
          />
        )}
        renderRowActions={(node: SidebarWorkspaceNode) => (
          <NodeActionsToolbar
            node={getToolbarNode(node)}
            isPinned={pinnedIdSet.has(node.id)}
            onShowSchema={onShowSchema}
            onTogglePin={togglePinnedNode}
            onAddToSelection={handleAddToSelection}
            onRename={(id, newName) => { void renameNode(id, newName); }}
            onClone={(id) => { void copyNode(id); }}
            onUndo={(id) => { void undoNode(id); }}
            onRedo={(id) => { void redoNode(id); }}
            onDelete={(id) => { void deleteNode(id); }}
          />
        )}
      />
    </div>
  );
}
