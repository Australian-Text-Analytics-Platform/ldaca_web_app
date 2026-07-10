import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import type { RecentSelectionsStore } from '@/stores/recentSelectionsStore';
import { useTabNodeInputs } from '../useTabNodeInputs';

const mocks = vi.hoisted(() => ({
  useWorkspaceData: vi.fn(),
  useWorkspaceSelection: vi.fn(),
  useNodeColumnInfos: vi.fn(),
  useNodeInputRequestsStore: vi.fn(),
  useRecentSelectionsStore: vi.fn(),
  useUIStore: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: mocks.useWorkspaceData,
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceSelection', () => ({
  useWorkspaceSelection: mocks.useWorkspaceSelection,
}));

vi.mock('@/features/workspace/common/hooks/useNodeColumnInfos', () => ({
  useNodeColumnInfos: mocks.useNodeColumnInfos,
}));

vi.mock('@/stores/nodeInputRequestsStore', () => ({
  useNodeInputRequestsStore: mocks.useNodeInputRequestsStore,
}));

vi.mock('@/stores/recentSelectionsStore', () => ({
  useRecentSelectionsStore: mocks.useRecentSelectionsStore,
}));

vi.mock('@/stores', () => ({
  useUIStore: mocks.useUIStore,
}));

vi.mock('sonner', () => ({
  toast: {
    warning: mocks.toastWarning,
  },
}));

function nodeInputRequestsStore(
  overrides: Partial<NodeInputRequestsStore> = {},
): NodeInputRequestsStore {
  const store: NodeInputRequestsStore = {
    nextId: 1,
    requests: [],
    requestAdd: vi.fn(),
    consume: vi.fn(),
    ...overrides,
  };
  mocks.useNodeInputRequestsStore.mockImplementation(
    (selector: (state: NodeInputRequestsStore) => unknown) => selector(store),
  );
  return store;
}

function recentSelectionsStore(overrides: Partial<RecentSelectionsStore> = {}) {
  const store: RecentSelectionsStore = {
    byWorkspace: {},
    record: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  };
  mocks.useRecentSelectionsStore.mockImplementation(
    (selector: (state: RecentSelectionsStore) => unknown) => selector(store),
  );
  return store;
}

