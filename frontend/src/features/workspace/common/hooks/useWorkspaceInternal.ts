import { useEffect, useMemo, useRef } from 'react';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { useWorkspaceCore } from './useWorkspaceCore';
import { useWorkspaceQueries } from './useWorkspaceQueries';
import { useWorkspaceNodeMutations } from './useWorkspaceNodeMutations';
import { usePreprocessingInputsStore } from '@/stores/preprocessingInputsStore';
import { useRecentSelectionsStore } from '@/stores/recentSelectionsStore';
import { usePinnedNodesStore } from '@/stores/pinnedNodesStore';
import { useNodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import { useAnalysisTabsPresentationStore } from '@/features/views/common/tabs/analysisTabsPresentationStore';

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
  const loadingOperationCount = useIsMutating({ mutationKey: ['workspace'] });

  const {
    isAuthenticated,
    userId,
    activeNodeId,
    selectedNodeIds,
    activateNode,
    reorderSelectedNodes,
    removeNode,
    replaceSelectedNodes,
    toggleNode,
    clearSelection,
  } = core;

  const {
    workspaceCatalogue,
    workspaces,
    currentWorkspace,
    workspaceGraph,
    nodes,
    selectedNode,
    selectedNodes,
    queryLoadingState,
    currentWorkspaceId,
    workspacesHydrated,
    nodesHydrated,
  } = useWorkspaceQueries({
    isAuthenticated,
    activeNodeId,
    selectedNodeIds,
  });

  const previousWorkspaceIdRef = useRef<string | null>(currentWorkspaceId);
  useEffect(() => {
    if (previousWorkspaceIdRef.current === currentWorkspaceId) return;
    clearSelection();
    previousWorkspaceIdRef.current = currentWorkspaceId;
  }, [clearSelection, currentWorkspaceId]);

  useEffect(() => {
    if (!workspacesHydrated) return;
    const workspaceIds = workspaces.map((workspace) => workspace.id);
    usePreprocessingInputsStore.getState().pruneWorkspaces(userId, workspaceIds);
    useRecentSelectionsStore.getState().pruneWorkspaces(userId, workspaceIds);
    useAnalysisTabsPresentationStore.getState().pruneWorkspaces(userId, workspaceIds);
  }, [userId, workspaces, workspacesHydrated]);

  useEffect(() => {
    if (!currentWorkspaceId || !nodesHydrated) return;
    const nodeIds = nodes.map((node) => node.id);
    const valid = new Set(nodeIds);
    const validSelectedIds = selectedNodeIds.filter((nodeId) => valid.has(nodeId));
    const validActiveNodeId = activeNodeId && valid.has(activeNodeId) ? activeNodeId : null;
    if (validSelectedIds.length !== selectedNodeIds.length || validActiveNodeId !== activeNodeId) {
      replaceSelectedNodes(validSelectedIds, validActiveNodeId);
    }
    usePreprocessingInputsStore.getState().pruneNodes(userId, currentWorkspaceId, nodeIds);
    useRecentSelectionsStore.getState().pruneNodes(userId, currentWorkspaceId, nodeIds);
    usePinnedNodesStore.getState().prune(nodeIds);
    useNodeInputRequestsStore.getState().prune(currentWorkspaceId, nodeIds);
  }, [
    activeNodeId,
    currentWorkspaceId,
    nodes,
    nodesHydrated,
    replaceSelectedNodes,
    selectedNodeIds,
    userId,
  ]);

  const { actions: nodeActions } = useWorkspaceNodeMutations({
    currentWorkspaceId,
    removeNode,
    replaceSelectedNodes,
    clearSelection,
    queryClient,
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
    workspaceCatalogue,
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
