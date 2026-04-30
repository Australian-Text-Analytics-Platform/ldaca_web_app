import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { usePreferencesStore } from './preferencesStore';

// Required once globally so Zustand's immer middleware can mutate the Set/Map
// state below without throwing.
enableMapSet();

/**
 * Global UI state: active view, sidebar layout, per-operation loading/error
 * tracking, and the small set of modals that live outside their feature
 * components.
 *
 * Business state (workspaces, nodes, selections, analysis tasks) belongs in
 * the server cache or dedicated stores — this store is purely presentation.
 */

export type ViewType =
  | 'data-loader'
  | 'filter'
  | 'token-frequency'
  | 'concordance'
  | 'analysis'
  | 'topic-modeling'
  | 'quotation'
  | 'ai-annotator'
  | 'export';

export const ALL_VIEWS: ViewType[] = [
  'data-loader',
  'filter',
  'token-frequency',
  'concordance',
  'analysis',
  'topic-modeling',
  'quotation',
  'ai-annotator',
  'export',
];

/** Views shown out of the box; AI Annotator is opt-in via preferences. */
export const DEFAULT_VISIBLE_VIEWS: ViewType[] = ALL_VIEWS.filter(
  (view) => view !== 'ai-annotator',
);

interface UIState {
  currentView: ViewType;
  visibleViews: ViewType[];
  sidebarCollapsed: boolean;

  /** Set of in-flight operation ids. Read via `.size` / `.has` elsewhere. */
  loadingOperations: Set<string>;
  /** Map of operation id → last error message. */
  operationErrors: Map<string, string>;

  modals: {
    feedbackModal: boolean;
    tutorialModal: boolean;
    warningModal: boolean;
    infoModal: boolean;
    referenceModal: boolean;
  };

  tutorialTarget?: {
    file: string;
    anchor: string;
    label?: string;
  } | null;

  warningTarget?: {
    file: string;
    anchor: string;
    label?: string;
  } | null;

  infoTarget?: {
    file: string;
    anchor: string;
    label?: string;
  } | null;

  referenceTarget?: {
    file: string;
    anchor: string;
    label?: string;
  } | null;

  /**
   * Path of the most recently uploaded file. Used by the contextual hints
   * system to highlight the matching file row's "Add" button after upload.
   * Cleared once the file has been added to the workspace or the user dismisses.
   */
  lastUploadedFilePath: string | null;

  /**
   * Hints the user dismissed for this session only (won't persist across
   * reloads). Permanent dismissals live in `hintsStore`.
   */
  sessionDismissedHints: Set<string>;
}

interface UIActions {
  // Views / layout
  setCurrentView: (view: ViewType) => void;
  setViewVisibility: (view: ViewType, visible: boolean) => void;
  syncVisibleViewsFromPreferences: () => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Operation tracking (used by workspace mutations to surface errors).
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
  setOperationError: (operationId: string, error: string) => void;

  // Modals
  openFeedbackModal: () => void;
  closeFeedbackModal: () => void;
  openTutorialModal: () => void;
  closeTutorialModal: () => void;
  openTutorialTarget: (target: { file: string; anchor: string; label?: string }) => void;
  openWarningModal: () => void;
  closeWarningModal: () => void;
  openWarningTarget: (target: { file: string; anchor: string; label?: string }) => void;
  openInfoModal: () => void;
  closeInfoModal: () => void;
  openInfoTarget: (target: { file: string; anchor: string; label?: string }) => void;
  openReferenceModal: () => void;
  closeReferenceModal: () => void;
  openReferenceTarget: (target: { file: string; anchor: string; label?: string }) => void;
  closeAllModals: () => void;

  // Hints
  setLastUploadedFilePath: (path: string | null) => void;
  sessionDismissHint: (id: string) => void;
}

type UIStore = UIState & UIActions;

