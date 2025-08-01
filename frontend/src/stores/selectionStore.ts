import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

/**
 * Selection Store - Handles node and element selection state
 * Separated for cleaner state management and better performance
 */

interface SelectionState {
  // Node selection
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  
  // Graph element selection (for React Flow)
  selectedGraphElements: string[];
  
  // Context for operations (remembers what was selected for modal operations)
  operationContext: {
    joinContext: {
      leftNodeId: string | null;
      rightNodeId: string | null;
    };
    filterContext: {
      nodeId: string | null;
    };
    renameContext: {
      nodeId: string | null;
      currentName: string | null;
    };
    deleteContext: {
      nodeId: string | null;
      nodeName: string | null;
    };
    documentColumnContext: {
      nodeId: string | null;
      availableColumns: string[];
    };
  };
}

interface SelectionActions {
  // Single node selection
  selectNode: (nodeId: string | null) => void;
  clearNodeSelection: () => void;
  
  // Multiple node selection
  setSelectedNodes: (nodeIds: string[]) => void;
  addNodeToSelection: (nodeId: string) => void;
  removeNodeFromSelection: (nodeId: string) => void;
  toggleNodeSelection: (nodeId: string) => void;
  clearMultipleSelection: () => void;
  
  // Graph element selection
  setSelectedGraphElements: (elementIds: string[]) => void;
  clearGraphSelection: () => void;
  
  // Clear all selections
  clearAllSelections: () => void;
  
  // Operation context management
  setJoinContext: (leftNodeId: string | null, rightNodeId: string | null) => void;
  setFilterContext: (nodeId: string | null) => void;
  setRenameContext: (nodeId: string | null, currentName: string | null) => void;
  setDeleteContext: (nodeId: string | null, nodeName: string | null) => void;
  setDocumentColumnContext: (nodeId: string | null, availableColumns: string[]) => void;
  clearOperationContext: () => void;
  
  // Computed getters
  hasNodeSelection: () => boolean;
  hasMultipleSelection: () => boolean;
  getSelectedCount: () => number;
}

type SelectionStore = SelectionState & SelectionActions;

export const useSelectionStore = create<SelectionStore>()(
  devtools(
    immer((set, get) => ({
      // Initial state
      selectedNodeId: null,
      selectedNodeIds: [],
      selectedGraphElements: [],
      operationContext: {
        joinContext: {
          leftNodeId: null,
          rightNodeId: null,
        },
        filterContext: {
          nodeId: null,
        },
        renameContext: {
          nodeId: null,
          currentName: null,
        },
        deleteContext: {
          nodeId: null,
          nodeName: null,
        },
        documentColumnContext: {
          nodeId: null,
          availableColumns: [],
        },
      },

      // Single node selection
      selectNode: (nodeId) => set((state) => {
        state.selectedNodeId = nodeId;
        // When selecting single node, update multiple selection too
        state.selectedNodeIds = nodeId ? [nodeId] : [];
      }),
      
      clearNodeSelection: () => set((state) => {
        state.selectedNodeId = null;
        state.selectedNodeIds = [];
      }),

      // Multiple node selection
      setSelectedNodes: (nodeIds) => set((state) => {
        state.selectedNodeIds = nodeIds;
        // Update single selection to first item
        state.selectedNodeId = nodeIds.length > 0 ? nodeIds[0] : null;
      }),
      
      addNodeToSelection: (nodeId) => set((state) => {
        if (!state.selectedNodeIds.includes(nodeId)) {
          state.selectedNodeIds.push(nodeId);
          // If no single selection, set it to this node
          if (!state.selectedNodeId) {
            state.selectedNodeId = nodeId;
          }
        }
      }),
      
      removeNodeFromSelection: (nodeId) => set((state) => {
        state.selectedNodeIds = state.selectedNodeIds.filter(id => id !== nodeId);
        // If removing the current single selection, update it
        if (state.selectedNodeId === nodeId) {
          state.selectedNodeId = state.selectedNodeIds.length > 0 ? state.selectedNodeIds[0] : null;
        }
      }),
      
      toggleNodeSelection: (nodeId) => set((state) => {
        const isSelected = state.selectedNodeIds.includes(nodeId);
        if (isSelected) {
          state.selectedNodeIds = state.selectedNodeIds.filter(id => id !== nodeId);
          if (state.selectedNodeId === nodeId) {
            state.selectedNodeId = state.selectedNodeIds.length > 0 ? state.selectedNodeIds[0] : null;
          }
        } else {
          state.selectedNodeIds.push(nodeId);
          if (!state.selectedNodeId) {
            state.selectedNodeId = nodeId;
          }
        }
      }),
      
      clearMultipleSelection: () => set((state) => {
        state.selectedNodeIds = [];
        state.selectedNodeId = null;
      }),

      // Graph element selection
      setSelectedGraphElements: (elementIds) => set((state) => {
        state.selectedGraphElements = elementIds;
      }),
      
      clearGraphSelection: () => set((state) => {
        state.selectedGraphElements = [];
      }),

      // Clear all selections
      clearAllSelections: () => set((state) => {
        state.selectedNodeId = null;
        state.selectedNodeIds = [];
        state.selectedGraphElements = [];
      }),

      // Operation context management
      setJoinContext: (leftNodeId, rightNodeId) => set((state) => {
        state.operationContext.joinContext = { leftNodeId, rightNodeId };
      }),
      
      setFilterContext: (nodeId) => set((state) => {
        state.operationContext.filterContext = { nodeId };
      }),
      
      setRenameContext: (nodeId, currentName) => set((state) => {
        state.operationContext.renameContext = { nodeId, currentName };
      }),
      
      setDeleteContext: (nodeId, nodeName) => set((state) => {
        state.operationContext.deleteContext = { nodeId, nodeName };
      }),
      
      setDocumentColumnContext: (nodeId, availableColumns) => set((state) => {
        state.operationContext.documentColumnContext = { nodeId, availableColumns };
      }),
      
      clearOperationContext: () => set((state) => {
        state.operationContext = {
          joinContext: { leftNodeId: null, rightNodeId: null },
          filterContext: { nodeId: null },
          renameContext: { nodeId: null, currentName: null },
          deleteContext: { nodeId: null, nodeName: null },
          documentColumnContext: { nodeId: null, availableColumns: [] },
        };
      }),

      // Computed getters
      hasNodeSelection: () => get().selectedNodeId !== null,
      hasMultipleSelection: () => get().selectedNodeIds.length > 1,
      getSelectedCount: () => get().selectedNodeIds.length,
    })),
    { name: 'selection-store' }
  )
);
