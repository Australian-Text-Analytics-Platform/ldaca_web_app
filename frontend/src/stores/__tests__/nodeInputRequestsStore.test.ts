import { beforeEach, describe, expect, it } from 'vitest';

import { useNodeInputRequestsStore } from '../nodeInputRequestsStore';

describe('nodeInputRequestsStore', () => {
  beforeEach(() => {
    useNodeInputRequestsStore.setState({
      nextId: 1,
      pendingRequests: [],
    });
  });

  it('pushes Data Blocks onto a LIFO placement stack', () => {
    const { requestAdd } = useNodeInputRequestsStore.getState();

    requestAdd('workspace-1', 'annotation', 'node-a', { x: 100, y: 120 });
    requestAdd('workspace-1', 'annotation', 'node-b', { x: 240, y: 260 });

    expect(useNodeInputRequestsStore.getState().pendingRequests).toEqual([
      {
        id: 1,
        workspaceId: 'workspace-1',
        view: 'annotation',
        nodeId: 'node-a',
        pointer: { x: 100, y: 120 },
      },
      {
        id: 2,
        workspaceId: 'workspace-1',
        view: 'annotation',
        nodeId: 'node-b',
        pointer: { x: 240, y: 260 },
      },
    ]);
  });

  it('removes one placed item without disturbing the rest of the stack', () => {
    const { requestAdd } = useNodeInputRequestsStore.getState();

    requestAdd('workspace-1', 'annotation', 'node-a');
    requestAdd('workspace-1', 'annotation', 'node-b');

    useNodeInputRequestsStore.getState().consume(2);

    expect(
      useNodeInputRequestsStore.getState().pendingRequests.map((request) => request.nodeId),
    ).toEqual(['node-a']);
  });

  it('clears the complete carried stack', () => {
    const { requestAdd } = useNodeInputRequestsStore.getState();
    requestAdd('workspace-1', 'annotation', 'node-a');
    requestAdd('workspace-1', 'annotation', 'node-b');

    useNodeInputRequestsStore.getState().clear();

    expect(useNodeInputRequestsStore.getState().pendingRequests).toEqual([]);
  });
});
