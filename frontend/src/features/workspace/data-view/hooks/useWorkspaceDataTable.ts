import { useCallback, useEffect, useState } from 'react';
import type { SortingState, ColumnFiltersState } from '@tanstack/react-table';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { getNodeQueryPlan } from '@/api/generated/sdk.gen';
import { useAuth } from '@/hooks/useAuth';
import type { WorkspaceTableProps } from '../components/WorkspaceTable';
import type { FilterOperator } from '../types';
import { getNodeDocumentColumn } from '../utils/documentColumn';

export interface WorkspaceDataTableHeaderInfo {
  nodeLabel: string;
  tabPosition: number;
  totalTabs: number;
  isEmptyTable: boolean;
}

export interface WorkspaceDataTableNodeActions {
  onUndo?: () => void;
  onRedo?: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  onQueryPlan?: () => Promise<string | null>;
  canUndo: boolean;
  canRedo: boolean;
}

export interface WorkspaceSelectionTab {
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

/**
 * Creates one tab descriptor for the multi-selected-node tab strip.
 * Used by: local callers in workspace/useWorkspaceDataTable module because selected nodes need normalized tab labels before rendering.
 * Flow: accept a selected node id, fall back to that id when no label is available, and attach the active-tab flag.
 */
const buildTabDescriptor = (node: WorkspaceSelectionTab['id'], label?: string, isActive = false) => ({
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
 * Used by: local callers in workspace/useWorkspaceDataTable module because node records can expose either names or ids.
 * Flow: return undefined for missing node data, otherwise prefer the display name and fall back to the node id.
 */
const resolveNodeDisplayLabel = (node: WorkspaceNodeDisplayLike | null | undefined): string | undefined => {
  if (!node) {
    return undefined;
  }

  return node.name || node.id;
};

const EMPTY_NODE_IDS: string[] = [];

/**
 * Composes workspace data, selection, actions, and table callbacks into the
 * view model consumed by `WorkspaceDataTableFeature`.
 * Used by: useWorkspaceData hook, WorkspaceDataTableFeature component, WorkspaceTable component (rg call sites/imports) because the feature shell needs a single view-model hook.
 * Flow: read workspace slices, preserve tab order across multi-selection changes, build header/node actions/tabs, then adapt pagination, sorting, filters, and mutations into table props.
 */
export const useWorkspaceDataTable = (): WorkspaceDataTableViewModel => {
  const { currentWorkspaceId, nodeData } = useWorkspaceData();
  const {
    selectedNode,
    selectedNodes,
    selectedNodeIds,
    handlePageChange,
    handlePageSizeChange,
    handleSortingChange,
    handleFilterChange,
    getPaginationForNode,
  } = useWorkspaceSelection();
  const { getAuthHeaders } = useAuth();
  const {
    castColumn,
    renameColumn,
    deleteColumn,
    refreshNodeSchema,
    deleteNode,
    renameNode,
    undoNode,
    redoNode,
    selectNodes,
    toggleNodeSelection,
  } = useWorkspaceActions();
  const { isLoading } = useWorkspaceStatus();

  const normalizedSelectedNodeIds = selectedNodeIds ?? EMPTY_NODE_IDS;
  const multiSelectedNodes = selectedNodes.filter(Boolean);
  const shouldShowTabs = multiSelectedNodes.length > 1;
  const activeNodeId = selectedNode?.id ?? multiSelectedNodes[0]?.id ?? null;

  const [tabOrder, setTabOrder] = useState<string[]>(() => [...normalizedSelectedNodeIds]);
  const nodeById = (() => {
    const map = new Map<string, (typeof multiSelectedNodes)[number]>();
    multiSelectedNodes.forEach((node) => {
      if (node?.id) {
        map.set(node.id, node);
      }
    });
    return map;
  })();

  /* eslint-disable react-hooks/set-state-in-effect -- Syncing tab order with selected node IDs; updater avoids unnecessary re-renders */
  useEffect(() => {
    setTabOrder((current) => {
      const filtered = current.filter((id) => normalizedSelectedNodeIds.includes(id));
      const additions = normalizedSelectedNodeIds.filter((id) => !filtered.includes(id));
      if (
        filtered.length === current.length &&
        additions.length === 0 &&
        current.length === normalizedSelectedNodeIds.length
      ) {
        return current;
      }
      return [...filtered, ...additions];
    });
  }, [normalizedSelectedNodeIds]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const displayTabIds = (shouldShowTabs ? tabOrder.filter((id) => nodeById.has(id)) : []);

  const activeTabIndex = displayTabIds.findIndex((id) => id === activeNodeId);
  const tabPosition = activeTabIndex >= 0 ? activeTabIndex + 1 : displayTabIds.length > 0 ? 1 : 0;

    /**
   * Promotes a selected node tab to the active node.
     * Called by: useWorkspaceDataTable internal event, effect, or helper flow.
     * Why: because the table view model needs small helpers to translate workspace data and UI events into server-backed table state.
     */
  const handleTabChange = (nodeId: string) => {
      if (!nodeId || nodeId === activeNodeId || !normalizedSelectedNodeIds.includes(nodeId)) {
        return;
      }
      const reordered = [...normalizedSelectedNodeIds.filter((id) => id !== nodeId), nodeId];
      selectNodes(reordered);
    };

    /**
   * Removes a node from the multi-selection tab strip.
     * Called by: useWorkspaceDataTable internal event, effect, or helper flow.
     * Why: because the table view model needs small helpers to translate workspace data and UI events into server-backed table state.
     */
  const handleTabClose = (nodeId: string) => {
      if (!nodeId) {
        return;
      }
      setTabOrder((current) => current.filter((id) => id !== nodeId));
      toggleNodeSelection(nodeId);
    };

  const selectedNodeCapabilities = selectedNode as {
    id?: string;
    can_undo?: boolean;
    can_redo?: boolean;
  } | null;
  const canUndo = Boolean(selectedNodeCapabilities?.can_undo);
  const canRedo = Boolean(selectedNodeCapabilities?.can_redo);

  const header: WorkspaceDataTableHeaderInfo = {
    nodeLabel: resolveNodeDisplayLabel(selectedNode) || 'Unknown node',
    tabPosition,
    totalTabs: multiSelectedNodes.length,
    isEmptyTable: Array.isArray(nodeData.data) && nodeData.data.length === 0,
  };

  const nodeActions: WorkspaceDataTableNodeActions = {
    onUndo: selectedNode?.id && undoNode ? () => void undoNode(selectedNode.id) : undefined,
    onRedo: selectedNode?.id && redoNode ? () => void redoNode(selectedNode.id) : undefined,
    onDelete: selectedNode?.id && deleteNode ? () => void deleteNode(selectedNode.id) : undefined,
    onRename: selectedNode?.id && renameNode ? (newName: string) => void renameNode(selectedNode.id, newName) : undefined,
    onQueryPlan: selectedNode?.id
      ? async () => {
          const { data: resp } = await getNodeQueryPlan({
            headers: getAuthHeaders(),
            path: { node_id: selectedNode.id },
            throwOnError: true,
          });
          return resp.plan ?? null;
        }
      : undefined,
    canUndo,
    canRedo,
  };

  const tabs: WorkspaceSelectionTabsState = {
    shouldShowTabs,
    tabs: displayTabIds.map((id) =>
      buildTabDescriptor(id, resolveNodeDisplayLabel(nodeById.get(id)) || id, id === activeNodeId)
    ),
    tabPosition,
    totalTabs: multiSelectedNodes.length,
    onTabChange: handleTabChange,
    onTabClose: handleTabClose,
  };

  // ── Derive TanStack-compatible sorting / filtering state from per-node pagination ──
  const paginationState = (() => {
    if (!selectedNode?.id) return undefined;
    return getPaginationForNode(selectedNode.id);
  })();

  const sorting: SortingState = paginationState?.sortBy
    ? [{ id: paginationState.sortBy, desc: paginationState.descending ?? false }]
    : [];

  const columnFilters: ColumnFiltersState = paginationState?.filterColumn && paginationState.filterValue
    ? [{ id: paginationState.filterColumn, value: { value: paginationState.filterValue, op: (paginationState.filterOp ?? 'contains') as FilterOperator } }]
    : [];

    /**
   * Adapts TanStack sorting state into workspace pagination state.
     * Called by: useWorkspaceDataTable internal event, effect, or helper flow.
     * Why: because the table view model needs small helpers to translate workspace data and UI events into server-backed table state.
     */
  const onSortingChange = (next: SortingState) => {
    if (next.length === 0) {
      handleSortingChange(undefined, undefined);
    } else {
      handleSortingChange(next[0]!.id, next[0]!.desc);
    }
  };

    /**
   * Adapts TanStack column-filter state into workspace pagination state.
     * Called by: useWorkspaceDataTable internal event, effect, or helper flow.
     * Why: because the table view model needs small helpers to translate workspace data and UI events into server-backed table state.
     */
  const onColumnFiltersChange = (next: ColumnFiltersState) => {
    if (next.length === 0) {
      handleFilterChange(undefined, undefined, undefined);
    } else {
      const filter = next[0]!;
      const parts = filter.value as { value: string; op: string };
      handleFilterChange(String(filter.id), parts.value, parts.op);
    }
  };

  // Mutation callbacks are stable per-selectedNodeId so the WorkspaceTable
  // effect that depends on `onRefreshSchema` only fires when the selection
  // actually changes, not on every parent render.
  const selectedNodeIdForCallbacks = selectedNode?.id;

  /** Casts a column on the active node. */
  const handleCast = useCallback(async (column: string, targetType: string, format?: string) => {
    if (!selectedNodeIdForCallbacks) return;
    await castColumn(selectedNodeIdForCallbacks, column, targetType, format);
  }, [selectedNodeIdForCallbacks, castColumn]);

  /** Renames a column on the active node. */
  const handleRenameColumn = useCallback(async (column: string, nextName: string) => {
    if (!selectedNodeIdForCallbacks) return;
    await renameColumn(selectedNodeIdForCallbacks, column, nextName);
  }, [selectedNodeIdForCallbacks, renameColumn]);

  /** Deletes a column from the active node. */
  const handleDeleteColumn = useCallback(async (column: string) => {
    if (!selectedNodeIdForCallbacks) return;
    await deleteColumn(selectedNodeIdForCallbacks, column);
  }, [selectedNodeIdForCallbacks, deleteColumn]);

  /** Refreshes schema for the active node after column mutations. */
  const handleRefreshSchema = useCallback(async () => {
    if (!selectedNodeIdForCallbacks) return undefined;
    return await refreshNodeSchema(selectedNodeIdForCallbacks);
  }, [selectedNodeIdForCallbacks, refreshNodeSchema]);

  const table: WorkspaceTableProps = {
    data: nodeData.data,
    loading: isLoading.nodeData,
    workspaceId: currentWorkspaceId || undefined,
    nodeId: selectedNode?.id,
    documentColumn: getNodeDocumentColumn(selectedNode),
    onCast: selectedNodeIdForCallbacks ? handleCast : undefined,
    onRenameColumn: selectedNodeIdForCallbacks ? handleRenameColumn : undefined,
    onDeleteColumn: selectedNodeIdForCallbacks ? handleDeleteColumn : undefined,
    onRefreshSchema: selectedNodeIdForCallbacks ? handleRefreshSchema : undefined,
    pagination: nodeData.pagination,
    rowCount: nodeData.pagination?.total_rows ?? 0,
    sorting,
    onSortingChange,
    columnFilters,
    onColumnFiltersChange,
    onPageChange: handlePageChange,
    onPageSizeChange: handlePageSizeChange,
  };

  return {
    selectedNode,
    header,
    nodeActions,
    tabs,
    table,
    loading: {
      nodeData: isLoading.nodeData,
    },
  };
};
