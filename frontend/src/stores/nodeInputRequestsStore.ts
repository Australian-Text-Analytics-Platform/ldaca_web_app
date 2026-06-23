import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

/**
 * Ephemeral bridge from graph-node side buttons to the active view's
 * add-node-as-needed input panel.
 *
 * The React Flow graph is mounted outside individual analysis panels, so a
 * node's side "+" button cannot directly call the active tab's
 * ``useNodeInputs.addNodes``. Instead it queues an add request scoped by
 * workspace + active view. The mounted ``useTabNodeInputs`` hook for that view
 * consumes matching requests and commits them to that tab's ``inputs``.
 *
 * This store is intentionally not persisted: button clicks are transient UI
 * intents, not canonical selection state.
 */
interface NodeInputAddRequest {
  id: number;
  workspaceId: string;
  view: string;
  nodeIds: string[];
}

interface NodeInputRequestsState {
  nextId: number;
  requests: NodeInputAddRequest[];
}

interface NodeInputRequestsActions {
  requestAdd: (
    workspaceId: string | null | undefined,
    view: string | null | undefined,
    nodeId: string,
  ) => void;
  consume: (id: number) => void;
}

export type NodeInputRequestsStore = NodeInputRequestsState & NodeInputRequestsActions;

export const useNodeInputRequestsStore = create<NodeInputRequestsStore>()(
  devtools(
    immer((set) => ({
      nextId: 1,
      requests: [],

      /** Queues a graph-button add intent for the currently active view. */
      requestAdd: (workspaceId, view, nodeId) => {
        set((state) => {
          if (!workspaceId || !view || !nodeId) return;
          state.requests.push({
            id: state.nextId,
            workspaceId,
            view,
            nodeIds: [nodeId],
          });
          state.nextId += 1;
        });
      },

      /** Removes a consumed request after the active view has handled it. */
      consume: (id) => {
        set((state) => {
          state.requests = state.requests.filter((request) => request.id !== id);
        });
      },
    })),
    { name: 'node-input-requests-store' },
  ),
);
