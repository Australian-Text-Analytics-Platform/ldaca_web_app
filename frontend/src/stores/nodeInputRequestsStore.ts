import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

/**
 * Ephemeral bridge from graph-node side buttons to the active view's
 * add-node-as-needed input panel.
 *
 * The React Flow graph is mounted outside individual analysis panels, so a
 * node's side "+" button cannot directly call the active tab's
 * ``useNodeInputs.addNodes``. Instead it holds a transient LIFO stack scoped by
 * workspace + active view. A single-selector owner consumes matching requests
 * immediately; multi-selector views expose the stack through each visible
 * ``NodeInputsPanel`` and consume the latest carried Data Block on placement.
 *
 * This store is intentionally not persisted: button clicks are transient UI
 * intents, not canonical selection state.
 */
export interface NodeInputPointerPosition {
  x: number;
  y: number;
}

interface NodeInputAddRequest {
  id: number;
  workspaceId: string;
  view: string;
  nodeId: string;
  pointer?: NodeInputPointerPosition;
}

interface NodeInputRequestsState {
  nextId: number;
  pendingRequests: NodeInputAddRequest[];
}

interface NodeInputRequestsActions {
  requestAdd: (
    workspaceId: string | null | undefined,
    view: string | null | undefined,
    nodeId: string,
    pointer?: NodeInputPointerPosition,
  ) => void;
  consume: (id: number) => void;
  clear: () => void;
  prune: (workspaceId: string, nodeIds: readonly string[]) => void;
}

export type NodeInputRequestsStore = NodeInputRequestsState & NodeInputRequestsActions;

export const useNodeInputRequestsStore = create<NodeInputRequestsStore>()(
  devtools(
    immer((set) => ({
      nextId: 1,
      pendingRequests: [],

      /** Pushes a graph/sidebar add intent onto the carried LIFO stack. */
      requestAdd: (workspaceId, view, nodeId, pointer) => {
        set((state) => {
          if (!workspaceId || !view || !nodeId) return;
          state.pendingRequests.push({
            id: state.nextId,
            workspaceId,
            view,
            nodeId,
            ...(pointer ? { pointer } : {}),
          });
          state.nextId += 1;
        });
      },

      /** Removes one request after placement or an explicit top-item discard. */
      consume: (id) => {
        set((state) => {
          state.pendingRequests = state.pendingRequests.filter((request) => request.id !== id);
        });
      },

      /** Discards the complete carried stack. */
      clear: () => {
        set((state) => {
          state.pendingRequests = [];
        });
      },

      /** Drops transient add intents whose authoritative target disappeared. */
      prune: (workspaceId, nodeIds) => {
        set((state) => {
          const valid = new Set(nodeIds);
          state.pendingRequests = state.pendingRequests.filter(
            (request) => request.workspaceId !== workspaceId || valid.has(request.nodeId),
          );
        });
      },
    })),
    { name: 'node-input-requests-store' },
  ),
);
