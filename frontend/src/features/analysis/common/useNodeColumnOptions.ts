import { useMemo } from 'react';
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

export const buildNodeColumnOptionsMap = ({
  nodes = [],
  getNodeColumns,
  allowedDataTypes,
  fallbackToAllColumns,
}: BuildNodeColumnOptionsArgs): NodeColumnOptionsMap => {
  return nodes.reduce<NodeColumnOptionsMap>((acc, node, index) => {
    const nodeId = getNodeIdentifier(node, index);
    if (!nodeId) return acc;

    let infos: ColumnInfo[] = [];
    if (getNodeColumns) {
      infos = normalizeColumnInfos(getNodeColumns(node));
    } else {
      infos = mapColumnsToInfo(node as Record<string, unknown>);
    }

    acc[nodeId] = buildEntry(nodeId, infos, allowedDataTypes, fallbackToAllColumns);
    return acc;
  }, {});
};

export const useNodeColumnOptions = (
  config: UseNodeColumnOptionsConfig
): NodeColumnOptionsMap => {
  const { nodes = [], getNodeColumns, allowedDataTypes, fallbackToAllColumns } = config;

  return useMemo(
    () =>
      buildNodeColumnOptionsMap({
        nodes,
        getNodeColumns,
        allowedDataTypes,
        fallbackToAllColumns,
      }),
    [nodes, getNodeColumns, allowedDataTypes, fallbackToAllColumns]
  );
};
