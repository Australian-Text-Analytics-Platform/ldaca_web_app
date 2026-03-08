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
  
  // Node data pagination (keyed by nodeId)
  nodePagination: Record<string, {
    currentPage: number;
    totalPages: number;
    pageSize: number;
    totalItems: number;
  }>;
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
  
  // Node pagination management
  setNodePagination: (nodeId: string, pagination: {
    currentPage: number;
    totalPages: number;
    pageSize: number;
    totalItems: number;
  }) => void;
  updateNodePage: (nodeId: string, page: number) => void;
  updateNodePageSize: (nodeId: string, pageSize: number) => void;
  resetNodePagination: (nodeId: string) => void;
  clearAllPagination: () => void;
  getNodePagination: (nodeId: string) => {
    currentPage: number;
    totalPages: number;
    pageSize: number;
    totalItems: number;
  };
  
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
      nodePagination: {},

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
        // Keep active selection aligned with rightmost tab (latest item)
        state.selectedNodeId = nodeIds.length > 0 ? nodeIds[nodeIds.length - 1] : null;
      }),
      
      addNodeToSelection: (nodeId) => set((state) => {
        if (!state.selectedNodeIds.includes(nodeId)) {
          state.selectedNodeIds.push(nodeId);
          // New selections are appended at rightmost tab and become active
          state.selectedNodeId = nodeId;
        }
      }),
      
      removeNodeFromSelection: (nodeId) => set((state) => {
        state.selectedNodeIds = state.selectedNodeIds.filter(id => id !== nodeId);
        // If removing the current single selection, update it
        if (state.selectedNodeId === nodeId) {
          state.selectedNodeId = state.selectedNodeIds.length > 0
            ? state.selectedNodeIds[state.selectedNodeIds.length - 1]
            : null;
        }
      }),
      
      toggleNodeSelection: (nodeId) => set((state) => {
        const isSelected = state.selectedNodeIds.includes(nodeId);
        if (isSelected) {
          state.selectedNodeIds = state.selectedNodeIds.filter(id => id !== nodeId);
          if (state.selectedNodeId === nodeId) {
            state.selectedNodeId = state.selectedNodeIds.length > 0
              ? state.selectedNodeIds[state.selectedNodeIds.length - 1]
              : null;
          }
        } else {
          state.selectedNodeIds.push(nodeId);
          // Newly selected node should become active immediately
          state.selectedNodeId = nodeId;
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

      // Node pagination management
      setNodePagination: (nodeId, pagination) => set((state) => {
        state.nodePagination[nodeId] = pagination;
      }),
      
      updateNodePage: (nodeId, page) => set((state) => {
        if (!state.nodePagination[nodeId]) {
          state.nodePagination[nodeId] = { currentPage: 1, totalPages: 1, pageSize: 10, totalItems: 0 };
        }
        state.nodePagination[nodeId].currentPage = page;
      }),
      
      updateNodePageSize: (nodeId, pageSize) => set((state) => {
        if (!state.nodePagination[nodeId]) {
          state.nodePagination[nodeId] = { currentPage: 1, totalPages: 1, pageSize: 10, totalItems: 0 };
        }
        state.nodePagination[nodeId].pageSize = pageSize;
        state.nodePagination[nodeId].currentPage = 1; // Reset to first page when changing page size
      }),
      
      resetNodePagination: (nodeId) => set((state) => {
        Reflect.deleteProperty(state.nodePagination, nodeId);
      }),
      
      getNodePagination: (nodeId) => {
        const pagination = get().nodePagination[nodeId];
        return pagination || { currentPage: 1, totalPages: 1, pageSize: 10, totalItems: 0 };
      },
      
      clearAllPagination: () => set((state) => {
        state.nodePagination = {};
      }),

      // Computed getters
      hasNodeSelection: () => get().selectedNodeId !== null,
      hasMultipleSelection: () => get().selectedNodeIds.length > 1,
      getSelectedCount: () => get().selectedNodeIds.length,
    })),
    { name: 'selection-store' }
  )
);
