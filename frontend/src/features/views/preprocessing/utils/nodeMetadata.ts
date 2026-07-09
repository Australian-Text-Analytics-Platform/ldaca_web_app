import {
  getNodeDisplayName,
  type NodeColumnSelection,
  type WorkspaceNodeLike,
} from '@/features/views/common/nodeSelectionTypes';

export const SINGLE_NODE_SELECTION_PALETTE = ['#2563eb'];

interface SingleNodeSelectionPanelModel {
  selectedNodes: WorkspaceNodeLike[];
  nodeColumnSelections: NodeColumnSelection[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  disabled: boolean;
}

/**
 * Safely treats loose workspace-node metadata as an object.
 * Used by: local callers in preprocessing/nodeMetadata module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * Derives the human label used by preprocessing panels and auto names.
 * Used by: join, concat, slice, and expression preprocessing hooks because
 * those subtabs need the same name/label/id order for user-facing status text
 * and generated node names.
 */
export const deriveNodeLabel = (node: WorkspaceNodeLike | null | undefined): string => {
  if (!node) return '';
  return getNodeDisplayName(node, getNodeKey(node));
};

/**
 * Resolves a stable key for node maps and selection panel lookups.
 * Used by: preprocessing subtab hooks because backend node metadata may expose
 * either `id` or `node_id`, while subtab selection maps need one lookup key.
 */
export const getNodeKey = (node: WorkspaceNodeLike): string => {
  const base = toRecord(node);
  const id = base.id;
  if (typeof id === 'string' && id.length > 0) return id;
  const nodeId = base.node_id;
  if (typeof nodeId === 'string' && nodeId.length > 0) return nodeId;
  return '';
};

/**
 * Builds the node lookup map shared by single- and multi-node preprocessing
 * hooks.
 * Used by: filter, slice, join, concat, find, and aggregate flows because
 * selected input ids should resolve the same way regardless of backend shape.
 */
export const buildWorkspaceNodeMap = (
  workspaceNodes: WorkspaceNodeLike[],
): Map<string, WorkspaceNodeLike> => {
  const map = new Map<string, WorkspaceNodeLike>();
  workspaceNodes.forEach((node) => {
    const key = getNodeKey(node);
    if (key && !map.has(key)) {
      map.set(key, node);
    }
  });
  return map;
};

/**
 * Builds the fixed one-node selection panel model used by preprocessing tabs
 * that operate on a single source node and do not expose source-column/color
 * editing.
 * Used by: filter, slice, and aggregate preprocessing hooks because they all
 * need the same empty-column selection row, fixed color, and disabled state
 * for `NodeInputsPanel`.
 */
export const buildSingleNodeSelectionPanelModel = ({
  nodeId,
  selectedNode,
}: {
  nodeId: string | null | undefined;
  selectedNode?: WorkspaceNodeLike | null;
}): SingleNodeSelectionPanelModel => {
  const node = selectedNode ?? null;
  const color = SINGLE_NODE_SELECTION_PALETTE[0] ?? '#2563eb';
  return {
    selectedNodes: node ? [node] : [],
    nodeColumnSelections: nodeId ? [{ nodeId, column: '' }] : [],
    nodeColors: nodeId ? { [nodeId]: color } : {},
    defaultPalette: SINGLE_NODE_SELECTION_PALETTE,
    disabled: !node,
  };
};
