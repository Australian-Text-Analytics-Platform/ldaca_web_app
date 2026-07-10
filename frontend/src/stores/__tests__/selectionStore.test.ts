import { beforeEach, describe, expect, it } from 'vitest';
import { useSelectionStore } from '../selectionStore';

describe('useSelectionStore', () => {
  beforeEach(() => {
    useSelectionStore.setState({
      currentWorkspaceId: null,
      activeNodeId: null,
      selectedNodeIds: [],
    });
  });

  it('removes a non-active node without changing the active node', () => {
    const store = useSelectionStore.getState();
    store.replaceSelectedNodes(['node-a', 'node-b', 'node-c'], 'node-b');

    useSelectionStore.getState().removeNode('node-a');

    expect(useSelectionStore.getState()).toMatchObject({
      activeNodeId: 'node-b',
      selectedNodeIds: ['node-b', 'node-c'],
    });
  });

  it('activates the nearest remaining tab when the active node is removed', () => {
    const store = useSelectionStore.getState();
    store.replaceSelectedNodes(['node-a', 'node-b', 'node-c'], 'node-b');

    useSelectionStore.getState().removeNode('node-b');

    expect(useSelectionStore.getState()).toMatchObject({
      activeNodeId: 'node-c',
      selectedNodeIds: ['node-a', 'node-c'],
    });
  });

  it('uses the reordered tab position when choosing a deletion fallback', () => {
    const store = useSelectionStore.getState();
    store.replaceSelectedNodes(['node-a', 'node-b', 'node-c'], 'node-c');
    store.reorderSelectedNodes(['node-c', 'node-a', 'node-b']);

    useSelectionStore.getState().removeNode('node-c');

    expect(useSelectionStore.getState()).toMatchObject({
      activeNodeId: 'node-a',
      selectedNodeIds: ['node-a', 'node-b'],
    });
  });

  it('reorders membership without changing the active node', () => {
    const store = useSelectionStore.getState();
    store.replaceSelectedNodes(['node-a', 'node-b', 'node-c'], 'node-b');

    store.reorderSelectedNodes(['node-c', 'node-a', 'node-b']);

    expect(useSelectionStore.getState()).toMatchObject({
      activeNodeId: 'node-b',
      selectedNodeIds: ['node-c', 'node-a', 'node-b'],
    });
  });

  it('does not add or reorder membership when activating an absent node', () => {
    const store = useSelectionStore.getState();
    store.replaceSelectedNodes(['node-a', 'node-b'], 'node-a');

    store.activateNode('node-missing');

    expect(useSelectionStore.getState()).toMatchObject({
      activeNodeId: 'node-a',
      selectedNodeIds: ['node-a', 'node-b'],
    });
  });
});
