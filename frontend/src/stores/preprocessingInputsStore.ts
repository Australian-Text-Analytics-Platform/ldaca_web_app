import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { AnalysisTabInput } from '@/api';

/**
 * Frontend-persisted input node sets for preprocessing subtabs.
 *
 * Unlike completed analyses (whose immutable requests persist server-side),
 * preprocessing subtabs (aggregate, concat, expression, filter, join, replace,
 * slice) keep their add-node-as-needed selection here — in localStorage, scoped
 * by ``(userId, workspaceId, subtabId)``. Each subtab owns an independent selection so
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
  /** Replace the input set for one user/workspace/subtab key. */
  setInputs: (
    userId: string,
    workspaceId: string,
    subtabId: string,
    inputs: AnalysisTabInput[],
  ) => void;
  /** Clear the input set for one user/workspace/subtab key. */
  clearInputs: (userId: string, workspaceId: string, subtabId: string) => void;
  pruneWorkspaces: (userId: string, workspaceIds: readonly string[]) => void;
  pruneNodes: (userId: string, workspaceId: string, nodeIds: readonly string[]) => void;
}

export type PreprocessingInputsStore = PreprocessingInputsState & PreprocessingInputsActions;

/** Builds the composite storage key; null workspace falls back to a stable sentinel. */
export const preprocessingInputsKey = (
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
  subtabId: string,
): string => `${userId ?? '__anonymous__'}::${workspaceId ?? '__none__'}::${subtabId}`;

const workspaceKeyPrefix = (userId: string, workspaceId: string): string =>
  `${userId}::${workspaceId}::`;

export const usePreprocessingInputsStore = create<PreprocessingInputsStore>()(
  devtools(
    persist(
      immer((set) => ({
        byKey: {},

        /** Commits a subtab's add/remove/column change; consumed by useNodeInputs.onChange. */
        setInputs: (userId, workspaceId, subtabId, inputs) =>
          set((state) => {
            state.byKey[preprocessingInputsKey(userId, workspaceId, subtabId)] = inputs;
          }),

        /** Backs the per-subtab "Clear all" control. */
        clearInputs: (userId, workspaceId, subtabId) =>
          set((state) => {
            state.byKey[preprocessingInputsKey(userId, workspaceId, subtabId)] = [];
          }),

        pruneWorkspaces: (userId, workspaceIds) =>
          set((state) => {
            const valid = new Set(workspaceIds);
            state.byKey = Object.fromEntries(
              Object.entries(state.byKey).filter(([key]) => {
                if (!key.startsWith(`${userId}::`)) return true;
                const workspaceId = key.split('::')[1];
                return workspaceId ? valid.has(workspaceId) : false;
              }),
            );
          }),

        pruneNodes: (userId, workspaceId, nodeIds) =>
          set((state) => {
            const valid = new Set(nodeIds);
            const prefix = workspaceKeyPrefix(userId, workspaceId);
            Object.entries(state.byKey).forEach(([key, inputs]) => {
              if (key.startsWith(prefix)) {
                state.byKey[key] = inputs.filter((input) => valid.has(input.node_id));
              }
            });
          }),
      })),
      {
        name: 'ldaca-preprocessing-inputs-v2',
        version: 2,
        /** Persists only the selection map, not devtools metadata. */
        partialize: (state) => ({ byKey: state.byKey }),
      },
    ),
    { name: 'preprocessing-inputs-store' },
  ),
);
