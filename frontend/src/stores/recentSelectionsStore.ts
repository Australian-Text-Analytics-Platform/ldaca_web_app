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
 * Persisted in localStorage and scoped per user and Workspace; intentionally not synced
 * to the backend (it is a convenience cache, not canonical state).
 */
interface RecentSelectionsState {
  /** Map of user/workspace key → ordered recent node-id groups (newest first). */
  byScope: Record<string, string[][]>;
}

interface RecentSelectionsActions {
  /** Record a node-id group as the most-recent preset for a workspace. */
  record: (
    userId: string | null | undefined,
    workspaceId: string | null | undefined,
    ids: string[],
  ) => void;
  pruneWorkspaces: (userId: string, workspaceIds: readonly string[]) => void;
  pruneNodes: (userId: string, workspaceId: string, nodeIds: readonly string[]) => void;
}

export type RecentSelectionsStore = RecentSelectionsState & RecentSelectionsActions;

/** Max presets kept per workspace; older entries fall off the end. */
const MAX_RECENT = 8;

/** Order-independent key for a node-id group, used to dedupe presets. */
const groupKey = (ids: string[]): string => [...ids].sort().join('|');

export const recentSelectionsScopeKey = (
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
): string => `${userId ?? '__anonymous__'}::${workspaceId ?? '__none__'}`;

export const useRecentSelectionsStore = create<RecentSelectionsStore>()(
  devtools(
    persist(
      immer((set) => ({
        byScope: {},

        /** Inserts a group at the front, dropping any equivalent prior entry and capping the list. */
        record: (userId, workspaceId, ids) =>
          set((state) => {
            if (!workspaceId || ids.length === 0) return;
            const scopeKey = recentSelectionsScopeKey(userId, workspaceId);
            const key = groupKey(ids);
            const existing = state.byScope[scopeKey] ?? [];
            const deduped = existing.filter((group) => groupKey(group) !== key);
            deduped.unshift([...ids]);
            state.byScope[scopeKey] = deduped.slice(0, MAX_RECENT);
          }),

        pruneWorkspaces: (userId, workspaceIds) =>
          set((state) => {
            const valid = new Set(workspaceIds);
            state.byScope = Object.fromEntries(
              Object.entries(state.byScope).filter(([key]) => {
                if (!key.startsWith(`${userId}::`)) return true;
                const workspaceId = key.split('::')[1];
                return workspaceId ? valid.has(workspaceId) : false;
              }),
            );
          }),

        pruneNodes: (userId, workspaceId, nodeIds) =>
          set((state) => {
            const valid = new Set(nodeIds);
            const scopeKey = recentSelectionsScopeKey(userId, workspaceId);
            const groups = state.byScope[scopeKey] ?? [];
            state.byScope[scopeKey] = groups
              .map((group) => group.filter((nodeId) => valid.has(nodeId)))
              .filter((group) => group.length > 0)
              .filter(
                (group, index, all) =>
                  all.findIndex((item) => groupKey(item) === groupKey(group)) === index,
              )
              .slice(0, MAX_RECENT);
          }),
      })),
      {
        name: 'ldaca-recent-selections-v2',
        version: 2,
        partialize: (state) => ({ byScope: state.byScope }),
      },
    ),
    { name: 'recent-selections-store' },
  ),
);
