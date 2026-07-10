import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useSelectionStore } from '@/stores/selectionStore';
import { useUIStore } from '@/stores/uiStore';

/**
 * Reads the selection store fields the workspace feature owns.
 * Used by: workspace/useWorkspaceCore components or tests that consume this hook.
 * Why: the internal workspace hook needs one selection snapshot before query and mutation hooks are composed.
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
 * Reads operation loading helpers from the UI store.
 * Used by: workspace/useWorkspaceCore components or tests that consume this hook.
 * Why: the internal workspace hook needs operation lifecycle state without subscribing to unrelated UI fields.
 */
const useUISlice = () =>
  useUIStore(
    useShallow((state) => ({
      loadingOperations: state.loadingOperations,
      startOperation: state.startOperation,
      endOperation: state.endOperation,
    })),
  );

/**
 * Core workspace wiring for auth, current-workspace identity, semantic node
 * selection, and operation status. Data-view request state is intentionally
 * absent: `useWorkspaceDataTable` owns its per-node pagination/sort/filter
 * lifecycle and server query.
 * Used by: `useWorkspaceInternal`, which supplies these client-state inputs to
 * query and mutation hooks before building provider slices.
 * Flow: read authenticated readiness plus selection and operation state, clear
 * selection at workspace boundaries, and expose the query gate, semantic
 * selection actions, and operation helpers to the workspace orchestrator.
 */
export const useWorkspaceCore = () => {
  const { isAuthenticated } = useAuth();
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

  return {
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
    startOperation: ui.startOperation,
    endOperation: ui.endOperation,
  } as const;
};
