import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

interface HintsState {
  /** Hints the user has permanently dismissed via "Got it". */
  dismissedHints: string[];
  /** Master toggle. When false, no hints are shown. */
  hintsEnabled: boolean;
}

interface HintsActions {
  /** Permanently dismiss a hint by id. */
  dismissHint: (id: string) => void;
  /** Clear permanent dismissals so all eligible hints become visible again. */
  resetHints: () => void;
  /** Enable or disable the entire hint system. */
  setHintsEnabled: (enabled: boolean) => void;
}

export type HintsStore = HintsState & HintsActions;

export const useHintsStore = create<HintsStore>()(
  devtools(
    persist(
      immer((set) => ({
        dismissedHints: [],
        hintsEnabled: true,

        /** Records a permanent hint dismissal so future sessions do not show it again. */
        /** Consumed by: useHintsStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        dismissHint: (id) =>
          set((state) => {
            if (!state.dismissedHints.includes(id)) {
              state.dismissedHints.push(id);
            }
          }),

        /** Clears permanent dismissals from the settings/debug reset path. */
        /** Consumed by: useHintsStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        resetHints: () =>
          set((state) => {
            state.dismissedHints = [];
          }),

        /** Toggles all contextual hints without deleting dismissal history. */
        /** Consumed by: useHintsStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        setHintsEnabled: (enabled) =>
          set((state) => {
            state.hintsEnabled = enabled;
          }),
      })),
      {
        name: 'ldaca-hints',
        /** Persists only user choices, not middleware/devtools metadata. */
        /** Consumed by: Zustand persist for useHintsStore because persisted hydration needs a stable storage contract before store state is restored. */
        partialize: (state) => ({
          dismissedHints: state.dismissedHints,
          hintsEnabled: state.hintsEnabled,
        }),
      },
    ),
    { name: 'hints-store' },
  ),
);
