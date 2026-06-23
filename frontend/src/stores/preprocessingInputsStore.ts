import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { AnalysisTabInput } from '@/api';

/**
 * Frontend-persisted input node sets for preprocessing subtabs.
 *
 * Unlike analysis tabs (whose inputs persist server-side in ``tabs.json``),
 * preprocessing subtabs (aggregate, concat, expression, filter, join, replace,
 * slice) keep their add-node-as-needed selection here — in localStorage, scoped
 * by ``(workspaceId, subtabId)``. Each subtab owns an independent selection so
 * switching subtabs never reconfigures another, and a "Clear all" control maps
 * to {@link clearInputs}. Selections survive reload but are intentionally not
 * round-tripped to the backend (a user often wants different inputs each time).
 *
 * Used by: the preprocessing subtab hooks via ``useNodeInputs`` (value/onChange
 * bound to ``getInputs``/``setInputs`` for that subtab's key).
 */
interface PreprocessingInputsState {
  /** Map of ``"<workspaceId>::<subtabId>"`` → that subtab's input node set. */
  byKey: Record<string, AnalysisTabInput[]>;
}

interface PreprocessingInputsActions {
  /** Replace the input set for one (workspace, subtab) key. */
  setInputs: (workspaceId: string, subtabId: string, inputs: AnalysisTabInput[]) => void;
  /** Clear the input set for one (workspace, subtab) key. */
  clearInputs: (workspaceId: string, subtabId: string) => void;
}

export type PreprocessingInputsStore = PreprocessingInputsState & PreprocessingInputsActions;

/** Builds the composite storage key; null workspace falls back to a stable sentinel. */
export const preprocessingInputsKey = (
  workspaceId: string | null | undefined,
  subtabId: string,
): string => `${workspaceId ?? '__none__'}::${subtabId}`;

export const usePreprocessingInputsStore = create<PreprocessingInputsStore>()(
  devtools(
    persist(
      immer((set) => ({
        byKey: {},

        /** Commits a subtab's add/remove/column change; consumed by useNodeInputs.onChange. */
        setInputs: (workspaceId, subtabId, inputs) =>
          set((state) => {
            state.byKey[preprocessingInputsKey(workspaceId, subtabId)] = inputs;
          }),

        /** Backs the per-subtab "Clear all" control. */
        clearInputs: (workspaceId, subtabId) =>
          set((state) => {
            state.byKey[preprocessingInputsKey(workspaceId, subtabId)] = [];
          }),
      })),
      {
        name: 'ldaca-preprocessing-inputs',
        /** Persists only the selection map, not devtools metadata. */
        partialize: (state) => ({ byKey: state.byKey }),
      },
    ),
    { name: 'preprocessing-inputs-store' },
  ),
);
