import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

/**
 * Recently-used node-input groups ("presets") for the add-node-as-needed model.
 *
 * Whenever a view commits a set of input nodes (via {@link useTabNodeInputs}),
 * the resulting id set is recorded here, most-recent-first, deduped and capped.
 * The node-selection panel's "Add preset" control reads these so users can
 * re-add a previously-used group (e.g. the same corpus across concordance,
 * frequency, and topic modeling) in one click instead of re-hunting the graph.
 *
 * Persisted in localStorage and scoped per workspace; intentionally not synced
 * to the backend (it is a convenience cache, not canonical state).
 */
interface RecentSelectionsState {
  /** Map of workspaceId → ordered list of recent node-id groups (newest first). */
  byWorkspace: Record<string, string[][]>;
}

interface RecentSelectionsActions {
  /** Record a node-id group as the most-recent preset for a workspace. */
  record: (workspaceId: string | null | undefined, ids: string[]) => void;
  /** Clear all recorded presets for a workspace. */
  clear: (workspaceId: string | null | undefined) => void;
}

export type RecentSelectionsStore = RecentSelectionsState & RecentSelectionsActions;

/** Max presets kept per workspace; older entries fall off the end. */
const MAX_RECENT = 8;

/** Order-independent key for a node-id group, used to dedupe presets. */
const groupKey = (ids: string[]): string => [...ids].sort().join('|');

export const useRecentSelectionsStore = create<RecentSelectionsStore>()(
  devtools(
    persist(
      immer((set) => ({
        byWorkspace: {},

        /** Inserts a group at the front, dropping any equivalent prior entry and capping the list. */
        record: (workspaceId, ids) =>
          set((state) => {
            if (!workspaceId || ids.length === 0) return;
            const key = groupKey(ids);
            const existing = state.byWorkspace[workspaceId] ?? [];
            const deduped = existing.filter((group) => groupKey(group) !== key);
            deduped.unshift([...ids]);
            state.byWorkspace[workspaceId] = deduped.slice(0, MAX_RECENT);
          }),

        /** Backs a future "clear presets" affordance. */
        clear: (workspaceId) =>
          set((state) => {
            if (!workspaceId) return;
            state.byWorkspace[workspaceId] = [];
          }),
      })),
      {
        name: 'ldaca-recent-selections',
        partialize: (state) => ({ byWorkspace: state.byWorkspace }),
      },
    ),
    { name: 'recent-selections-store' },
  ),
);
