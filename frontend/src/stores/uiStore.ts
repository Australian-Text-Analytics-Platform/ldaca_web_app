import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { DEFAULT_VIEW, type ViewType } from '@/features/views/viewIds';

enableMapSet();

/**
 * Global UI state: active view, operation loading, global modal intent, and
 * contextual-hint state that lives outside individual feature components.
 *
 * Business state (workspaces, nodes, selections, analysis tasks) belongs in
 * the server cache or dedicated stores — this store is purely presentation.
 */

type ModalKind = 'feedback' | 'tutorial' | 'warning' | 'info' | 'reference';

interface ModalTarget {
  file: string;
  anchor: string;
  label?: string;
}

interface UIState {
  currentView: ViewType;

  /** Set of in-flight operation ids. Read via `.size` / `.has` elsewhere. */
  loadingOperations: Set<string>;

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

  // Operation tracking
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;

  // Modals
  openModal: (kind: ModalKind, target?: ModalTarget) => void;
  closeModal: (kind: ModalKind) => void;

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
        currentView: DEFAULT_VIEW,
        loadingOperations: new Set(),
        modals: {
          feedback: false,
          tutorial: false,
          warning: false,
          info: false,
          reference: false,
        },
        modalTargets: {
          feedback: null,
          tutorial: null,
          warning: null,
          info: null,
          reference: null,
        },
        lastUploadedFilePath: null,
        sessionDismissedHints: new Set<string>(),

        setCurrentView: (view) =>
          set((state) => {
            if (state.currentView !== view) state.currentView = view;
          }),

        startOperation: (operationId) =>
          set((state) => {
            state.loadingOperations.add(operationId);
          }),

        endOperation: (operationId) =>
          set((state) => {
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