export const useUIStore = create<UIStore>()(
  devtools(
    persist(
      immer((set) => ({
      // Initial state
      currentView: 'data-loader',
      visibleViews: [...DEFAULT_VISIBLE_VIEWS],
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
        warningModal: false,
        infoModal: false,
        referenceModal: false,
      },
      tutorialTarget: null,
      warningTarget: null,
      infoTarget: null,
      referenceTarget: null,
      lastUploadedFilePath: null,
      sessionDismissedHints: new Set<string>(),

        setCurrentView: (view) => set((state) => {
          if (state.currentView !== view) state.currentView = view;
        }),

        setViewVisibility: (view, visible) => set((state) => {
          const currentlyVisible = state.visibleViews.includes(view);
          if (currentlyVisible === visible) return;

          if (visible) {
            // Preserve canonical order from ALL_VIEWS when re-inserting.
            state.visibleViews = ALL_VIEWS.filter(
              (candidate) => candidate === view || state.visibleViews.includes(candidate),
            );
          } else {
            // Never hide the last visible view — leaves the user nowhere to go.
            if (state.visibleViews.length <= 1) return;
            state.visibleViews = state.visibleViews.filter((c) => c !== view);
            if (state.currentView === view) {
              state.currentView = state.visibleViews[0] ?? 'data-loader';
            }
          }

          usePreferencesStore.getState().setViewHidden(view, !visible);
        }),

        syncVisibleViewsFromPreferences: () => set((state) => {
          const hiddenViews = usePreferencesStore.getState().hiddenViews;
          state.visibleViews = ALL_VIEWS.filter((v) => !hiddenViews.includes(v));
          if (!state.visibleViews.includes(state.currentView)) {
            state.currentView = state.visibleViews[0] ?? 'data-loader';
          }
        }),

        toggleSidebar: () => set((state) => {
          state.sidebarCollapsed = !state.sidebarCollapsed;
        }),

        setSidebarCollapsed: (collapsed) => set((state) => {
          state.sidebarCollapsed = collapsed;
        }),

        startOperation: (operationId) => set((state) => {
          state.loadingOperations.add(operationId);
        }),

        endOperation: (operationId) => set((state) => {
          state.loadingOperations.delete(operationId);
          // Clearing stale errors on success keeps UI surfaces consistent.
          state.operationErrors.delete(operationId);
        }),

        setOperationError: (operationId, error) => set((state) => {
          state.operationErrors.set(operationId, error);
          // An error ends the operation from the UI's perspective.
          state.loadingOperations.delete(operationId);
        }),

        openFeedbackModal: () => set((state) => { state.modals.feedbackModal = true; }),
        closeFeedbackModal: () => set((state) => { state.modals.feedbackModal = false; }),

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

      openWarningModal: () => set((state) => {
        state.modals.warningModal = true;
      }),

      openWarningTarget: (target) => set((state) => {
        state.warningTarget = target;
        state.modals.warningModal = true;
      }),

      closeWarningModal: () => set((state) => {
        state.modals.warningModal = false;
        state.warningTarget = null;
      }),

      openInfoModal: () => set((state) => {
        state.modals.infoModal = true;
      }),

      openInfoTarget: (target) => set((state) => {
        state.infoTarget = target;
        state.modals.infoModal = true;
      }),

      closeInfoModal: () => set((state) => {
        state.modals.infoModal = false;
        state.infoTarget = null;
      }),

      openReferenceModal: () => set((state) => {
        state.modals.referenceModal = true;
      }),

      openReferenceTarget: (target) => set((state) => {
        state.referenceTarget = target;
        state.modals.referenceModal = true;
      }),

      closeReferenceModal: () => set((state) => {
        state.modals.referenceModal = false;
        state.referenceTarget = null;
      }),
      
      closeAllModals: () => set((state) => {
        (Object.keys(state.modals) as Array<keyof typeof state.modals>).forEach(key => {
          state.modals[key] = false;
        });
      }),

      setLastUploadedFilePath: (path) => set((state) => {
        state.lastUploadedFilePath = path;
      }),

      sessionDismissHint: (id) => set((state) => {
        state.sessionDismissedHints.add(id);
      }),
    })),
      {
        name: 'ldaca-ui-store',
        partialize: (state) => ({
          currentView: state.currentView,
        }),
      },
    ),
    { name: 'ui-store' },
  ),
);
