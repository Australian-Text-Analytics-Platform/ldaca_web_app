import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { DEFAULT_VIEW, type ViewType } from '@/features/views/viewIds';
import type { DocumentTarget } from '@/tutorials/documentationRegistry';

enableMapSet();

/**
 * Global UI state: active view, operation loading, feedback intent, and the
 * currently open canonical documentation target.
 *
 * Business state (workspaces, nodes, selections, analysis tasks) belongs in
 * the server cache or dedicated stores — this store is purely presentation.
 */

interface UIState {
  currentView: ViewType;

  /** Set of in-flight operation ids. Read via `.size` / `.has` elsewhere. */
  loadingOperations: Set<string>;

  /** Global feedback intent stays independent from document navigation. */
  feedbackOpen: boolean;
  /** Exactly one help/info/reference document may be open at a time. */
  documentTarget: DocumentTarget | null;
}

interface UIActions {
  // Views / layout
  setCurrentView: (view: ViewType) => void;

  // Operation tracking
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;

  // Global overlays
  openFeedback: () => void;
  closeFeedback: () => void;
  openDocument: (target: DocumentTarget) => void;
  closeDocument: () => void;
}

type UIStore = UIState & UIActions;

export const useUIStore = create<UIStore>()(
  devtools(
    persist(
      immer((set) => ({
        currentView: DEFAULT_VIEW,
        loadingOperations: new Set(),
        feedbackOpen: false,
        documentTarget: null,

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

        openFeedback: () =>
          set((state) => {
            state.feedbackOpen = true;
          }),

        closeFeedback: () =>
          set((state) => {
            state.feedbackOpen = false;
          }),

        openDocument: (target) =>
          set((state) => {
            state.documentTarget = target;
          }),

        closeDocument: () =>
          set((state) => {
            state.documentTarget = null;
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
