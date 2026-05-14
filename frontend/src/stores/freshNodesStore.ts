/**
 * "Newly created" node tracking for the workspace graph + sidebar.
 *
 * Every time a workspace-graph update arrives, ``observeNodeIds`` is
 * called with the current set of nodeIds. The store records:
 *   - ``seenIds``: every nodeId we've ever observed in this session.
 *     Lets us tell "this is the first frame" (when ``seenIds`` is
 *     empty) from "a new node just appeared mid-session".
 *   - ``freshIds``: nodeIds that arrived AFTER the first frame and
 *     haven't been interacted with yet. These get the black-outline
 *     "find me" highlight in the graph + sidebar.
 *
 * ``markInteracted`` clears one or more nodeIds from ``freshIds`` —
 * called on graph click, sidebar check, or any other user interaction
 * that proves the user has noticed the node.
 *
 * Highlight scope is **session-only**: a page reload starts fresh
 * (everything is "seen"), so the highlight never persists across
 * sessions. That matches the design goal — surface only nodes the user
 * just produced this session via detach / join / stack / clone / etc.
 */
import { create } from 'zustand';

interface FreshNodesState {
  seenIds: Set<string>;
  freshIds: Set<string>;
  /** Idempotent. Given the current full set of nodeIds in the
   * workspace graph, mark any new arrivals as fresh. On the very
   * first call (when seenIds is empty), don't mark anything fresh —
   * those are pre-existing nodes from the loaded workspace. */
  observeNodeIds(currentIds: ReadonlyArray<string>): void;
  /** Drop nodeIds from ``freshIds``. Called on first interaction. */
  markInteracted(nodeIds: ReadonlyArray<string>): void;
  /** Drop nodeIds from ``seenIds`` AND ``freshIds`` — typically called
   * when a node is deleted from the workspace, so a future re-creation
   * with the same id (unlikely but possible) is treated as new. */
  forgetNodeIds(nodeIds: ReadonlyArray<string>): void;
  reset(): void;
}

export const useFreshNodesStore = create<FreshNodesState>((set) => ({
  seenIds: new Set<string>(),
  freshIds: new Set<string>(),

  observeNodeIds: (currentIds) => {
    set((state) => {
      const wasEmpty = state.seenIds.size === 0;
      const nextSeen = new Set(state.seenIds);
      const nextFresh = new Set(state.freshIds);
      let mutated = false;
      for (const id of currentIds) {
        if (!id) continue;
        if (!nextSeen.has(id)) {
          nextSeen.add(id);
          if (!wasEmpty) {
            // Genuinely new mid-session arrival → flag it.
            nextFresh.add(id);
          }
          mutated = true;
        }
      }
      if (!mutated) return state;
      return { seenIds: nextSeen, freshIds: nextFresh };
    });
  },

  markInteracted: (nodeIds) => {
    set((state) => {
      if (nodeIds.length === 0 || state.freshIds.size === 0) return state;
      const nextFresh = new Set(state.freshIds);
      let mutated = false;
      for (const id of nodeIds) {
        if (id && nextFresh.delete(id)) mutated = true;
      }
      if (!mutated) return state;
      return { freshIds: nextFresh };
    });
  },

  forgetNodeIds: (nodeIds) => {
    set((state) => {
      if (nodeIds.length === 0) return state;
      const nextSeen = new Set(state.seenIds);
      const nextFresh = new Set(state.freshIds);
      let mutated = false;
      for (const id of nodeIds) {
        if (id && nextSeen.delete(id)) mutated = true;
        if (id) nextFresh.delete(id);
      }
      if (!mutated) return state;
      return { seenIds: nextSeen, freshIds: nextFresh };
    });
  },

  reset: () => set({ seenIds: new Set(), freshIds: new Set() }),
}));
