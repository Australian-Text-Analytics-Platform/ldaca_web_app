import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '@/hooks/useAuth';
import { useSelectionStore } from '@/stores/selectionStore';
import { useUIStore } from '@/stores/uiStore';
import { type PaginationMap, type PaginationState, createDefaultPagination } from './types';

const useSelectionSlice = () =>
  useSelectionStore(
    useShallow((state) => ({
      currentWorkspaceId: state.currentWorkspaceId,
      setCurrentWorkspaceId: state.setCurrentWorkspaceId,
      selectedNodeId: state.selectedNodeId,
      selectedNodeIds: state.selectedNodeIds,
      selectNode: state.selectNode,
      setSelectedNodes: state.setSelectedNodes,
      toggleNodeSelection: state.toggleNodeSelection,
      clearAllSelections: state.clearAllSelections,
    }))
  );

const useUISlice = () =>
  useUIStore(
    useShallow((state) => ({
      loadingOperations: state.loadingOperations,
      operationErrors: state.operationErrors,
      startOperation: state.startOperation,
      endOperation: state.endOperation,
      setOperationError: state.setOperationError,
    }))
  );

/**
 * Core workspace wiring: bundles auth, current-workspace id, selection, and
 * per-node pagination. `currentWorkspaceId` lives in `selectionStore`, so this
 * hook just re-exposes the slice. Pagination stays as local state because it's tightly coupled to `selectedNodeId` lifecycle and
 * shouldn't persist across workspaces.
 */
export const useWorkspaceCore = () => {
  const { getAuthHeaders, isAuthenticated } = useAuth();
  const {
    currentWorkspaceId,
    setCurrentWorkspaceId,
    selectedNodeId,
    selectedNodeIds,
    selectNode,
    setSelectedNodes,
    toggleNodeSelection,
    clearAllSelections,
  } = useSelectionSlice();
  const ui = useUISlice();

  const [pagination, setPaginationState] = useState<PaginationMap>({});

  // useCallback'd so the WorkspaceProvider selection slice (which exposes
  // these to every component that reads `useWorkspaceSelection`) stays
  // referentially stable across renders. setPaginationState is stable
  // (React useState setter), so updatePagination has no real deps;
  // downstream handlers depend only on stable refs + selectedNodeId.
  const updatePagination = useCallback(
    (nodeId: string, updater: (existing: PaginationState) => PaginationState) => {
      setPaginationState((prev) => {
        const existing = prev[nodeId] || createDefaultPagination();
        const next = updater(existing);
        if (next === existing) return prev;
        return { ...prev, [nodeId]: next };
      });
    },
    [],
  );

  const updateCurrentPage = useCallback(
    (nodeId: string, page: number) =>
      updatePagination(nodeId, (existing) =>
        existing.currentPage === page ? existing : { ...existing, currentPage: page },
      ),
    [updatePagination],
  );

  const updatePageSize = useCallback(
    (nodeId: string, pageSize: number) =>
      updatePagination(nodeId, (existing) =>
        existing.pageSize === pageSize && existing.currentPage === 1
          ? existing
          : { ...existing, pageSize, currentPage: 1 },
      ),
    [updatePagination],
  );

  const getPaginationForNode = useCallback(
    (nodeId?: string | null) => (nodeId && pagination[nodeId]) || createDefaultPagination(),
    [pagination],
  );

  // Reset pagination + selection when the workspace changes. First render is
  // skipped (previous ref starts as null) so we don't clobber the caller's
  // freshly-chosen workspace.
  const previousWorkspaceIdRef = useRef<string | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- Resetting selection/pagination on workspace change; guarded by ref comparison */
  useEffect(() => {
    const previous = previousWorkspaceIdRef.current;
    if (previous === currentWorkspaceId) return;
    if (previous !== null) clearAllSelections();
    setPaginationState({});
    previousWorkspaceIdRef.current = currentWorkspaceId;
  }, [clearAllSelections, currentWorkspaceId]);

  // Initialize pagination for newly selected nodes (lazy).
  useEffect(() => {
    if (!selectedNodeId || pagination[selectedNodeId]) return;
    setPaginationState((prev) =>
      prev[selectedNodeId] ? prev : { ...prev, [selectedNodeId]: createDefaultPagination() }
    );
  }, [pagination, selectedNodeId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handlePageChange = useCallback(
    (page: number) => {
      if (selectedNodeId) updateCurrentPage(selectedNodeId, page);
    },
    [selectedNodeId, updateCurrentPage],
  );
  const handlePageSizeChange = useCallback(
    (pageSize: number) => {
      if (selectedNodeId) updatePageSize(selectedNodeId, pageSize);
    },
    [selectedNodeId, updatePageSize],
  );

  const handleSortingChange = useCallback(
    (sortBy: string | undefined, descending: boolean | undefined) => {
      if (!selectedNodeId) return;
      updatePagination(selectedNodeId, (existing) => ({
        ...existing,
        sortBy,
        descending,
        currentPage: 1,
      }));
    },
    [selectedNodeId, updatePagination],
  );

  const handleFilterChange = useCallback(
    (filterColumn: string | undefined, filterValue: string | undefined, filterOp: string | undefined) => {
      if (!selectedNodeId) return;
      updatePagination(selectedNodeId, (existing) => ({
        ...existing,
        filterColumn,
        filterValue,
        filterOp,
        currentPage: 1,
      }));
    },
    [selectedNodeId, updatePagination],
  );

  // Memoize authHeaders so the (~25) downstream mutation closures and
  // the four-slice WorkspaceProvider context don't see a new object
  // identity on every render. `getAuthHeaders` is itself useCallback'd
  // in useAuth.ts:271 so this dep is stable across the auth lifetime.
  const authHeaders = useMemo(() => {
    if (!isAuthenticated) return {};
    const headers = getAuthHeaders();
    return headers.Authorization ? headers : {};
  }, [isAuthenticated, getAuthHeaders]);

  const operationErrorsRecord: Record<string, string> = {};
  ui.operationErrors.forEach((value, key) => { operationErrorsRecord[key] = value; });

  return {
    authHeaders,
    isAuthenticated,

    currentWorkspaceId,
    setCurrentWorkspaceId,

    selectedNodeId,
    selectedNodeIds,
    selectNode,
    setSelectedNodes,
    toggleNodeSelection,
    clearSelection: clearAllSelections,

    pagination,
    getPaginationForNode,
    updateCurrentPage,
    updatePageSize,
    handlePageChange,
    handlePageSizeChange,
    handleSortingChange,
    handleFilterChange,

    loadingOperationCount: ui.loadingOperations.size,
    operationErrorsRecord,
    startOperation: ui.startOperation,
    endOperation: ui.endOperation,
    setOperationError: ui.setOperationError,
  } as const;
};
