import { useCallback, useState } from 'react';
import type { SortingState, ColumnFiltersState } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { getNodeDataByWorkspaceId, getNodeQueryPlan, type NodeDataResponse } from '@/api';
import { createNodeDataRequest, queryKeys, type NodeDataRequest } from '@/lib/queryKeys';
import type { WorkspaceTableProps } from '../components/WorkspaceTable';
import type { FilterOperator } from '../types';

export interface WorkspaceDataTableHeaderInfo {
  nodeLabel: string;
  tabPosition: number;
  totalTabs: number;
  isEmptyTable: boolean;
}

interface WorkspaceDataTableNodeActions {
  onUndo?: () => void;
  onRedo?: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  onQueryPlan?: () => Promise<string | null>;
  canUndo: boolean;
  canRedo: boolean;
}

interface WorkspaceSelectionTab {
  id: string;
  label: string;
  isActive: boolean;
}

export interface WorkspaceSelectionTabsState {
  shouldShowTabs: boolean;
  tabs: WorkspaceSelectionTab[];
  tabPosition: number;
  totalTabs: number;
  onTabChange: (nodeId: string) => void;
  onTabClose: (nodeId: string) => void;
  onTabReorder: (orderedNodeIds: string[]) => void;
}

export interface WorkspaceDataTableViewModel {
  selectedNode: ReturnType<typeof useWorkspaceSelection>['selectedNode'];
  header: WorkspaceDataTableHeaderInfo;
  nodeActions: WorkspaceDataTableNodeActions;
  tabs: WorkspaceSelectionTabsState;
  table: WorkspaceTableProps;
  loading: {
    nodeData: boolean;
  };
}

const DEFAULT_NODE_TABLE_REQUEST = createNodeDataRequest({ page: 1, page_size: 20 });

const EMPTY_NODE_DATA: NodeDataResponse = Object.freeze({
  data: [],
  revision: '',
  pagination: {
    page: 0,
    page_size: 20,
    total_rows: 0,
    total_pages: 0,
    has_next: false,
    has_prev: false,
  },
  columns: [],
  dtypes: {},
  sorting: { sort_by: null, descending: false },
  filtering: { column: null, value: null, op: 'contains' },
});

/**
 * Creates one tab descriptor for the multi-selected-node tab strip.
 * Called while mapping selected node ids into WorkspaceSelectionTabs props.
 * Flow: accept a selected node id, fall back to that id when no label is available, and attach the active-tab flag.
 */
const buildTabDescriptor = (
  node: WorkspaceSelectionTab['id'],
  label?: string,
  isActive = false,
) => ({
  id: node,
  label: label ?? node,
  isActive,
});

interface WorkspaceNodeDisplayLike {
  id?: string;
  name?: string;
  shape?: [number | null, number | null] | number[];
}

/**
 * Resolves the display label for data-view headers and selection tabs.
 * Used for the active-node header and each selected-node tab label.
 * Flow: return undefined for missing node data, otherwise prefer the display name and fall back to the node id.
 */
const resolveNodeDisplayLabel = (
  node: WorkspaceNodeDisplayLike | null | undefined,
): string | undefined => {
  if (!node) {
    return undefined;
  }

  // Empty name falls back to id, so `||` is intentional (a blank node name should show the id).
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return node.name || node.id;
};

/**
 * Composes workspace data, selection, actions, and table callbacks into the
 * view model consumed by `WorkspaceDataTableFeature`.
 * Used by: `WorkspaceDataTableFeature`, which needs one view model for the
 * header, canonical selection tabs, selected-node query, and `WorkspaceTable`.
 * Flow: read canonical selection membership, own per-workspace/node table
 * requests and their query, then adapt tabs, request controls, and mutations
 * into table props.
 */
