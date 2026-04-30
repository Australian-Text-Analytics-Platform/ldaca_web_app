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

        dismissHint: (id) =>
          set((state) => {
            if (!state.dismissedHints.includes(id)) {
              state.dismissedHints.push(id);
            }
          }),

        resetHints: () =>
          set((state) => {
            state.dismissedHints = [];
          }),

        setHintsEnabled: (enabled) =>
          set((state) => {
            state.hintsEnabled = enabled;
          }),
      })),
      {
        name: 'ldaca-hints',
        partialize: (state) => ({
          dismissedHints: state.dismissedHints,
          hintsEnabled: state.hintsEnabled,
        }),
      },
    ),
    { name: 'hints-store' },
  ),
);
