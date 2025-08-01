import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

/**
 * Workspace Store - Handles workspace-specific state
 * Separated from UI concerns for better data flow management
 */

interface WorkspaceState {
  // Current workspace info
  currentWorkspaceId: string | null;
  
  // Graph visualization state
  graph: {
    zoom: number;
    center: { x: number; y: number };
    fitViewOnLoad: boolean;
  };
  
  // Data table pagination (keyed by nodeId)
  pagination: Record<string, {
    currentPage: number;
    totalPages: number;
    pageSize: number;
    totalItems: number;
  }>;
  
  // Node operation state tracking
  nodeOperations: {
    pendingDeletes: Set<string>;
    pendingRenames: Set<string>;
    pendingFilters: Set<string>;
    pendingJoins: Set<string>;
  };
  
  // File upload state
  fileUpload: {
    uploadProgress: number;
    isUploading: boolean;
    uploadedFiles: string[];
  };
}

interface WorkspaceActions {
  // Current workspace management
  setCurrentWorkspaceId: (workspaceId: string | null) => void;
  
  // Graph management
  setGraphZoom: (zoom: number) => void;
  setGraphCenter: (center: { x: number; y: number }) => void;
  setFitViewOnLoad: (fitView: boolean) => void;
  resetGraphView: () => void;
  
  // Pagination management
  setPagination: (nodeId: string, pagination: {
    currentPage: number;
    totalPages: number;
    pageSize: number;
    totalItems: number;
  }) => void;
  updateCurrentPage: (nodeId: string, page: number) => void;
  updatePageSize: (nodeId: string, pageSize: number) => void;
  resetPagination: (nodeId: string) => void;
  clearAllPagination: () => void;
  
  // Node operation tracking (for preventing race conditions)
  startNodeDelete: (nodeId: string) => void;
  endNodeDelete: (nodeId: string) => void;
  isNodeDeletePending: (nodeId: string) => boolean;
  
  startNodeRename: (nodeId: string) => void;
  endNodeRename: (nodeId: string) => void;
  isNodeRenamePending: (nodeId: string) => boolean;
  
  startNodeFilter: (nodeId: string) => void;
  endNodeFilter: (nodeId: string) => void;
  isNodeFilterPending: (nodeId: string) => boolean;
  
  startNodeJoin: (joinId: string) => void;
  endNodeJoin: (joinId: string) => void;
  isNodeJoinPending: (joinId: string) => boolean;
  
  clearAllPendingOperations: () => void;
  
  // File upload management
  setUploadProgress: (progress: number) => void;
  setIsUploading: (uploading: boolean) => void;
  addUploadedFile: (filename: string) => void;
  clearUploadedFiles: () => void;
  resetUploadState: () => void;
}

type WorkspaceStore = WorkspaceState & WorkspaceActions;

const defaultPagination = {
  currentPage: 1,
  totalPages: 1,
  pageSize: 20,
  totalItems: 0,
};

const defaultGraphState = {
  zoom: 1,
  center: { x: 0, y: 0 },
  fitViewOnLoad: true,
};

