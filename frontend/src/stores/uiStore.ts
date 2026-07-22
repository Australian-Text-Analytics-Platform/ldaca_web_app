import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { DEFAULT_VIEW, type ViewType } from '@/features/views/viewIds';
import type { DocumentTarget } from '@/tutorials/documentationRegistry';

/**
 * Global UI state: active view, feedback intent, and the
 * currently open canonical documentation target.
 *
 * Business state (workspaces, nodes, selections, analysis tasks) belongs in
 * the server cache or dedicated stores — this store is purely presentation.
 */

interface UIState {
  currentView: ViewType;

  /** Global feedback intent stays independent from document navigation. */
  feedbackOpen: boolean;
  /** Exactly one help/info/reference document may be open at a time. */
  documentTarget: DocumentTarget | null;
}

interface UIActions {
  // Views / layout
  setCurrentView: (view: ViewType) => void;

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
        feedbackOpen: false,
        documentTarget: null,

        setCurrentView: (view) =>
          set((state) => {
            if (state.currentView !== view) state.currentView = view;
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
