import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

/**
 * Session-only pin tracking for the workspace list view.
 *
 * Rendered/consumed by: WorkspaceNodeList and WorkspaceListView because the
 * sidebar list needs a client-owned ordering lane that does not mutate the
 * backend workspace order. Pinned ids are stored in append order so the list can
 * render pinned nodes first while preserving the user's pin sequence.
 *
 * Flow: toolbar pin clicks toggle ids in ``pinnedNodeIds``; list rendering drops
 * stale ids from the visual buckets when a node is no longer present.
 */
interface PinnedNodesState {
  pinnedNodeIds: string[];
  isPinned: (nodeId: string) => boolean;
  togglePinnedNode: (nodeId: string) => void;
  unpinNode: (nodeId: string) => void;
  prune: (nodeIds: readonly string[]) => void;
  reset: () => void;
}

export const usePinnedNodesStore = create<PinnedNodesState>()(
  immer((set, get) => ({
    pinnedNodeIds: [],

    /** Consumed by row renderers to choose pinned styling and resting pin visibility. */
    isPinned: (nodeId) => get().pinnedNodeIds.includes(nodeId),

    /** Appends newly pinned nodes and removes already-pinned nodes. */
    togglePinnedNode: (nodeId) => {
      if (!nodeId) return;
      set((state) => {
        const index = state.pinnedNodeIds.indexOf(nodeId);
        if (index >= 0) {
          state.pinnedNodeIds.splice(index, 1);
          return;
        }
        state.pinnedNodeIds.push(nodeId);
      });
    },

    /** Removes one node from the pin lane without changing other pin order. */
    unpinNode: (nodeId) => {
      set((state) => {
        state.pinnedNodeIds = state.pinnedNodeIds.filter((id) => id !== nodeId);
      });
    },

    /** Discards pins whose authoritative Data Blocks no longer exist. */
    prune: (nodeIds) => {
      set((state) => {
        const valid = new Set(nodeIds);
        state.pinnedNodeIds = state.pinnedNodeIds.filter((id) => valid.has(id));
      });
    },

    /** Clears session pinning. Used by tests and workspace-session reset flows. */
    reset: () => {
      set((state) => {
        state.pinnedNodeIds = [];
      });
    },
  })),
);