export const useWorkspaceStore = create<WorkspaceStore>()(
  devtools(
    immer((set, get) => ({
      // Initial state
      currentWorkspaceId: null,
      graph: defaultGraphState,
      pagination: {},
      nodeOperations: {
        pendingDeletes: new Set(),
        pendingRenames: new Set(),
        pendingFilters: new Set(),
        pendingJoins: new Set(),
      },
      fileUpload: {
        uploadProgress: 0,
        isUploading: false,
        uploadedFiles: [],
      },

      // Current workspace management
      setCurrentWorkspaceId: (workspaceId) => set((state) => {
        state.currentWorkspaceId = workspaceId;
        // Reset workspace-specific state when workspace changes
        state.graph = defaultGraphState;
        state.pagination = {};
        state.nodeOperations = {
          pendingDeletes: new Set(),
          pendingRenames: new Set(),
          pendingFilters: new Set(),
          pendingJoins: new Set(),
        };
      }),

      // Graph management
      setGraphZoom: (zoom) => set((state) => {
        state.graph.zoom = zoom;
      }),
      
      setGraphCenter: (center) => set((state) => {
        state.graph.center = center;
      }),
      
      setFitViewOnLoad: (fitView) => set((state) => {
        state.graph.fitViewOnLoad = fitView;
      }),
      
      resetGraphView: () => set((state) => {
        state.graph = defaultGraphState;
      }),

      // Pagination management
      setPagination: (nodeId, pagination) => set((state) => {
        state.pagination[nodeId] = pagination;
      }),
      
      updateCurrentPage: (nodeId, page) => set((state) => {
        if (state.pagination[nodeId]) {
          state.pagination[nodeId].currentPage = page;
        } else {
          state.pagination[nodeId] = { ...defaultPagination, currentPage: page };
        }
      }),
      
      updatePageSize: (nodeId, pageSize) => set((state) => {
        if (state.pagination[nodeId]) {
          state.pagination[nodeId].pageSize = pageSize;
          state.pagination[nodeId].currentPage = 1; // Reset to first page
        } else {
          state.pagination[nodeId] = { ...defaultPagination, pageSize };
        }
      }),
      
      resetPagination: (nodeId) => set((state) => {
        state.pagination[nodeId] = defaultPagination;
      }),
      
      clearAllPagination: () => set((state) => {
        state.pagination = {};
      }),

      // Node operation tracking
      startNodeDelete: (nodeId) => set((state) => {
        state.nodeOperations.pendingDeletes.add(nodeId);
      }),
      
      endNodeDelete: (nodeId) => set((state) => {
        state.nodeOperations.pendingDeletes.delete(nodeId);
      }),
      
      isNodeDeletePending: (nodeId) => get().nodeOperations.pendingDeletes.has(nodeId),
      
      startNodeRename: (nodeId) => set((state) => {
        state.nodeOperations.pendingRenames.add(nodeId);
      }),
      
      endNodeRename: (nodeId) => set((state) => {
        state.nodeOperations.pendingRenames.delete(nodeId);
      }),
      
      isNodeRenamePending: (nodeId) => get().nodeOperations.pendingRenames.has(nodeId),
      
      startNodeFilter: (nodeId) => set((state) => {
        state.nodeOperations.pendingFilters.add(nodeId);
      }),
      
      endNodeFilter: (nodeId) => set((state) => {
        state.nodeOperations.pendingFilters.delete(nodeId);
      }),
      
      isNodeFilterPending: (nodeId) => get().nodeOperations.pendingFilters.has(nodeId),
      
      startNodeJoin: (joinId) => set((state) => {
        state.nodeOperations.pendingJoins.add(joinId);
      }),
      
      endNodeJoin: (joinId) => set((state) => {
        state.nodeOperations.pendingJoins.delete(joinId);
      }),
      
      isNodeJoinPending: (joinId) => get().nodeOperations.pendingJoins.has(joinId),
      
      clearAllPendingOperations: () => set((state) => {
        state.nodeOperations = {
          pendingDeletes: new Set(),
          pendingRenames: new Set(),
          pendingFilters: new Set(),
          pendingJoins: new Set(),
        };
      }),

      // File upload management
      setUploadProgress: (progress) => set((state) => {
        state.fileUpload.uploadProgress = Math.max(0, Math.min(100, progress));
      }),
      
      setIsUploading: (uploading) => set((state) => {
        state.fileUpload.isUploading = uploading;
        if (!uploading) {
          state.fileUpload.uploadProgress = 0;
        }
      }),
      
      addUploadedFile: (filename) => set((state) => {
        if (!state.fileUpload.uploadedFiles.includes(filename)) {
          state.fileUpload.uploadedFiles.push(filename);
        }
      }),
      
      clearUploadedFiles: () => set((state) => {
        state.fileUpload.uploadedFiles = [];
      }),
      
      resetUploadState: () => set((state) => {
        state.fileUpload = {
          uploadProgress: 0,
          isUploading: false,
          uploadedFiles: [],
        };
      }),
    })),
    { name: 'workspace-store' }
  )
);