describe('useTabNodeInputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useWorkspaceData.mockReturnValue({
      currentWorkspaceId: 'workspace-1',
      nodes: [
        {
          id: 'node-a',
          name: 'Node A',
          columns: ['text'],
          schema: { text: 'String' },
        },
      ],
    });
    mocks.useWorkspaceSelection.mockReturnValue({ selectedNodeIds: [] });
    mocks.useNodeColumnInfos.mockReturnValue({
      getColumnInfos: () => [{ name: 'text', dataType: 'string' }],
    });
    mocks.useUIStore.mockImplementation((selector: (state: { currentView: string }) => unknown) =>
      selector({ currentView: 'annotation' }),
    );
    nodeInputRequestsStore();
    recentSelectionsStore();
  });

  it('does not consume graph add requests queued for another active view', () => {
    const consume = vi.fn();
    const onTabInputSetChange = vi.fn();
    nodeInputRequestsStore({
      requests: [{ id: 7, workspaceId: 'workspace-1', view: 'quotation', nodeIds: ['node-a'] }],
      consume,
    });

    renderHook(() =>
      useTabNodeInputs({
        tabInputSets: { source: [] },
        onTabInputSetChange,
        constraints: { allowedDataTypes: ['string'], maxNodes: 1 },
      }),
    );

    expect(onTabInputSetChange).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it('consumes current-view graph add requests by default', () => {
    const consume = vi.fn();
    const onTabInputSetChange = vi.fn();
    nodeInputRequestsStore({
      requests: [{ id: 8, workspaceId: 'workspace-1', view: 'annotation', nodeIds: ['node-a'] }],
      consume,
    });

    renderHook(() =>
      useTabNodeInputs({
        tabInputSets: { source: [] },
        onTabInputSetChange,
        constraints: { allowedDataTypes: ['string'], maxNodes: 1 },
      }),
    );

    expect(onTabInputSetChange).toHaveBeenCalledWith('source', [
      { node_id: 'node-a', column: 'text' },
    ]);
    expect(consume).toHaveBeenCalledWith(8);
  });

  it('adds current-view graph requests even when no matching column is known yet', () => {
    const consume = vi.fn();
    const onTabInputSetChange = vi.fn();
    mocks.useWorkspaceData.mockReturnValue({
      currentWorkspaceId: 'workspace-1',
      nodes: [
        {
          id: 'node-a',
          name: 'Node A',
          columns: [],
        },
      ],
    });
    mocks.useNodeColumnInfos.mockReturnValue({
      getColumnInfos: () => [],
    });
    nodeInputRequestsStore({
      requests: [{ id: 11, workspaceId: 'workspace-1', view: 'annotation', nodeIds: ['node-a'] }],
      consume,
    });

    renderHook(() =>
      useTabNodeInputs({
        tabInputSets: { source: [] },
        onTabInputSetChange,
        constraints: { allowedDataTypes: ['string'], maxNodes: 1 },
      }),
    );

    expect(onTabInputSetChange).toHaveBeenCalledWith('source', [
      { node_id: 'node-a', column: '' },
    ]);
    expect(consume).toHaveBeenCalledWith(11);
  });

  it('toasts structural rejections from directly consumed graph add requests', () => {
    const consume = vi.fn();
    const onTabInputSetChange = vi.fn();
    mocks.useWorkspaceData.mockReturnValue({
      currentWorkspaceId: 'workspace-1',
      nodes: [
        {
          id: 'node-a',
          name: 'Node A',
          columns: ['text'],
          schema: { text: 'String' },
        },
        {
          id: 'node-b',
          name: 'Node B',
          columns: ['text'],
          schema: { text: 'String' },
        },
      ],
    });
    nodeInputRequestsStore({
      requests: [{ id: 12, workspaceId: 'workspace-1', view: 'annotation', nodeIds: ['node-b'] }],
      consume,
    });

    renderHook(() =>
      useTabNodeInputs({
        tabInputSets: { source: [{ node_id: 'node-a', column: 'text' }] },
        onTabInputSetChange,
        constraints: { allowedDataTypes: ['string'], maxNodes: 1 },
      }),
    );

    expect(onTabInputSetChange).not.toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledWith(expect.stringContaining('single node'));
    expect(consume).toHaveBeenCalledWith(12);
  });

  it.each([2, 6])('consumes and rejects queued graph input when the %i-node cap is full', (maxNodes) => {
    const nodes = Array.from({ length: maxNodes + 1 }, (_, index) => ({
      id: `node-${String(index + 1)}`,
      name: `Node ${String(index + 1)}`,
      columns: ['text'],
      schema: { text: 'String' },
    }));
    const consume = vi.fn();
    const onTabInputSetChange = vi.fn();
    mocks.useWorkspaceData.mockReturnValue({ currentWorkspaceId: 'workspace-1', nodes });
    nodeInputRequestsStore({
      requests: [
        {
          id: maxNodes,
          workspaceId: 'workspace-1',
          view: 'annotation',
          nodeIds: [`node-${String(maxNodes + 1)}`],
        },
      ],
      consume,
    });

    renderHook(() =>
      useTabNodeInputs({
        tabInputSets: {
          source: nodes
            .slice(0, maxNodes)
            .map((node) => ({ node_id: node.id, column: 'text' })),
        },
        onTabInputSetChange,
        constraints: { allowedDataTypes: ['string'], maxNodes },
      }),
    );

    expect(onTabInputSetChange).not.toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      `Couldn't add node: This view accepts at most ${String(maxNodes)} nodes`,
    );
    expect(consume).toHaveBeenCalledWith(maxNodes);
  });

  it.each([2, 6])('persists restored over-limit inputs through the named tab owner at cap %i', (maxNodes) => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      id: `node-${String(index + 1)}`,
      name: `Node ${String(index + 1)}`,
      columns: ['text'],
      schema: { text: 'String' },
    }));
    const onTabInputSetChange = vi.fn();
    mocks.useWorkspaceData.mockReturnValue({ currentWorkspaceId: 'workspace-1', nodes });

    const { result } = renderHook(() =>
      useTabNodeInputs({
        selectorId: 'source',
        tabInputSets: {
          source: nodes.map((node) => ({ node_id: node.id, column: 'text' })),
        },
        onTabInputSetChange,
        constraints: { allowedDataTypes: ['string'], maxNodes },
        consumeNodeInputRequests: false,
      }),
    );

    const expectedIds = nodes.slice(-maxNodes).map((node) => node.id);
    expect(result.current.inputs.map((input) => input.node_id)).toEqual(expectedIds);
    expect(onTabInputSetChange).toHaveBeenCalledOnce();
    expect(onTabInputSetChange.mock.calls[0]?.[0]).toBe('source');
    expect(
      onTabInputSetChange.mock.calls[0]?.[1].map((input: { node_id: string }) => input.node_id),
    ).toEqual(expectedIds);
  });

  it('leaves current-view add requests pending when direct consumption is disabled', () => {
    const consume = vi.fn();
    const onTabInputSetChange = vi.fn();
    nodeInputRequestsStore({
      requests: [{ id: 10, workspaceId: 'workspace-1', view: 'annotation', nodeIds: ['node-a'] }],
      consume,
    });

    renderHook(() =>
      useTabNodeInputs({
        tabInputSets: { source: [] },
        onTabInputSetChange,
        constraints: { allowedDataTypes: ['string'], maxNodes: 1 },
        consumeNodeInputRequests: false,
      }),
    );

    expect(onTabInputSetChange).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it('writes named selector changes through onTabInputSetChange', () => {
    const onTabInputSetChange = vi.fn();
    const { result } = renderHook(() =>
      useTabNodeInputs({
        selectorId: 'classDescriptions',
        tabInputSets: { classDescriptions: [] },
        onTabInputSetChange,
        constraints: { allowedDataTypes: ['string'], maxNodes: 1 },
        consumeNodeInputRequests: false,
      }),
    );

    act(() => {
      result.current.addNodes(['node-a']);
    });

    expect(onTabInputSetChange).toHaveBeenCalledWith('classDescriptions', [
      { node_id: 'node-a', column: 'text' },
    ]);
  });
});
