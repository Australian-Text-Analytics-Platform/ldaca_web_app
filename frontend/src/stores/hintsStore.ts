import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

interface HintsState {
  /** Hints the user has permanently dismissed via "Don't show again". */
  dismissedHints: string[];
  /** Master toggle. When false, no hints are shown. */
  hintsEnabled: boolean;
  /** Hints dismissed until this app session ends. Never persisted. */
  sessionDismissedHints: string[];
  /** Latest uploaded file used to resolve upload-follow-up hint anchors. */
  lastUploadedFilePath: string | null;
}

interface HintsActions {
  /** Permanently dismiss a hint by id. */
  dismissHint: (id: string) => void;
  /** Dismiss a hint until the current app session ends. */
  dismissHintForSession: (id: string) => void;
  /** Clear permanent and session dismissals so eligible hints can reappear. */
  resetHints: () => void;
  /** Enable or disable the entire hint system. */
  setHintsEnabled: (enabled: boolean) => void;
  /** Track or clear the uploaded file used by upload-follow-up hints. */
  setLastUploadedFilePath: (path: string | null) => void;
}

export type HintsStore = HintsState & HintsActions;

export const useHintsStore = create<HintsStore>()(
  devtools(
    persist(
      immer((set) => ({
        dismissedHints: [],
        hintsEnabled: true,
        sessionDismissedHints: [],
        lastUploadedFilePath: null,

        /** Records a permanent dismissal from `HintsController`/Settings. */
        dismissHint: (id) =>
          set((state) => {
            if (!state.dismissedHints.includes(id)) {
              state.dismissedHints.push(id);
            }
          }),

        /** Records a transient dismissal without expanding the persisted contract. */
        dismissHintForSession: (id) =>
          set((state) => {
            if (!state.sessionDismissedHints.includes(id)) {
              state.sessionDismissedHints.push(id);
            }
          }),

        /** Clears permanent and session dismissals from Settings. */
        resetHints: () =>
          set((state) => {
            state.dismissedHints = [];
            state.sessionDismissedHints = [];
          }),

        /** Toggles all contextual hints without deleting dismissal history. */
        setHintsEnabled: (enabled) =>
          set((state) => {
            state.hintsEnabled = enabled;
          }),

        /** Updates transient upload context consumed by dynamic hint anchors. */
        setLastUploadedFilePath: (path) =>
          set((state) => {
            state.lastUploadedFilePath = path;
          }),
      })),
      {
        name: 'ldaca-hints',
        /** Persists durable choices; session dismissal/upload context resets. */
        partialize: (state) => ({
          dismissedHints: state.dismissedHints,
          hintsEnabled: state.hintsEnabled,
        }),
      },
    ),
    { name: 'hints-store' },
  ),
);
