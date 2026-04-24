import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '../useAuth';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUIStore } from '../../stores/uiStore';
import { type PaginationMap, type PaginationState, createDefaultPagination } from './types';

const useSelectionSlice = () =>
  useSelectionStore(
    useShallow((state) => ({
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
 * per-node pagination. Pagination is kept as local state (not in a store)
 * because it's tightly coupled to `selectedNodeId` lifecycle and shouldn't
 * persist across workspaces.
 */
export const useWorkspaceCore = () => {
  const { getAuthHeaders, isAuthenticated } = useAuth();
  const {
    selectedNodeId,
    selectedNodeIds,
    selectNode,
    setSelectedNodes,
    toggleNodeSelection,
    clearAllSelections,
  } = useSelectionSlice();
  const ui = useUISlice();

  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const [pagination, setPaginationState] = useState<PaginationMap>({});

  const updatePagination = (nodeId: string, updater: (existing: PaginationState) => PaginationState) => {
    setPaginationState((prev) => {
      const existing = prev[nodeId] || createDefaultPagination();
      const next = updater(existing);
      if (next === existing) return prev;
      return { ...prev, [nodeId]: next };
    });
  };

  const updateCurrentPage = (nodeId: string, page: number) =>
    updatePagination(nodeId, (existing) =>
      existing.currentPage === page ? existing : { ...existing, currentPage: page }
    );

  const updatePageSize = (nodeId: string, pageSize: number) =>
    updatePagination(nodeId, (existing) =>
      existing.pageSize === pageSize && existing.currentPage === 1
        ? existing
        : { ...existing, pageSize, currentPage: 1 }
    );

  const getPaginationForNode = (nodeId?: string | null) =>
    (nodeId && pagination[nodeId]) || createDefaultPagination();

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

  const handlePageChange = (page: number) => {
    if (selectedNodeId) updateCurrentPage(selectedNodeId, page);
  };
  const handlePageSizeChange = (pageSize: number) => {
    if (selectedNodeId) updatePageSize(selectedNodeId, pageSize);
  };

  const handleSortingChange = (sortBy: string | undefined, descending: boolean | undefined) => {
    if (!selectedNodeId) return;
    updatePagination(selectedNodeId, (existing) => ({
      ...existing,
      sortBy,
      descending,
      currentPage: 1,
    }));
  };

  const handleFilterChange = (filterColumn: string | undefined, filterValue: string | undefined, filterOp: string | undefined) => {
    if (!selectedNodeId) return;
    updatePagination(selectedNodeId, (existing) => ({
      ...existing,
      filterColumn,
      filterValue,
      filterOp,
      currentPage: 1,
    }));
  };

  const authHeaders = (() => {
    if (!isAuthenticated) return {};
    const headers = getAuthHeaders();
    return headers.Authorization ? headers : {};
  })();

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
