import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

/**
 * Centralized application state store
 * Manages all client-side state in one place to prevent inconsistencies
 */

interface AppState {
  // UI State
  ui: {
    currentView: 'data-loader' | 'filter' | 'concordance' | 'analysis' | 'export';
    sidebarCollapsed: boolean;
    loading: {
      global: boolean;
      operations: string[]; // Track specific operations that are loading
    };
    errors: {
      global: string | null;
      operations: Record<string, string>; // Track errors by operation type
    };
  };

  // Selection State
  selection: {
    nodeId: string | null;
    nodeIds: string[];
  };

  // Modal States  
  modals: {
    join: {
      isOpen: boolean;
      leftNodeId: string | null;
      rightNodeId: string | null;
    };
    filter: {
      isOpen: boolean;
      nodeId: string | null;
    };
    documentColumn: {
      isOpen: boolean;
      nodeId: string | null;
      columns: string[];
    };
  };

  // Graph State
  graph: {
    zoom: number;
    center: { x: number; y: number };
    selectedElements: string[];
  };

  // Pagination State (keyed by nodeId)
  pagination: Record<string, {
    currentPage: number;
    totalPages: number;
    pageSize: number;
  }>;
}

interface AppActions {
  // UI Actions
  setCurrentView: (view: AppState['ui']['currentView']) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  
  // Loading Actions
  setGlobalLoading: (loading: boolean) => void;
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
  
  // Error Actions
  setGlobalError: (error: string | null) => void;
  setOperationError: (operationId: string, error: string | null) => void;
  clearErrors: () => void;

  // Selection Actions
  setSelectedNode: (nodeId: string | null) => void;
  setSelectedNodes: (nodeIds: string[]) => void;
  toggleNodeSelection: (nodeId: string) => void;
  clearSelection: () => void;

  // Modal Actions
  openJoinModal: (leftNodeId: string | null, rightNodeId: string | null) => void;
  closeJoinModal: () => void;
  openFilterModal: (nodeId: string) => void;
  closeFilterModal: () => void;
  openDocumentColumnModal: (nodeId: string, columns: string[]) => void;
  closeDocumentColumnModal: () => void;

  // Graph Actions
  setGraphZoom: (zoom: number) => void;
  setGraphCenter: (center: { x: number; y: number }) => void;
  setGraphSelectedElements: (elementIds: string[]) => void;

  // Pagination Actions
  setPagination: (nodeId: string, pagination: { currentPage: number; totalPages: number; pageSize: number }) => void;
  resetPagination: (nodeId: string) => void;

  // Utility Actions
  reset: () => void; // Reset entire state
}

const initialState: AppState = {
  ui: {
    currentView: 'data-loader',
    sidebarCollapsed: false,
    loading: {
      global: false,
      operations: [],
    },
    errors: {
      global: null,
      operations: {},
    },
  },
  selection: {
    nodeId: null,
    nodeIds: [],
  },
  modals: {
    join: {
      isOpen: false,
      leftNodeId: null,
      rightNodeId: null,
    },
    filter: {
      isOpen: false,
      nodeId: null,
    },
    documentColumn: {
      isOpen: false,
      nodeId: null,
      columns: [],
    },
  },
  graph: {
    zoom: 1,
    center: { x: 0, y: 0 },
    selectedElements: [],
  },
  pagination: {},
};

export const useAppStore = create<AppState & AppActions>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      // UI Actions
      setCurrentView: (view) => set((state) => {
        state.ui.currentView = view;
      }),

      setSidebarCollapsed: (collapsed) => set((state) => {
        state.ui.sidebarCollapsed = collapsed;
      }),

      // Loading Actions
      setGlobalLoading: (loading) => set((state) => {
        state.ui.loading.global = loading;
      }),

      startOperation: (operationId) => set((state) => {
        if (!state.ui.loading.operations.includes(operationId)) {
          state.ui.loading.operations.push(operationId);
        }
      }),

      endOperation: (operationId) => set((state) => {
        state.ui.loading.operations = state.ui.loading.operations.filter(id => id !== operationId);
      }),

      // Error Actions
      setGlobalError: (error) => set((state) => {
        state.ui.errors.global = error;
      }),

      setOperationError: (operationId, error) => set((state) => {
        if (error) {
          state.ui.errors.operations[operationId] = error;
        } else {
          delete state.ui.errors.operations[operationId];
        }
      }),

      clearErrors: () => set((state) => {
        state.ui.errors.global = null;
        state.ui.errors.operations = {};
      }),

      // Selection Actions
      setSelectedNode: (nodeId) => set((state) => {
        state.selection.nodeId = nodeId;
        state.selection.nodeIds = nodeId ? [nodeId] : [];
      }),

      setSelectedNodes: (nodeIds) => set((state) => {
        state.selection.nodeIds = [...nodeIds];
        state.selection.nodeId = nodeIds.length === 1 ? nodeIds[0] : null;
      }),

      toggleNodeSelection: (nodeId) => set((state) => {
        const isSelected = state.selection.nodeIds.includes(nodeId);
        if (isSelected) {
          // Remove from selection, preserving order
          state.selection.nodeIds = state.selection.nodeIds.filter(id => id !== nodeId);
        } else {
          // Add to end of selection array to maintain selection order
          state.selection.nodeIds.push(nodeId);
        }
        state.selection.nodeId = state.selection.nodeIds.length === 1 ? state.selection.nodeIds[0] : null;
      }),

      clearSelection: () => set((state) => {
        state.selection.nodeId = null;
        state.selection.nodeIds = [];
      }),

      // Modal Actions
      openJoinModal: (leftNodeId, rightNodeId) => set((state) => {
        state.modals.join = {
          isOpen: true,
          leftNodeId,
          rightNodeId,
        };
      }),

      closeJoinModal: () => set((state) => {
        state.modals.join = {
          isOpen: false,
          leftNodeId: null,
          rightNodeId: null,
        };
      }),

      openFilterModal: (nodeId) => set((state) => {
        state.modals.filter = {
          isOpen: true,
          nodeId,
        };
      }),

      closeFilterModal: () => set((state) => {
        state.modals.filter = {
          isOpen: false,
          nodeId: null,
        };
      }),

      openDocumentColumnModal: (nodeId, columns) => set((state) => {
        state.modals.documentColumn = {
          isOpen: true,
          nodeId,
          columns,
        };
      }),

      closeDocumentColumnModal: () => set((state) => {
        state.modals.documentColumn = {
          isOpen: false,
          nodeId: null,
          columns: [],
        };
      }),

      // Graph Actions
      setGraphZoom: (zoom) => set((state) => {
        state.graph.zoom = zoom;
      }),

      setGraphCenter: (center) => set((state) => {
        state.graph.center = center;
      }),

      setGraphSelectedElements: (elementIds) => set((state) => {
        state.graph.selectedElements = [...elementIds];
      }),

      // Pagination Actions
      setPagination: (nodeId, pagination) => set((state) => {
        state.pagination[nodeId] = { ...pagination };
      }),

      resetPagination: (nodeId) => set((state) => {
        delete state.pagination[nodeId];
      }),

      // Utility Actions
      reset: () => set(() => ({ ...initialState })),
    })),
    {
      name: 'app-store',
    }
  )
);
