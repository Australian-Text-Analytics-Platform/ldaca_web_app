/**
 * Centralized store exports for the refactored frontend architecture
 * Provides clean, organized imports for all store functionality
 */

// Import for internal use
import { useUIStore } from './uiStore';
import { useSelectionStore } from './selectionStore';
import { useWorkspaceStore } from './workspaceStore';

// Export individual stores
export { useUIStore } from './uiStore';
export { useSelectionStore } from './selectionStore';  
export { useWorkspaceStore } from './workspaceStore';

// Export types
export type { ViewType } from './uiStore';

// Combined store hook for components that need multiple stores
export const useAppStores = () => {
  const ui = useUIStore();
  const selection = useSelectionStore();
  const workspace = useWorkspaceStore();
  
  return { ui, selection, workspace };
};

// Convenience hooks for commonly used combinations
export const useLoadingStates = () => {
  const { isGlobalLoading, isOperationLoading } = useUIStore();
  const { isNodeDeletePending, isNodeRenamePending } = useWorkspaceStore();
  
  return {
    isGlobalLoading,
    isOperationLoading,
    isNodeDeletePending,  
    isNodeRenamePending,
  };
};

export const useErrorStates = () => {
  const { globalError, operationErrors, setGlobalError, setOperationError, clearAllErrors } = useUIStore();
  
  return {
    globalError,
    operationErrors,
    setGlobalError,
    setOperationError,
    clearAllErrors,
  };
};

export const useModalStates = () => {
  const {
    modals,
    openJoinModal,
    closeJoinModal,
    openFilterModal,
    closeFilterModal,
    closeAllModals,
  } = useUIStore();
  
  return {
    modals,
    openJoinModal,
    closeJoinModal,
    openFilterModal,
    closeFilterModal,
    closeAllModals,
  };
};

export const useNodeSelection = () => {
  const {
    selectedNodeId,
    selectedNodeIds,
    selectNode,
    clearNodeSelection,
    hasNodeSelection,
    getSelectedCount,
  } = useSelectionStore();
  
  return {
    selectedNodeId,
    selectedNodeIds,
    selectNode,
    clearNodeSelection,
    hasSelection: hasNodeSelection(),
    selectedCount: getSelectedCount(),
  };
};
