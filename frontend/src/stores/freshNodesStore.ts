/**
 * "Newly created" node tracking for the workspace graph + sidebar.
 *
 * Every time a workspace-graph update arrives, ``observeNodeIds`` is called
 * with the workspace id and current node ids. Each workspace records:
 *   - ``seenIds``: nodeIds observed and still present in that workspace.
 *     The workspace map entry distinguishes its first graph frame from later
 *     arrivals even when the first frame is empty.
 *   - ``freshIds``: nodeIds that arrived AFTER the first frame and
 *     haven't been interacted with yet. These get the black-outline
 *     "find me" highlight in the graph + sidebar.
 *
 * ``markInteracted`` clears nodeIds from one workspace's ``freshIds`` —
 * called on graph click, sidebar check, or any other user interaction
 * that proves the user has noticed the node.
 *
 * Highlight scope is **session-only**: a page reload starts fresh
 * (everything is "seen"), so the highlight never persists across
 * sessions. That matches the design goal — surface only nodes the user
 * just produced this session via detach / join / stack / clone / etc.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';

enableMapSet();

interface WorkspaceFreshness {
  seenIds: Set<string>;
  freshIds: Set<string>;
}

interface FreshNodesState {
  freshnessByWorkspace: Map<string, WorkspaceFreshness>;
  /** Idempotent. Given the current full set of nodeIds in the
   * workspace graph, mark any new arrivals as fresh. On the very
   * first call for a workspace, don't mark anything fresh — those are
   * pre-existing nodes from the loaded workspace. */
  observeNodeIds(workspaceId: string, currentIds: readonly string[]): void;
  /** Drop nodeIds from ``freshIds``. Called on first interaction. */
  markInteracted(workspaceId: string, nodeIds: readonly string[]): void;
  reset(): void;
}

export const useFreshNodesStore = create<FreshNodesState>()(
  immer((set) => ({
    freshnessByWorkspace: new Map<string, WorkspaceFreshness>(),

    /**
     * Used by `useWorkspaceGraph` after each workspace graph payload.
     * Flow: create a workspace baseline on first observation, then add later
     * unseen ids only to that workspace's fresh highlights.
     */
    observeNodeIds: (workspaceId, currentIds) => {
      set((state) => {
        if (!workspaceId) return;
        const existing = state.freshnessByWorkspace.get(workspaceId);
        if (!existing) {
          state.freshnessByWorkspace.set(workspaceId, {
            seenIds: new Set(currentIds.filter(Boolean)),
            freshIds: new Set(),
          });
          return;
        }
        const currentIdSet = new Set(currentIds.filter(Boolean));
        for (const seenId of existing.seenIds) {
          if (!currentIdSet.has(seenId)) {
            existing.seenIds.delete(seenId);
            existing.freshIds.delete(seenId);
          }
        }
        for (const id of currentIds) {
          if (!id) continue;
          if (!existing.seenIds.has(id)) {
            existing.seenIds.add(id);
            existing.freshIds.add(id);
          }
        }
      });
    },

    /** Used by graph/sidebar interaction handlers to acknowledge visible nodes. */
    markInteracted: (workspaceId, nodeIds) => {
      set((state) => {
        const freshness = state.freshnessByWorkspace.get(workspaceId);
        if (!freshness) return;
        for (const id of nodeIds) {
          if (id) freshness.freshIds.delete(id);
        }
      });
    },

    /** Used by tests and session teardown to discard every workspace baseline. */
    reset: () => {
      set((state) => {
        state.freshnessByWorkspace = new Map();
      });
    },
  })),
);
