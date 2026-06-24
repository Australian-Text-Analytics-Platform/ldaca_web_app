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
 * those subtabs need the same name/label/id fallback order for user-facing
 * status text and generated node names.
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
export const getNodeKey = (node: WorkspaceNodeLike, fallback?: string): string => {
  const base = toRecord(node);
  const id = base.id;
  if (typeof id === 'string' && id.length > 0) return id;
  const nodeId = base.node_id;
  if (typeof nodeId === 'string' && nodeId.length > 0) return nodeId;
  return fallback ?? '';
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
  workspaceNodes.forEach((node, index) => {
    const key = getNodeKey(node, `node-${String(index)}`);
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
 * need the same selected-node lookup, empty-column selection row, fixed color,
 * and disabled state for `NodeInputsPanel`.
 */
export const buildSingleNodeSelectionPanelModel = ({
  nodeId,
  workspaceNodes,
  selectedNode,
}: {
  nodeId: string | null | undefined;
  workspaceNodes: WorkspaceNodeLike[];
  selectedNode?: WorkspaceNodeLike | null;
}): SingleNodeSelectionPanelModel => {
  const node =
    selectedNode ?? (nodeId ? (buildWorkspaceNodeMap(workspaceNodes).get(nodeId) ?? null) : null);
  const color = SINGLE_NODE_SELECTION_PALETTE[0] ?? '#2563eb';
  return {
    selectedNodes: node ? [node] : [],
    nodeColumnSelections: nodeId ? [{ nodeId, column: '' }] : [],
    nodeColors: nodeId ? { [nodeId]: color } : {},
    defaultPalette: SINGLE_NODE_SELECTION_PALETTE,
    disabled: !node,
  };
};

/**
 * Extracts selectable column names from either explicit columns or schema.
 * Used by: useConcatSubTab hook, useJoinSubTab hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 */
export const extractNodeColumns = (node: WorkspaceNodeLike | null | undefined): string[] => {
  const base = toRecord(node);
  if (Array.isArray(base.columns)) {
    return (base.columns as unknown[]).map((entry) => String(entry));
  }
  if (base.schema && typeof base.schema === 'object') {
    return Object.keys(base.schema);
  }
  return [];
};

/**
 * Extracts schema dtypes for condition/operator logic in preprocessing tabs.
 * Used by: useConcatSubTab hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: coerce the node to a record, inspect object-shaped schema metadata, stringify dtype values per column, and return an empty map otherwise.
 */
export const extractNodeDtypes = (
  node: WorkspaceNodeLike | null | undefined,
): Record<string, string> => {
  const base = toRecord(node);
  if (base.schema && typeof base.schema === 'object') {
    return Object.entries(base.schema as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [column, dtype]) => {
        acc[column] = String(dtype);
        return acc;
      },
      {},
    );
  }
  return {};
};

/**
 * Finds the document-text column preview dialogs should promote from metadata.
 * Used by: useWorkspaceDataTable hook, documentColumn tests, documentColumn utilities (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Steps: inspect legacy and nested metadata keys, prefer the first non-empty string, and
 * leave callers undefined when no document column is declared.
 */
export const getNodeDocumentColumn = (
  node: WorkspaceNodeLike | null | undefined,
): string | undefined => {
  const base = toRecord(node);
  const data = toRecord(base.data);
  const dataNode = toRecord(data.node);

  const candidates = [
    base.documentColumn,
    base.document_column,
    base.document,
    data.documentColumn,
    data.document_column,
    data.document,
    dataNode.documentColumn,
    dataNode.document_column,
    dataNode.document,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
};
