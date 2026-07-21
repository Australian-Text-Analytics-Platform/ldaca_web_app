import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceCore } from './useWorkspaceCore';
import { useWorkspaceQueries } from './useWorkspaceQueries';
import { useWorkspaceNodeMutations } from './useWorkspaceNodeMutations';
import { useDevicePreferencesStore } from '@/stores/preferencesStore';

/**
 * Orchestrates core state, queries, and mutations into the single internal
 * workspace model fanned out by `WorkspaceProvider`.
 * Used by: `WorkspaceProvider`, which fans the composed workspace model into
 * data, selection, status, and action contexts.
 * Flow: core, query, mutation, and UI-sync hooks combine backend data with local selection before provider contexts expose the slices.
 */
export const useWorkspaceInternal = () => {
  const core = useWorkspaceCore();
  const queryClient = useQueryClient();
  const lastWorkspaceId = useDevicePreferencesStore((state) => state.lastWorkspaceId);
  const setLastWorkspaceId = useDevicePreferencesStore((state) => state.setLastWorkspaceId);

  const {
    isAuthenticated,
    currentWorkspaceId,
    setCurrentWorkspaceId,
    activeNodeId,
    selectedNodeIds,
    activateNode,
    reorderSelectedNodes,
    removeNode,
    replaceSelectedNodes,
    toggleNode,
    clearSelection,
    loadingOperationCount,
    startOperation,
    endOperation,
  } = core;

  const {
    workspaces,
    currentWorkspace,
    workspaceGraph,
    nodes,
    selectedNode,
    selectedNodes,
    queryLoadingState,
  } = useWorkspaceQueries({
    isAuthenticated,
    currentWorkspaceId,
    activeNodeId,
    selectedNodeIds,
  });

  useEffect(() => {
    if (!isAuthenticated) {
      if (currentWorkspaceId !== null) setCurrentWorkspaceId(null);
      return;
    }
    if (currentWorkspaceId === null && lastWorkspaceId) {
      if (workspaces.some((workspace) => workspace.id === lastWorkspaceId)) {
        setCurrentWorkspaceId(lastWorkspaceId);
      } else {
        setLastWorkspaceId(null);
      }
    }
  }, [
    currentWorkspaceId,
    isAuthenticated,
    lastWorkspaceId,
    setCurrentWorkspaceId,
    setLastWorkspaceId,
    workspaces,
  ]);

  const { actions: nodeActions } = useWorkspaceNodeMutations({
    currentWorkspaceId,
    setCurrentWorkspaceId,
    removeNode,
    replaceSelectedNodes,
    clearSelection,
    queryClient,
    startOperation,
    endOperation,
  });

  const selectionActions = useMemo(
    () => ({
      activateNode,
      reorderSelectedNodes,
      removeNode,
      replaceSelectedNodes,
      toggleNode,
      clearSelection,
    }),
    [
      activateNode,
      reorderSelectedNodes,
      removeNode,
      replaceSelectedNodes,
      toggleNode,
      clearSelection,
    ],
  );

  const actions = useMemo(
    () => ({
      ...selectionActions,
      ...nodeActions,
    }),
    [selectionActions, nodeActions],
  );

  const operationsLoading = loadingOperationCount > 0;
  const isLoading = useMemo(
    () => ({
      ...queryLoadingState,
      operations: operationsLoading,
    }),
    [queryLoadingState, operationsLoading],
  );

  return {
    workspaces,
    currentWorkspace,
    currentWorkspaceId,
    nodes,
    selectedNode,
    selectedNodes,
    activeNodeId,
    selectedNodeIds,
    workspaceGraph,
    isLoading,
    actions,
  };
};
