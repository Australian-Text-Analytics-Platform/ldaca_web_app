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
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';

enableMapSet();

interface FreshNodesState {
  seenIds: Set<string>;
  freshIds: Set<string>;
  /** Idempotent. Given the current full set of nodeIds in the
   * workspace graph, mark any new arrivals as fresh. On the very
   * first call (when seenIds is empty), don't mark anything fresh —
   * those are pre-existing nodes from the loaded workspace. */
  observeNodeIds(currentIds: readonly string[]): void;
  /** Drop nodeIds from ``freshIds``. Called on first interaction. */
  markInteracted(nodeIds: readonly string[]): void;
  /** Drop nodeIds from ``seenIds`` AND ``freshIds`` — typically called
   * when a node is deleted from the workspace, so a future re-creation
   * with the same id (unlikely but possible) is treated as new. */
  forgetNodeIds(nodeIds: readonly string[]): void;
  reset(): void;
}

export const useFreshNodesStore = create<FreshNodesState>()(
  immer((set) => ({
    seenIds: new Set<string>(),
    freshIds: new Set<string>(),

    /** Observes a graph payload and marks only mid-session arrivals as fresh. */
    /**
     * Consumed by: useFreshNodesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
     * Flow: copy seen/fresh sets, treat the first graph payload as baseline, then mark later unseen node ids as fresh highlights.
     */
    observeNodeIds: (currentIds) => {
      set((state) => {
        const wasEmpty = state.seenIds.size === 0;
        for (const id of currentIds) {
          if (!id) continue;
          if (!state.seenIds.has(id)) {
            state.seenIds.add(id);
            if (!wasEmpty) state.freshIds.add(id);
          }
        }
      });
    },

    /** Removes the fresh highlight once graph/sidebar interactions prove the user noticed nodes. */
    /** Consumed by: useFreshNodesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
    markInteracted: (nodeIds) => {
      set((state) => {
        for (const id of nodeIds) {
          if (id) state.freshIds.delete(id);
        }
      });
    },

    /** Drops deleted nodes from tracking so future same-id arrivals can be highlighted again. */
    /**
     * Consumed by: useFreshNodesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
     * Flow: copy tracking sets, remove deleted ids from seen and fresh state, then return the original state when no tracked id changed.
     */
    forgetNodeIds: (nodeIds) => {
      set((state) => {
        for (const id of nodeIds) {
          if (id) {
            state.seenIds.delete(id);
            state.freshIds.delete(id);
          }
        }
      });
    },

    /** Resets session-only freshness state for tests and workspace-session resets. */
    /** Consumed by: useFreshNodesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
    reset: () =>
      { set((state) => {
        state.seenIds = new Set();
        state.freshIds = new Set();
      }); },
  })),
);