export const useWorkspaceDataTable = (): WorkspaceDataTableViewModel => {
  const { currentWorkspaceId } = useWorkspaceData();
  const { activeNodeId, selectedNode, selectedNodes, selectedNodeIds } = useWorkspaceSelection();
  const {
    castColumn,
    renameColumn,
    deleteColumn,
    refreshNodeSchema,
    deleteNode,
    renameNode,
    undoNode,
    redoNode,
    activateNode,
    reorderSelectedNodes,
    removeNode,
  } = useWorkspaceActions();

  const multiSelectedNodes = selectedNodes.filter(Boolean);
  const shouldShowTabs = selectedNodeIds.length > 1;

  const nodeById = (() => {
    const map = new Map<string, (typeof multiSelectedNodes)[number]>();
    multiSelectedNodes.forEach((node) => {
      if (node.id) {
        map.set(node.id, node);
      }
    });
    return map;
  })();

  const displayTabIds = shouldShowTabs ? selectedNodeIds : [];

  const activeTabIndex = displayTabIds.findIndex((id) => id === activeNodeId);
  const tabPosition = activeTabIndex >= 0 ? activeTabIndex + 1 : displayTabIds.length > 0 ? 1 : 0;

  /**
   * Promotes a selected node tab to the active node.
   * Called by: `WorkspaceSelectionTabs` when a user activates a tab.
   * Why: tab activation changes the active pointer without changing membership
   * or order.
   */
  const handleTabChange = (nodeId: string) => {
    if (!nodeId || nodeId === activeNodeId || !selectedNodeIds.includes(nodeId)) {
      return;
    }
    activateNode(nodeId);
  };

  /**
   * Removes a node from the multi-selection tab strip.
   * Called by: `WorkspaceSelectionTabs` close controls.
   * Why: the selection store owns active fallback when either an active or
   * non-active tab closes.
   */
  const handleTabClose = (nodeId: string) => {
    if (!nodeId) {
      return;
    }
    removeNode(nodeId);
  };

  /**
   * Persists a drag-and-drop reordering of the selection tab strip.
   * Called by: WorkspaceSelectionTabs via the shared ChromeTabs ``onReorder``.
   * Why: ordered membership belongs to the selection store, so every graph,
   * list, and table consumer sees the same order and active fallback.
   */
  const handleTabReorder = (orderedNodeIds: string[]) => {
    reorderSelectedNodes(orderedNodeIds);
  };

  const tableStateKey =
    currentWorkspaceId && activeNodeId ? `${currentWorkspaceId}\0${activeNodeId}` : '';
  const [requestByNode, setRequestByNode] = useState<Record<string, NodeDataRequest>>({});
  const nodeTableRequest = tableStateKey
    ? (requestByNode[tableStateKey] ?? DEFAULT_NODE_TABLE_REQUEST)
    : DEFAULT_NODE_TABLE_REQUEST;

  /**
   * Updates the active table request without coupling it to selection state.
   * Called by: TanStack Table pagination, sorting, and filter adapters below.
   * Flow: start from the current complete request, apply one transition, and
   * retain each workspace/node's request while Data View remains mounted.
   */
  const updateNodeTableRequest = (updater: (request: NodeDataRequest) => NodeDataRequest) => {
    if (!tableStateKey) return;
    setRequestByNode((current) => {
      const existing = current[tableStateKey] ?? DEFAULT_NODE_TABLE_REQUEST;
      const next = updater(existing);
      return next === existing ? current : { ...current, [tableStateKey]: next };
    });
  };

  const nodeDataQuery = useQuery({
    queryKey: queryKeys.nodeData(currentWorkspaceId ?? '', activeNodeId ?? '', nodeTableRequest),
    enabled: Boolean(currentWorkspaceId && activeNodeId),
    /**
     * Fetches the active node page for `WorkspaceTable`.
     * Called by: TanStack Query when the complete request value changes.
     * Why: the exact object in the cache key is also sent to the generated SDK,
     * preventing cache reuse across operator-only or default-shape changes.
     */
    queryFn: async () => {
      if (!currentWorkspaceId || !activeNodeId) {
        throw new Error('Missing workspace or node ID');
      }
      const { data } = await getNodeDataByWorkspaceId({
        path: { workspace_id: currentWorkspaceId, node_id: activeNodeId },
        query: nodeTableRequest,
        throwOnError: true,
      });
      return data;
    },
    staleTime: 30 * 1000,
  });
  const nodeData = nodeDataQuery.data ?? EMPTY_NODE_DATA;

  const selectedNodeCapabilities = selectedNode as {
    id?: string;
    can_undo?: boolean;
    can_redo?: boolean;
  } | null;
  const canUndo = Boolean(selectedNodeCapabilities?.can_undo);
  const canRedo = Boolean(selectedNodeCapabilities?.can_redo);

  const header: WorkspaceDataTableHeaderInfo = {
    nodeLabel: resolveNodeDisplayLabel(selectedNode) ?? 'Unknown node',
    tabPosition,
    totalTabs: selectedNodeIds.length,
    isEmptyTable: Array.isArray(nodeData.data) && nodeData.data.length === 0,
  };

  const nodeActions: WorkspaceDataTableNodeActions = {
    onUndo: selectedNode?.id ? () => void undoNode(selectedNode.id) : undefined,
    onRedo: selectedNode?.id ? () => void redoNode(selectedNode.id) : undefined,
    onDelete: selectedNode?.id ? () => void deleteNode(selectedNode.id) : undefined,
    onRename: selectedNode?.id
      ? (newName: string) => void renameNode(selectedNode.id, newName)
      : undefined,
    onQueryPlan: selectedNode?.id
      ? async () => {
          if (!currentWorkspaceId) return null;
          const { data: resp } = await getNodeQueryPlan({
            path: { workspace_id: currentWorkspaceId, node_id: selectedNode.id },
            throwOnError: true,
          });
          return resp.plan;
        }
      : undefined,
    canUndo,
    canRedo,
  };

  const tabs: WorkspaceSelectionTabsState = {
    shouldShowTabs,
    tabs: displayTabIds.map((id) =>
      buildTabDescriptor(id, resolveNodeDisplayLabel(nodeById.get(id)) ?? id, id === activeNodeId),
    ),
    tabPosition,
    totalTabs: selectedNodeIds.length,
    onTabChange: handleTabChange,
    onTabClose: handleTabClose,
    onTabReorder: handleTabReorder,
  };

  const sorting: SortingState = nodeTableRequest.sort_by
    ? [{ id: nodeTableRequest.sort_by, desc: nodeTableRequest.descending }]
    : [];

  const columnFilters: ColumnFiltersState =
    nodeTableRequest.filter_column && nodeTableRequest.filter_value
      ? [
          {
            id: nodeTableRequest.filter_column,
            value: {
              value: nodeTableRequest.filter_value,
              op: nodeTableRequest.filter_op as FilterOperator,
            },
          },
        ]
      : [];

  /**
   * Adapts TanStack sorting into the active node's complete request.
   * Called by: `WorkspaceTable` through its controlled sorting callback.
   */
  const onSortingChange = (next: SortingState) => {
    const sort = next[0];
    updateNodeTableRequest((request) => ({
      ...request,
      page: 1,
      sort_by: sort?.id ?? null,
      descending: sort?.desc ?? false,
    }));
  };

  /**
   * Adapts TanStack column filters into the active node's complete request.
   * Called by: `WorkspaceTable` through its controlled filter callback.
   */
  const onColumnFiltersChange = (next: ColumnFiltersState) => {
    const filter = next[0];
    const parts = filter?.value as { value: string; op: string } | undefined;
    updateNodeTableRequest((request) => ({
      ...request,
      page: 1,
      filter_column: filter?.id ?? null,
      filter_value: parts?.value ?? null,
      filter_op: parts?.op ?? 'contains',
    }));
  };

  // Mutation callbacks are stable per active node id so the WorkspaceTable
  // effect that depends on `onRefreshSchema` only fires when the selection
  // actually changes, not on every parent render.
  const selectedNodeIdForCallbacks = selectedNode?.id;

  /** Casts a column on the active node. */
  const handleCast = useCallback(
    async (column: string, targetType: string, format?: string) => {
      if (!selectedNodeIdForCallbacks) return;
      await castColumn(selectedNodeIdForCallbacks, column, targetType, format);
    },
    [selectedNodeIdForCallbacks, castColumn],
  );

  /** Renames a column on the active node. */
  const handleRenameColumn = useCallback(
    async (column: string, nextName: string) => {
      if (!selectedNodeIdForCallbacks) return;
      await renameColumn(selectedNodeIdForCallbacks, column, nextName);
    },
    [selectedNodeIdForCallbacks, renameColumn],
  );

  /** Deletes a column from the active node. */
  const handleDeleteColumn = useCallback(
    async (column: string) => {
      if (!selectedNodeIdForCallbacks) return;
      await deleteColumn(selectedNodeIdForCallbacks, column);
    },
    [selectedNodeIdForCallbacks, deleteColumn],
  );

  /** Refreshes schema for the active node after column mutations. */
  const handleRefreshSchema = useCallback(async () => {
    if (!selectedNodeIdForCallbacks) return undefined;
    return await refreshNodeSchema(selectedNodeIdForCallbacks);
  }, [selectedNodeIdForCallbacks, refreshNodeSchema]);

  const table: WorkspaceTableProps = {
    data: nodeData.data,
    columns: nodeData.columns,
    loading: nodeDataQuery.isLoading,
    workspaceId: currentWorkspaceId ?? undefined,
    nodeId: selectedNode?.id,
    documentColumn: selectedNode?.document ?? undefined,
    onCast: selectedNodeIdForCallbacks ? handleCast : undefined,
    onRenameColumn: selectedNodeIdForCallbacks ? handleRenameColumn : undefined,
    onDeleteColumn: selectedNodeIdForCallbacks ? handleDeleteColumn : undefined,
    onRefreshSchema: selectedNodeIdForCallbacks ? handleRefreshSchema : undefined,
    pagination: nodeData.pagination,
    rowCount: nodeData.pagination.total_rows,
    sorting,
    onSortingChange,
    columnFilters,
    onColumnFiltersChange,
    onPageChange: (page) => {
      updateNodeTableRequest((request) => ({ ...request, page }));
    },
    onPageSizeChange: (pageSize) => {
      updateNodeTableRequest((request) => ({ ...request, page: 1, page_size: pageSize }));
    },
  };

  return {
    selectedNode,
    header,
    nodeActions,
    tabs,
    table,
    loading: {
      nodeData: nodeDataQuery.isLoading,
    },
  };
};
