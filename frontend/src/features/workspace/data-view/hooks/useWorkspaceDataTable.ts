import { useEffect, useState } from 'react';
import { useWorkspaceActions } from '../../../../hooks/useWorkspaceActions';
import { useWorkspaceData } from '../../../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../../../hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '../../../../hooks/useWorkspaceStatus';
import type { WorkspaceTableProps } from '../components/WorkspaceTable';

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

const resolveNodeDisplayLabel = (node: WorkspaceNodeDisplayLike | null | undefined): string | undefined => {
  if (!node) {
    return undefined;
  }

  return node.name || node.id;
};

const EMPTY_NODE_IDS: string[] = [];

export const useWorkspaceDataTable = (): WorkspaceDataTableViewModel => {
  const { currentWorkspaceId, nodeData } = useWorkspaceData();
  const {
    selectedNode,
    selectedNodes,
    selectedNodeIds,
    handlePageChange,
    handlePageSizeChange,
  } = useWorkspaceSelection();
  const {
    castColumn,
    renameColumn,
    deleteColumn,
    refreshNodeSchema,
    deleteNode,
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

  const handleTabChange = (nodeId: string) => {
      if (!nodeId || nodeId === activeNodeId || !normalizedSelectedNodeIds.includes(nodeId)) {
        return;
      }
      const reordered = [...normalizedSelectedNodeIds.filter((id) => id !== nodeId), nodeId];
      selectNodes(reordered);
    };

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

  const table: WorkspaceTableProps = {
    data: nodeData.data,
    loading: isLoading.nodeData,
    workspaceId: currentWorkspaceId || undefined,
    nodeId: selectedNode?.id,
    onCast: selectedNode
      ? async (column: string, targetType: string, format?: string) => {
          await castColumn(selectedNode.id, column, targetType, format);
        }
      : undefined,
    onRenameColumn: selectedNode
      ? async (column: string, nextName: string) => {
          await renameColumn(selectedNode.id, column, nextName);
        }
      : undefined,
    onDeleteColumn: selectedNode
      ? async (column: string) => {
          await deleteColumn(selectedNode.id, column);
        }
      : undefined,
    onRefreshSchema: selectedNode
      ? async () => {
          return await refreshNodeSchema(selectedNode.id);
        }
      : undefined,
    pagination: nodeData.pagination,
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
