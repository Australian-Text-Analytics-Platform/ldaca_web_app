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
  resetSessionDismissedHints: () => void;
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
      loadingOperations: new Set(),
      operationErrors: new Map(),
      modals: {
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

        /** Switches the visible feature pane without relying on URL routing. */
        /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        setCurrentView: (view) => set((state) => {
          if (state.currentView !== view) state.currentView = view;
        }),

        /** Updates view visibility from sidebar settings and mirrors it to preferences. */
        /**
         * Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
         * Flow: compare requested visibility, preserve canonical view order or prevent hiding the last view, then mirror hidden state to preferences.
         */
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

        /** Reconciles visible views after preferences hydrate from backend/localStorage. */
        /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        syncVisibleViewsFromPreferences: () => set((state) => {
          const hiddenViews = usePreferencesStore.getState().hiddenViews;
          state.visibleViews = ALL_VIEWS.filter((v) => !hiddenViews.includes(v));
          if (!state.visibleViews.includes(state.currentView)) {
            state.currentView = state.visibleViews[0] ?? 'data-loader';
          }
        }),

        /** Toggles the left sidebar collapsed state for layout controls. */
        /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        toggleSidebar: () => set((state) => {
          state.sidebarCollapsed = !state.sidebarCollapsed;
        }),

        /** Sets sidebar collapsed state from controlled sidebar components. */
        /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        setSidebarCollapsed: (collapsed) => set((state) => {
          state.sidebarCollapsed = collapsed;
        }),

        /** Marks a named UI operation as in-flight for spinners/disabled states. */
        /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        startOperation: (operationId) => set((state) => {
          state.loadingOperations.add(operationId);
        }),

        /** Clears in-flight and stale error state after a named operation succeeds. */
        /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        endOperation: (operationId) => set((state) => {
          state.loadingOperations.delete(operationId);
          // Clearing stale errors on success keeps UI surfaces consistent.
          state.operationErrors.delete(operationId);
        }),

        /** Records the latest operation error and clears its loading marker. */
        /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        setOperationError: (operationId, error) => set((state) => {
          state.operationErrors.set(operationId, error);
          // An error ends the operation from the UI's perspective.
          state.loadingOperations.delete(operationId);
        }),

        /** Opens the global feedback panel from pre-auth and workspace shells. */
        /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        openFeedbackModal: () => set((state) => { state.modals.feedbackModal = true; }),
        /** Closes the global feedback panel. */
        /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        closeFeedbackModal: () => set((state) => { state.modals.feedbackModal = false; }),

      /** Opens the tutorial modal without changing its current target. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      openTutorialModal: () => set((state) => {
        state.modals.tutorialModal = true;
      }),

      /** Opens the tutorial modal at a specific bundled/remote docs target. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      openTutorialTarget: (target) => set((state) => {
        state.tutorialTarget = target;
        state.modals.tutorialModal = true;
      }),

      /** Closes the tutorial modal and clears its target. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      closeTutorialModal: () => set((state) => {
        state.modals.tutorialModal = false;
        state.tutorialTarget = null;
      }),

      /** Opens the warning modal without changing its current target. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      openWarningModal: () => set((state) => {
        state.modals.warningModal = true;
      }),

      /** Opens the warning modal at a specific docs warning target. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      openWarningTarget: (target) => set((state) => {
        state.warningTarget = target;
        state.modals.warningModal = true;
      }),

      /** Closes the warning modal and clears its target. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      closeWarningModal: () => set((state) => {
        state.modals.warningModal = false;
        state.warningTarget = null;
      }),

      /** Opens the information modal without changing its current target. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      openInfoModal: () => set((state) => {
        state.modals.infoModal = true;
      }),

      /** Opens the information modal at a specific docs target. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      openInfoTarget: (target) => set((state) => {
        state.infoTarget = target;
        state.modals.infoModal = true;
      }),

      /** Closes the information modal and clears its target. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      closeInfoModal: () => set((state) => {
        state.modals.infoModal = false;
        state.infoTarget = null;
      }),

      /** Opens the reference modal without changing its current target. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      openReferenceModal: () => set((state) => {
        state.modals.referenceModal = true;
      }),

      /** Opens the reference modal at a specific docs target. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      openReferenceTarget: (target) => set((state) => {
        state.referenceTarget = target;
        state.modals.referenceModal = true;
      }),

      /** Closes the reference modal and clears its target. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      closeReferenceModal: () => set((state) => {
        state.modals.referenceModal = false;
        state.referenceTarget = null;
      }),
      
      /** Closes every global modal when navigation or route cleanup needs a hard reset. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      closeAllModals: () => set((state) => {
        (Object.keys(state.modals) as Array<keyof typeof state.modals>).forEach(key => {
          state.modals[key] = false;
        });
      }),

      /** Stores the last uploaded path so contextual hints can find the matching Add button. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      setLastUploadedFilePath: (path) => set((state) => {
        state.lastUploadedFilePath = path;
      }),

      /** Dismisses a hint for the current session without updating permanent preferences. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      sessionDismissHint: (id) => set((state) => {
        state.sessionDismissedHints.add(id);
      }),

      /** Clears session-only dismissals when hint state is reset. */
      /** Consumed by: useUIStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      resetSessionDismissedHints: () => set((state) => {
        state.sessionDismissedHints = new Set<string>();
      }),
    })),
      {
        name: 'ldaca-ui-store',
        /** Persists only the active view; modal/loading/hint state is session-only. */
        /** Consumed by: Zustand persist for useUIStore because persisted hydration needs a stable storage contract before store state is restored. */
        partialize: (state) => ({
          currentView: state.currentView,
        }),
      },
    ),
    { name: 'ui-store' },
  ),
);
