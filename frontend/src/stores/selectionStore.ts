import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

/**
 * Workspace + node selection state.
 *
 * `currentWorkspaceId` is the canonical "which workspace is open" pointer;
 * the server `current.get` query only bootstraps this store.
 *
 * `selectedNodeId` is the "focused" node (drives the data table / detail
 * panels); `selectedNodeIds` is the tab strip, ordered left-to-right. Every
 * mutator keeps the two node fields in sync so components can read either
 * without an extra derivation step.
 *
 * Graph-level selection (React Flow, multi-select pagination, etc.) lives
 * with those feature components — don't add it back here.
 */

interface SelectionState {
  currentWorkspaceId: string | null;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
}

interface SelectionActions {
  /**
   * Set the active workspace id. Pass `null` to clear. Node selection is
   * reset only by callers (the workspace-change effect in
   * `useWorkspaceCore`); intentionally not bundled here so mutations that
   * just rehydrate the same workspace don't clobber selection.
   */
  setCurrentWorkspaceId: (workspaceId: string | null) => void;
  /** Replace the single focused node; also resets the tab strip. */
  selectNode: (nodeId: string | null) => void;
  /** Replace the tab strip; focus follows the rightmost (most recent) entry. */
  setSelectedNodes: (nodeIds: string[]) => void;
  /** Toggle a node in the tab strip; toggled-on nodes become the focused one. */
  toggleNodeSelection: (nodeId: string) => void;
  clearAllSelections: () => void;
}

type SelectionStore = SelectionState & SelectionActions;

export const useSelectionStore = create<SelectionStore>()(
  devtools(
    immer((set) => ({
      currentWorkspaceId: null,
      selectedNodeId: null,
      selectedNodeIds: [],

      /** Updates the active workspace pointer while leaving node selection reset to callers. */
      /** Consumed by: useSelectionStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      setCurrentWorkspaceId: (workspaceId) => {
        set((state) => {
          state.currentWorkspaceId = workspaceId;
        });
      },

      /** Focuses one node and collapses the tab strip to that node. */
      /** Consumed by: useSelectionStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      selectNode: (nodeId) => {
        set((state) => {
          state.selectedNodeId = nodeId;
          state.selectedNodeIds = nodeId ? [nodeId] : [];
        });
      },

      /** Replaces the selected-node tab strip after multi-select or reordering flows. */
      /** Consumed by: useSelectionStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      setSelectedNodes: (nodeIds) => {
        set((state) => {
          state.selectedNodeIds = nodeIds;
          state.selectedNodeId = nodeIds.at(-1) ?? null;
        });
      },

      /** Toggles a node into/out of the tab strip while keeping focus on the newest visible node. */
      /**
       * Consumed by: useSelectionStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
       * Flow: add unseen node ids and focus them, or remove existing ids and move focus to the rightmost remaining selection.
       */
      toggleNodeSelection: (nodeId) => {
        set((state) => {
          const idx = state.selectedNodeIds.indexOf(nodeId);
          if (idx === -1) {
            state.selectedNodeIds.push(nodeId);
            state.selectedNodeId = nodeId;
            return;
          }
          state.selectedNodeIds.splice(idx, 1);
          if (state.selectedNodeId === nodeId) {
            state.selectedNodeId = state.selectedNodeIds[state.selectedNodeIds.length - 1] ?? null;
          }
        });
      },

      /** Clears focus and multi-node selection when the workspace or graph context resets. */
      /** Consumed by: useSelectionStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
      clearAllSelections: () => {
        set((state) => {
          state.selectedNodeId = null;
          state.selectedNodeIds = [];
        });
      },
    })),
    { name: 'selection-store' },
  ),
);
