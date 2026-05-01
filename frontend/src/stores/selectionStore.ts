import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

/**
 * Node selection for the active workspace.
 *
 * `selectedNodeId` is the "focused" node (drives the data table / detail
 * panels); `selectedNodeIds` is the tab strip, ordered left-to-right. Every
 * mutator keeps the two fields in sync so components can read either without
 * an extra derivation step.
 *
 * Graph-level selection (React Flow, multi-select pagination, etc.) lives
 * with those feature components — don't add it back here.
 */

interface SelectionState {
  selectedNodeId: string | null;
  selectedNodeIds: string[];
}

interface SelectionActions {
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
      selectedNodeId: null,
      selectedNodeIds: [],

      selectNode: (nodeId) => set((state) => {
        state.selectedNodeId = nodeId;
        state.selectedNodeIds = nodeId ? [nodeId] : [];
      }),

      setSelectedNodes: (nodeIds) => set((state) => {
        state.selectedNodeIds = nodeIds;
        state.selectedNodeId = nodeIds.length > 0 ? nodeIds[nodeIds.length - 1]! : null;
      }),

      toggleNodeSelection: (nodeId) => set((state) => {
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
      }),

      clearAllSelections: () => set((state) => {
        state.selectedNodeId = null;
        state.selectedNodeIds = [];
      }),
    })),
    { name: 'selection-store' },
  ),
);
