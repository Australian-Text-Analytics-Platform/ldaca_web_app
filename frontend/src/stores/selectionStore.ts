import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

/**
 * Workspace + node selection state.
 *
 * `activeNodeId` is the focused node that drives single-node surfaces;
 * `selectedNodeIds` is ordered membership for the tab strip and multi-node
 * tools. Semantic actions keep the active pointer valid without treating tab
 * activation as a reorder or collapsing multi-selection.
 *
 * Graph-level selection (React Flow, multi-select pagination, etc.) lives
 * with those feature components — don't add it back here.
 */

interface SelectionState {
  activeNodeId: string | null;
  selectedNodeIds: string[];
}

interface SelectionActions {
  /** Focus a selected node without changing ordered membership. */
  activateNode: (nodeId: string) => void;
  /** Reorder selected nodes while retaining every current member. */
  reorderSelectedNodes: (nodeIds: string[]) => void;
  /** Remove one member and choose the nearest remaining tab when it was active. */
  removeNode: (nodeId: string) => void;
  /** Replace ordered membership and choose an explicit valid active node. */
  replaceSelectedNodes: (nodeIds: string[], activeNodeId?: string | null) => void;
  /** Toggle membership; newly-added nodes become active. */
  toggleNode: (nodeId: string) => void;
  /** Clear ordered membership and the active pointer. */
  clearSelection: () => void;
}

type SelectionStore = SelectionState & SelectionActions;

/**
 * Normalizes node membership before selection actions commit it.
 * Used by: `replaceSelectedNodes` and `reorderSelectedNodes`, whose callers can
 * receive repeated ids from graph/list input aggregation or drag payloads.
 * Flow: discard empty ids, keep first occurrence order, and return one stable
 * membership list for the store transition.
 */
const uniqueNodeIds = (nodeIds: readonly string[]): string[] =>
  nodeIds.filter((nodeId, index) => Boolean(nodeId) && nodeIds.indexOf(nodeId) === index);

export const useSelectionStore = create<SelectionStore>()(
  devtools(
    immer((set) => ({
      activeNodeId: null,
      selectedNodeIds: [],

      /** Used by data-table tab activation to focus a member without reordering tabs. */
      activateNode: (nodeId) => {
        set((state) => {
          if (!nodeId || !state.selectedNodeIds.includes(nodeId)) return;
          state.activeNodeId = nodeId;
        });
      },

      /**
       * Used by the data-table tab strip after drag-and-drop.
       * Flow: accept the caller's order for known members, append any omitted
       * current members, and leave the independent active pointer unchanged.
       */
      reorderSelectedNodes: (nodeIds) => {
        set((state) => {
          const selected = new Set(state.selectedNodeIds);
          const orderedKnown = uniqueNodeIds(nodeIds).filter((nodeId) => selected.has(nodeId));
          const omitted = state.selectedNodeIds.filter((nodeId) => !orderedKnown.includes(nodeId));
          state.selectedNodeIds = [...orderedKnown, ...omitted];
        });
      },

      /**
       * Used by successful delete mutations and tab-close controls.
       * Flow: remove membership; when the removed node was active, prefer the
       * tab that moved into its index and otherwise the previous final tab.
       */
      removeNode: (nodeId) => {
        set((state) => {
          const index = state.selectedNodeIds.indexOf(nodeId);
          if (index === -1) return;
          state.selectedNodeIds.splice(index, 1);
          if (state.activeNodeId === nodeId) {
            state.activeNodeId =
              state.selectedNodeIds[index] ?? state.selectedNodeIds[index - 1] ?? null;
          }
        });
      },

      /** Used by graph/list selection replacement and created-node success flows. */
      replaceSelectedNodes: (nodeIds, activeNodeId) => {
        set((state) => {
          const selectedNodeIds = uniqueNodeIds(nodeIds);
          state.selectedNodeIds = selectedNodeIds;
          state.activeNodeId =
            activeNodeId && selectedNodeIds.includes(activeNodeId)
              ? activeNodeId
              : (selectedNodeIds.at(-1) ?? null);
        });
      },

      /**
       * Used by graph and sidebar row clicks for membership selection.
       * Flow: delegate removal semantics for an existing id, otherwise append
       * the new member and make it active.
       */
      toggleNode: (nodeId) => {
        set((state) => {
          if (!nodeId) return;
          const index = state.selectedNodeIds.indexOf(nodeId);
          if (index === -1) {
            state.selectedNodeIds.push(nodeId);
            state.activeNodeId = nodeId;
            return;
          }
          state.selectedNodeIds.splice(index, 1);
          if (state.activeNodeId === nodeId) {
            state.activeNodeId =
              state.selectedNodeIds[index] ?? state.selectedNodeIds[index - 1] ?? null;
          }
        });
      },

      /** Used by workspace switches and preprocessing mutations that reset selection. */
      clearSelection: () => {
        set((state) => {
          state.activeNodeId = null;
          state.selectedNodeIds = [];
        });
      },
    })),
    { name: 'selection-store' },
  ),
);
