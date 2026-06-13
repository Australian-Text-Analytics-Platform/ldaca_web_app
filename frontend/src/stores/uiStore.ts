import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { usePreferencesStore } from './preferencesStore';

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

export type ModalKind =
  | 'feedback'
  | 'tutorial'
  | 'warning'
  | 'info'
  | 'reference'
  | 'quotationEngine';

export interface ModalTarget {
  file: string;
  anchor: string;
  label?: string;
}

interface UIState {
  currentView: ViewType;
  visibleViews: ViewType[];
  sidebarCollapsed: boolean;

  /** Set of in-flight operation ids. Read via `.size` / `.has` elsewhere. */
  loadingOperations: Set<string>;
  /** Map of operation id → last error message. */
  operationErrors: Map<string, string>;

  /** Which global modals are open, keyed by kind. */
  modals: Record<ModalKind, boolean>;
  /** Target document for each modal kind (set when opening with a doc target). */
  modalTargets: Record<ModalKind, ModalTarget | null>;

  /**
   * Path of the most recently uploaded file. Used by the contextual hints
   * system to highlight the matching file row's "Add" button after upload.
   */
  lastUploadedFilePath: string | null;

  /** Hints dismissed for this session only (permanent dismissals in hintsStore). */
  sessionDismissedHints: Set<string>;
}

interface UIActions {
  // Views / layout
  setCurrentView: (view: ViewType) => void;
  setViewVisibility: (view: ViewType, visible: boolean) => void;
  syncVisibleViewsFromPreferences: () => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Operation tracking
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
  setOperationError: (operationId: string, error: string) => void;

  // Modals
  openModal: (kind: ModalKind, target?: ModalTarget) => void;
  closeModal: (kind: ModalKind) => void;
  closeAllModals: () => void;
  setModalOpen: (kind: ModalKind, open: boolean) => void;

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
        currentView: 'data-loader',
        visibleViews: [...DEFAULT_VISIBLE_VIEWS],
        sidebarCollapsed: false,
        loadingOperations: new Set(),
        operationErrors: new Map(),
        modals: {
          feedback: false,
          tutorial: false,
          warning: false,
          info: false,
          reference: false,
          quotationEngine: false,
        },
        modalTargets: {
          feedback: null,
          tutorial: null,
          warning: null,
          info: null,
          reference: null,
          quotationEngine: null,
        },
        lastUploadedFilePath: null,
        sessionDismissedHints: new Set<string>(),

        setCurrentView: (view) =>
          set((state) => {
            if (state.currentView !== view) state.currentView = view;
          }),

        setViewVisibility: (view, visible) =>
          set((state) => {
            const currentlyVisible = state.visibleViews.includes(view);
            if (currentlyVisible === visible) return;

            if (visible) {
              state.visibleViews = ALL_VIEWS.filter(
                (candidate) => candidate === view || state.visibleViews.includes(candidate),
              );
            } else {
              if (state.visibleViews.length <= 1) return;
              state.visibleViews = state.visibleViews.filter((c) => c !== view);
              if (state.currentView === view) {
                state.currentView = state.visibleViews[0] ?? 'data-loader';
              }
            }

            usePreferencesStore.getState().setViewHidden(view, !visible);
          }),

        syncVisibleViewsFromPreferences: () =>
          set((state) => {
            const hiddenViews = usePreferencesStore.getState().hiddenViews;
            state.visibleViews = ALL_VIEWS.filter((v) => !hiddenViews.includes(v));
            if (!state.visibleViews.includes(state.currentView)) {
              state.currentView = state.visibleViews[0] ?? 'data-loader';
            }
          }),

        toggleSidebar: () =>
          set((state) => {
            state.sidebarCollapsed = !state.sidebarCollapsed;
          }),

        setSidebarCollapsed: (collapsed) =>
          set((state) => {
            state.sidebarCollapsed = collapsed;
          }),

        startOperation: (operationId) =>
          set((state) => {
            state.loadingOperations.add(operationId);
          }),

        endOperation: (operationId) =>
          set((state) => {
            state.loadingOperations.delete(operationId);
            state.operationErrors.delete(operationId);
          }),

        setOperationError: (operationId, error) =>
          set((state) => {
            state.operationErrors.set(operationId, error);
            state.loadingOperations.delete(operationId);
          }),

        openModal: (kind, target) =>
          set((state) => {
            state.modals[kind] = true;
            if (target !== undefined) {
              state.modalTargets[kind] = target;
            }
          }),

        closeModal: (kind) =>
          set((state) => {
            state.modals[kind] = false;
            state.modalTargets[kind] = null;
          }),

        closeAllModals: () =>
          set((state) => {
            for (const kind of Object.keys(state.modals) as ModalKind[]) {
              state.modals[kind] = false;
            }
          }),

        setModalOpen: (kind, open) =>
          set((state) => {
            if (open) {
              state.modals[kind] = true;
            } else {
              state.modals[kind] = false;
              state.modalTargets[kind] = null;
            }
          }),

        setLastUploadedFilePath: (path) =>
          set((state) => {
            state.lastUploadedFilePath = path;
          }),

        sessionDismissHint: (id) =>
          set((state) => {
            state.sessionDismissedHints.add(id);
          }),

        resetSessionDismissedHints: () =>
          set((state) => {
            state.sessionDismissedHints = new Set<string>();
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
