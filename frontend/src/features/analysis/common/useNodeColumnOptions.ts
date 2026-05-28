import type { ColumnInfo } from '@/utils/columnTypes';
import { filterColumnsByType, mapColumnsToInfo, normalizeTypeName } from '@/utils/columnTypes';
import type { NodeColumnSource, WorkspaceNodeLike } from './nodeSelectionTypes';
import { getNodeIdentifier } from './nodeSelectionTypes';

export interface NodeColumnOptionsEntry {
  nodeId: string;
  columnInfos: ColumnInfo[];
  allColumnInfos: ColumnInfo[];
  columns: string[];
  filteredOutByType: boolean;
  fallbackApplied: boolean;
}

export type NodeColumnOptionsMap = Record<string, NodeColumnOptionsEntry>;

export interface UseNodeColumnOptionsConfig {
  nodes?: WorkspaceNodeLike[];
  getNodeColumns?: (node: WorkspaceNodeLike) => NodeColumnSource | undefined;
  allowedDataTypes?: string[];
  fallbackToAllColumns?: boolean;
}

/**
 * Converts either raw column names or typed column metadata into the single
 * ColumnInfo shape consumed by shared node/column selectors.
 * Called by: buildNodeColumnOptionsMap for each workspace node because the caller needs this analysis-specific step before continuing its request, result, display, or cleanup workflow.
   * Flow: return no columns for missing sources, convert raw names to string ColumnInfo entries, then normalize typed metadata names and data types.
 */
const normalizeColumnInfos = (source?: NodeColumnSource): ColumnInfo[] => {
  if (!source || !Array.isArray(source) || source.length === 0) return [];
  const first = source[0];
  if (typeof first === 'string') {
    return (source as string[]).map((name) => ({ name, dataType: 'string' }));
  }
  return (source as ColumnInfo[]).map((column) => ({
    name: column.name,
    dataType: normalizeTypeName(column.dataType),
  }));
};

/**
 * Applies data-type filtering and fallback policy for one node's selectable
 * columns, preserving diagnostics for panels that need to explain hidden choices.
 * Called by: buildNodeColumnOptionsMap after node column metadata is normalized because the caller needs this analysis-specific step before continuing its request, result, display, or cleanup workflow.
 * Flow: normalize inputs, apply the analysis-specific branch, then return the derived value consumed by the caller.
 */
const buildEntry = (
  nodeId: string,
  columnInfos: ColumnInfo[],
  allowedDataTypes?: string[],
  fallbackToAllColumns?: boolean
): NodeColumnOptionsEntry => {
  if (!allowedDataTypes?.length) {
    return {
      nodeId,
      columnInfos,
      allColumnInfos: columnInfos,
      columns: columnInfos.map((info) => info.name),
      filteredOutByType: false,
      fallbackApplied: false,
    };
  }

  const filtered = filterColumnsByType(columnInfos, allowedDataTypes);
  const filteredOutByType = columnInfos.length > 0 && filtered.length === 0;

  if (filtered.length === 0 && fallbackToAllColumns) {
    return {
      nodeId,
      columnInfos,
      allColumnInfos: columnInfos,
      columns: columnInfos.map((info) => info.name),
      filteredOutByType,
      fallbackApplied: true,
    };
  }

  return {
    nodeId,
    columnInfos: filtered,
    allColumnInfos: columnInfos,
    columns: filtered.map((info) => info.name),
    filteredOutByType,
    fallbackApplied: false,
  };
};

export interface BuildNodeColumnOptionsArgs {
  nodes?: WorkspaceNodeLike[];
  getNodeColumns?: (node: WorkspaceNodeLike) => NodeColumnSource | undefined;
  allowedDataTypes?: string[];
  fallbackToAllColumns?: boolean;
}

/**
 * Builds the per-node column option map used by multi-node analysis parameter
 * panels and their detached-column dialogs.
 * Used by: useNodeColumnOptions and tests because multi-node panels need per-node selectable columns with data-type filtering and fallback diagnostics.
 */
export const buildNodeColumnOptionsMap = ({
  nodes = [],
  getNodeColumns,
  allowedDataTypes,
  fallbackToAllColumns,
}: BuildNodeColumnOptionsArgs): NodeColumnOptionsMap => {
  return nodes.reduce<NodeColumnOptionsMap>((acc, node, index) => {
    const nodeId = getNodeIdentifier(node, index);
    if (!nodeId) return acc;

    const infos = getNodeColumns
      ? normalizeColumnInfos(getNodeColumns(node))
      : mapColumnsToInfo(node as Record<string, unknown>);

    acc[nodeId] = buildEntry(nodeId, infos, allowedDataTypes, fallbackToAllColumns);
    return acc;
  }, {});
};

/**
 * Hook wrapper around the pure column-option builder for components that receive
 * live workspace nodes from React state.
 * Used by: NodeSelectionPanel when building selectable columns for active nodes because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 */
export const useNodeColumnOptions = (
  config: UseNodeColumnOptionsConfig
): NodeColumnOptionsMap => {
  const { nodes = [], getNodeColumns, allowedDataTypes, fallbackToAllColumns } = config;

  return buildNodeColumnOptionsMap({
        nodes,
        getNodeColumns,
        allowedDataTypes,
        fallbackToAllColumns,
      });
};
