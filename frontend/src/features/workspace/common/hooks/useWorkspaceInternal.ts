import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceCore } from './useWorkspaceCore';
import { useWorkspaceQueries } from './useWorkspaceQueries';
import { useWorkspaceNodeMutations } from './useWorkspaceNodeMutations';

export const useWorkspaceInternal = () => {
  const core = useWorkspaceCore();
  const queryClient = useQueryClient();

  const {
    authHeaders,
    isAuthenticated,
    currentWorkspaceId,
    setCurrentWorkspaceId,
    selectedNodeId,
    selectedNodeIds,
    selectNode,
    setSelectedNodes,
    toggleNodeSelection,
    clearSelection,
    getPaginationForNode,
    handlePageChange,
    handlePageSizeChange,
    handleSortingChange,
    handleFilterChange,
    loadingOperationCount,
    operationErrorsRecord,
    startOperation,
    endOperation,
    setOperationError,
  } = core;

  const {
    workspaces,
    currentWorkspace,
    workspaceGraph,
    nodes,
    selectedNode,
    selectedNodes,
    nodeData,
    queryLoadingState,
    queryErrorState,
    currentWorkspaceIdFromQuery,
    currentWorkspaceQueryError,
  } = useWorkspaceQueries({
    authHeaders,
    isAuthenticated,
    currentWorkspaceId,
    selectedNodeId,
    selectedNodeIds,
    getPaginationForNode,
  });

  // The `current.get` server query is treated as a one-shot bootstrap that
  // hydrates the selectionStore. After the first hydration
  // (or first error after authentication), `setCurrentWorkspace` mutations
  // are the only writer — without this guard, every refetch of the
  // currentWorkspace query would otherwise revert local state back to the
  // server's stale value during the brief window before the post-mutation
  // invalidate lands.
  const hasBootstrappedRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated) {
      hasBootstrappedRef.current = false;
      if (currentWorkspaceId !== null) setCurrentWorkspaceId(null);
      return;
    }
    if (hasBootstrappedRef.current) return;

    if (currentWorkspaceIdFromQuery !== undefined) {
      hasBootstrappedRef.current = true;
      if (currentWorkspaceId !== currentWorkspaceIdFromQuery) {
        setCurrentWorkspaceId(currentWorkspaceIdFromQuery);
      }
    } else if (currentWorkspaceQueryError) {
      hasBootstrappedRef.current = true;
      if (currentWorkspaceId !== null) setCurrentWorkspaceId(null);
    }
  }, [
    currentWorkspaceId,
    currentWorkspaceIdFromQuery,
    currentWorkspaceQueryError,
    isAuthenticated,
    setCurrentWorkspaceId,
  ]);

  const { actions: nodeActions } = useWorkspaceNodeMutations({
    authHeaders,
    currentWorkspaceId,
    selectedNodeId,
    setCurrentWorkspaceId,
    setSelectedNodes,
    clearSelection,
    queryClient,
    startOperation,
    endOperation,
    setOperationError,
  });

  const selectionActions = useMemo(
    () => ({
      selectNode,
      selectNodes: setSelectedNodes,
      toggleNodeSelection,
      clearSelection,
    }),
    [selectNode, setSelectedNodes, toggleNodeSelection, clearSelection],
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

  const operationsError = Object.values(operationErrorsRecord)[0] || null;
  const errors = useMemo(
    () => ({
      ...queryErrorState,
      operations: operationsError,
    }),
    [queryErrorState, operationsError],
  );

  return {
    workspaces,
    currentWorkspace,
    currentWorkspaceId,
    nodes,
    selectedNode,
    selectedNodes,
    selectedNodeId,
    selectedNodeIds,
    workspaceGraph,
    nodeData,
    isLoading,
    errors,
    actions,
    handlePageChange,
    handlePageSizeChange,
    handleSortingChange,
    handleFilterChange,
    getPaginationForNode,
  };
};
