import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useSelectionStore } from '@/stores/selectionStore';
import { useUIStore } from '@/stores/uiStore';

/**
 * Reads the selection store fields the workspace feature owns.
 * Used by: workspace/useWorkspaceCore components or tests that consume this hook.
 * Why: because the internal workspace hook needs auth, query client, and UI-store inputs gathered before query and mutation hooks run.
 */
const useSelectionSlice = () =>
  useSelectionStore(
    useShallow((state) => ({
      currentWorkspaceId: state.currentWorkspaceId,
      setCurrentWorkspaceId: state.setCurrentWorkspaceId,
      activeNodeId: state.activeNodeId,
      selectedNodeIds: state.selectedNodeIds,
      activateNode: state.activateNode,
      reorderSelectedNodes: state.reorderSelectedNodes,
      removeNode: state.removeNode,
      replaceSelectedNodes: state.replaceSelectedNodes,
      toggleNode: state.toggleNode,
      clearSelection: state.clearSelection,
    })),
  );

/**
 * Reads operation loading/error helpers from the UI store.
 * Used by: workspace/useWorkspaceCore components or tests that consume this hook.
 * Why: because the internal workspace hook needs auth, query client, and UI-store inputs gathered before query and mutation hooks run.
 */
const useUISlice = () =>
  useUIStore(
    useShallow((state) => ({
      loadingOperations: state.loadingOperations,
      operationErrors: state.operationErrors,
      startOperation: state.startOperation,
      endOperation: state.endOperation,
      setOperationError: state.setOperationError,
    })),
  );

/**
 * Core workspace wiring for auth, current-workspace identity, semantic node
 * selection, and operation status. Data-view request state is intentionally
 * absent: `useWorkspaceDataTable` owns its per-node pagination/sort/filter
 * lifecycle and server query.
 * Used by: `useWorkspaceInternal`, which supplies these client-state inputs to
 * query and mutation hooks before building provider slices.
 * Flow: read the auth and selection stores, clear selection at workspace
 * boundaries, and expose stable auth/operation inputs to workspace queries and
 * mutations.
 */
export const useWorkspaceCore = () => {
  const { getAuthHeaders, isAuthenticated } = useAuth();
  const {
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
  } = useSelectionSlice();
  const ui = useUISlice();

  // Reset selection when the workspace changes. First render is
  // skipped (previous ref starts as null) so we don't clobber the caller's
  // freshly-chosen workspace.
  const previousWorkspaceIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousWorkspaceIdRef.current;
    if (previous === currentWorkspaceId) return;
    if (previous !== null) clearSelection();
    previousWorkspaceIdRef.current = currentWorkspaceId;
  }, [clearSelection, currentWorkspaceId]);

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
  ui.operationErrors.forEach((value, key) => {
    operationErrorsRecord[key] = value;
  });

  return {
    authHeaders,
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

    loadingOperationCount: ui.loadingOperations.size,
    operationErrorsRecord,
    startOperation: ui.startOperation,
    endOperation: ui.endOperation,
    setOperationError: ui.setOperationError,
  } as const;
};
