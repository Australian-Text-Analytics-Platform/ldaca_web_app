import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';

enableMapSet();

/**
 * UI Store - Handles all user interface state
 * Separated from business logic for better maintainability
 */

export type ViewType =
  | 'data-loader'
  | 'filter'
  | 'token-frequency'
  | 'concordance'
  | 'analysis'
  | 'topic-modeling'
  | 'quotation'
  | 'export';

interface UIState {
  // Current view and navigation
  currentView: ViewType;
  sidebarCollapsed: boolean;
  
  // Loading states - simplified and flattened
  isGlobalLoading: boolean;
  loadingOperations: Set<string>;
  
  // Error states - simplified and flattened  
  globalError: string | null;
  operationErrors: Map<string, string>;
  
  // Modal visibility states
  modals: {
    joinModal: boolean;
    filterModal: boolean;
    documentColumnModal: boolean;
    renameModal: boolean;
    deleteConfirmModal: boolean;
    feedbackModal: boolean;
    tutorialModal: boolean;
  };

  tutorialTarget?: {
    file: string;
    anchor: string;
    label?: string;
  } | null;
}

interface UIActions {
  // View management
  setCurrentView: (view: ViewType) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  
  // Loading management - simplified API
  setGlobalLoading: (loading: boolean) => void;
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
  isOperationLoading: (operationId: string) => boolean;
  
  // Error management - simplified API
  setGlobalError: (error: string | null) => void;
  setOperationError: (operationId: string, error: string) => void;
  clearOperationError: (operationId: string) => void;
  clearAllErrors: () => void;
  
  // Modal management - individual actions for clarity
  openJoinModal: () => void;
  closeJoinModal: () => void;
  openFilterModal: () => void;
  closeFilterModal: () => void;
  openDocumentColumnModal: () => void;
  closeDocumentColumnModal: () => void;
  openRenameModal: () => void;
  closeRenameModal: () => void;
  openDeleteConfirmModal: () => void;
  closeDeleteConfirmModal: () => void;
  openFeedbackModal: () => void;
  closeFeedbackModal: () => void;
  openTutorialModal: () => void;
  closeTutorialModal: () => void;
  openTutorialTarget: (target: { file: string; anchor: string; label?: string }) => void;
  closeAllModals: () => void;
}

type UIStore = UIState & UIActions;

export const useUIStore = create<UIStore>()(
  devtools(
    persist(
      immer((set, get) => ({
      // Initial state
      currentView: 'data-loader',
      sidebarCollapsed: false,
      isGlobalLoading: false,
      loadingOperations: new Set(),
      globalError: null,
      operationErrors: new Map(),
      modals: {
        joinModal: false,
        filterModal: false,
        documentColumnModal: false,
        renameModal: false,
        deleteConfirmModal: false,
        feedbackModal: false,
        tutorialModal: false,
      },
      tutorialTarget: null,

      // View management
      setCurrentView: (view) => set((state) => {
        if (state.currentView === view) {
          return;
        }
        state.currentView = view;
      }),
      
      toggleSidebar: () => set((state) => {
        state.sidebarCollapsed = !state.sidebarCollapsed;
      }),
      
      setSidebarCollapsed: (collapsed) => set((state) => {
        state.sidebarCollapsed = collapsed;
      }),

      // Loading management
      setGlobalLoading: (loading) => set((state) => {
        state.isGlobalLoading = loading;
      }),
      
      startOperation: (operationId) => set((state) => {
        state.loadingOperations.add(operationId);
      }),
      
      endOperation: (operationId) => set((state) => {
        state.loadingOperations.delete(operationId);
        // Clear any associated errors when operation completes
        state.operationErrors.delete(operationId);
      }),
      
      isOperationLoading: (operationId) => get().loadingOperations.has(operationId),

      // Error management
      setGlobalError: (error) => set((state) => {
        state.globalError = error;
      }),
      
      setOperationError: (operationId, error) => set((state) => {
        state.operationErrors.set(operationId, error);
        // End the operation loading state when error occurs
        state.loadingOperations.delete(operationId);
      }),
      
      clearOperationError: (operationId) => set((state) => {
        state.operationErrors.delete(operationId);
      }),
      
      clearAllErrors: () => set((state) => {
        state.globalError = null;
        state.operationErrors.clear();
      }),

      // Modal management
      openJoinModal: () => set((state) => {
        state.modals.joinModal = true;
      }),
      
      closeJoinModal: () => set((state) => {
        state.modals.joinModal = false;
      }),
      
      openFilterModal: () => set((state) => {
        state.modals.filterModal = true;
      }),
      
      closeFilterModal: () => set((state) => {
        state.modals.filterModal = false;
      }),
      
      openDocumentColumnModal: () => set((state) => {
        state.modals.documentColumnModal = true;
      }),
      
      closeDocumentColumnModal: () => set((state) => {
        state.modals.documentColumnModal = false;
      }),
      
      openRenameModal: () => set((state) => {
        state.modals.renameModal = true;
      }),
      
      closeRenameModal: () => set((state) => {
        state.modals.renameModal = false;
      }),
      
      openDeleteConfirmModal: () => set((state) => {
        state.modals.deleteConfirmModal = true;
      }),
      
      closeDeleteConfirmModal: () => set((state) => {
        state.modals.deleteConfirmModal = false;
      }),

      openFeedbackModal: () => set((state) => {
        state.modals.feedbackModal = true;
      }),

      closeFeedbackModal: () => set((state) => {
        state.modals.feedbackModal = false;
      }),

      openTutorialModal: () => set((state) => {
        state.modals.tutorialModal = true;
      }),

      openTutorialTarget: (target) => set((state) => {
        state.tutorialTarget = target;
        state.modals.tutorialModal = true;
      }),

      closeTutorialModal: () => set((state) => {
        state.modals.tutorialModal = false;
        state.tutorialTarget = null;
      }),
      
      closeAllModals: () => set((state) => {
        Object.keys(state.modals).forEach(key => {
          (state.modals as any)[key] = false;
        });
      }),
    })),
      {
        name: 'ldaca-ui-store',
        partialize: (state) => ({
          currentView: state.currentView,
        }),
      }
    ),
    { name: 'ui-store' }
  )
);
