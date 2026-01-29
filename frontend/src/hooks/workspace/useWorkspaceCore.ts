import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '../useAuth';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUIStore } from '../../stores/uiStore';
import { PaginationMap, PaginationState, createDefaultPagination } from './types';

const normalizeOperationErrors = (operationErrors: Map<string, string> | Record<string, string> | null | undefined) => {
  if (!operationErrors) {
    return {} as Record<string, string>;
  }

  if (operationErrors instanceof Map) {
    const result: Record<string, string> = {};
    operationErrors.forEach((value, key) => {
      if (typeof value === 'string') {
        result[key] = value;
      }
    });
    return result;
  }

  if (typeof operationErrors === 'object') {
    const entries = Object.entries(operationErrors as Record<string, string>);
    return entries.reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === 'string') {
        acc[key] = value;
      }
      return acc;
    }, {});
  }

  return {} as Record<string, string>;
};

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

export const useWorkspaceCore = () => {
  const { getAuthHeaders, isAuthenticated } = useAuth();
  const selection = useSelectionSlice();
  const ui = useUISlice();

  const {
    selectedNodeId,
    selectedNodeIds,
    selectNode,
    setSelectedNodes,
    toggleNodeSelection,
    clearAllSelections,
  } = selection;

  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const [pagination, setPaginationState] = useState<PaginationMap>({});

  const updatePagination = (nodeId: string, updater: (existing: PaginationState) => PaginationState) => {
    setPaginationState((prev) => {
      const existing = prev[nodeId] || createDefaultPagination();
      const next = updater(existing);
      if (next === existing) {
        return prev;
      }
      return { ...prev, [nodeId]: next };
    });
  };

  const updateCurrentPage = (nodeId: string, page: number) => {
    updatePagination(nodeId, (existing) =>
      existing.currentPage === page ? existing : { ...existing, currentPage: page }
    );
  };

  const updatePageSize = (nodeId: string, pageSize: number) => {
    updatePagination(nodeId, (existing) => {
      if (existing.pageSize === pageSize && existing.currentPage === 1) {
        return existing;
      }
      return { ...existing, pageSize, currentPage: 1 };
    });
  };

  const getPaginationForNode = (nodeId?: string | null) => {
    if (!nodeId) {
      return createDefaultPagination();
    }
    return pagination[nodeId] || createDefaultPagination();
  };

  const previousWorkspaceIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousWorkspaceIdRef.current;
    if (previous !== currentWorkspaceId) {
      if (previous !== null) {
        clearAllSelections();
      }
      setPaginationState({});
      previousWorkspaceIdRef.current = currentWorkspaceId;
    }
  }, [clearAllSelections, currentWorkspaceId]);

  useEffect(() => {
    const nodeId = selectedNodeId;
    if (nodeId && !pagination[nodeId]) {
      setPaginationState((prev) => {
        if (prev[nodeId]) {
          return prev;
        }
        return {
          ...prev,
          [nodeId]: createDefaultPagination(),
        };
      });
    }
  }, [pagination, selectedNodeId]);

  const handlePageChange = (page: number) => {
    if (!selectedNodeId) return;
    updateCurrentPage(selectedNodeId, page);
  };

  const handlePageSizeChange = (pageSize: number) => {
    if (!selectedNodeId) return;
    updatePageSize(selectedNodeId, pageSize);
  };

  const authHeaders = (() => {
    if (!isAuthenticated) return {};
    const headers = getAuthHeaders();
    return headers.Authorization ? headers : {};
  })();

  const loadingOperationCount = (() => {
    if (ui.loadingOperations instanceof Set) {
      return ui.loadingOperations.size;
    }
    return 0;
  })();

  const operationErrorsRecord = normalizeOperationErrors(ui.operationErrors);

  return {
    // Auth
    authHeaders,
    isAuthenticated,

    // Workspace identity
    currentWorkspaceId,
    setCurrentWorkspaceId,

    // Selection
    selectedNodeId,
    selectedNodeIds,
    selectNode,
    setSelectedNodes,
    toggleNodeSelection,
    clearSelection: clearAllSelections,

    // Pagination
    pagination,
    getPaginationForNode,
    updateCurrentPage,
    updatePageSize,
    handlePageChange,
    handlePageSizeChange,

    // UI operations
    loadingOperationCount,
    operationErrorsRecord,
    startOperation: ui.startOperation,
    endOperation: ui.endOperation,
    setOperationError: ui.setOperationError,
  } as const;
};
