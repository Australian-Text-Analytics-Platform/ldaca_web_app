import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
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
      nodeInfoCache: {},
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
      nodeInfoCache: {},
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

    expect(onTabInputSetChange).toHaveBeenCalledWith('source', [{ node_id: 'node-a', column: '' }]);
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

  it.each([
    2, 6,
  ])('consumes and rejects queued graph input when the %i-node cap is full', (maxNodes) => {
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
          source: nodes.slice(0, maxNodes).map((node) => ({ node_id: node.id, column: 'text' })),
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

  it.each([
    2, 6,
  ])('normalizes cap %i once with stable identities and capped metadata under StrictMode', (maxNodes) => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      id: `node-${String(index + 1)}`,
      name: `Node ${String(index + 1)}`,
      columns: ['text'],
      schema: { text: 'String' },
    }));
    const rawInputs = nodes.map((node) => ({ node_id: node.id, column: 'text' }));
    const tabInputSets = { source: rawInputs };
    const constraints = { allowedDataTypes: ['string'], maxNodes };
    const onTabInputSetChange = vi.fn();
    mocks.useWorkspaceData.mockReturnValue({ currentWorkspaceId: 'workspace-1', nodes });

    const { result, rerender } = renderHook(
      () =>
        useTabNodeInputs({
          selectorId: 'source',
          tabInputSets,
          onTabInputSetChange,
          constraints,
          consumeNodeInputRequests: false,
        }),
      { wrapper: StrictMode },
    );

    const expectedIds = nodes.slice(-maxNodes).map((node) => node.id);
    const firstInputs = result.current.inputs;
    const firstActions = {
      addNodes: result.current.addNodes,
      getAddRejection: result.current.getAddRejection,
      removeNode: result.current.removeNode,
      clear: result.current.clear,
      setColumn: result.current.setColumn,
    };

    rerender();

    expect(result.current.inputs.map((input) => input.node_id)).toEqual(expectedIds);
    expect(result.current.inputs).toBe(firstInputs);
    expect(result.current.addNodes).toBe(firstActions.addNodes);
    expect(result.current.getAddRejection).toBe(firstActions.getAddRejection);
    expect(result.current.removeNode).toBe(firstActions.removeNode);
    expect(result.current.clear).toBe(firstActions.clear);
    expect(result.current.setColumn).toBe(firstActions.setColumn);
    expect(mocks.useNodeColumnInfos).toHaveBeenCalled();
    mocks.useNodeColumnInfos.mock.calls.forEach(([options]) => {
      expect((options.nodes as { id: string }[]).map((node) => node.id)).toEqual(expectedIds);
    });
    expect(onTabInputSetChange).toHaveBeenCalledOnce();
    expect(onTabInputSetChange.mock.calls[0]?.[0]).toBe('source');
    expect(
      onTabInputSetChange.mock.calls[0]?.[1].map((input: { node_id: string }) => input.node_id),
    ).toEqual(expectedIds);
  });

  it('does not repeat normalization when only the owner callback identity changes', () => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      id: `node-${String(index + 1)}`,
      name: `Node ${String(index + 1)}`,
      columns: ['text'],
      schema: { text: 'String' },
    }));
    const source = nodes.map((node) => ({ node_id: node.id, column: 'text' }));
    const constraints = { allowedDataTypes: ['string'], maxNodes: 2 };
    const firstOwner = vi.fn();
    const secondOwner = vi.fn();
    mocks.useWorkspaceData.mockReturnValue({ currentWorkspaceId: 'workspace-1', nodes });

    const { rerender } = renderHook(
      ({ onTabInputSetChange, source: currentSource }) =>
        useTabNodeInputs({
          tabInputSets: { source: currentSource },
          onTabInputSetChange,
          constraints,
          consumeNodeInputRequests: false,
        }),
      {
        initialProps: { onTabInputSetChange: firstOwner, source },
        wrapper: StrictMode,
      },
    );

    rerender({
      onTabInputSetChange: secondOwner,
      source: source.map((input) => ({ ...input })),
    });

    expect(firstOwner).toHaveBeenCalledOnce();
    expect(secondOwner).not.toHaveBeenCalled();
  });

  it('normalizes a genuinely new over-limit input snapshot', () => {
    const nodes = Array.from({ length: 13 }, (_, index) => ({
      id: `node-${String(index + 1)}`,
      name: `Node ${String(index + 1)}`,
      columns: ['text'],
      schema: { text: 'String' },
    }));
    const constraints = { allowedDataTypes: ['string'], maxNodes: 2 };
    const onTabInputSetChange = vi.fn();
    mocks.useWorkspaceData.mockReturnValue({ currentWorkspaceId: 'workspace-1', nodes });

    const { rerender } = renderHook(
      ({ source }) =>
        useTabNodeInputs({
          tabInputSets: { source },
          onTabInputSetChange,
          constraints,
          consumeNodeInputRequests: false,
        }),
      {
        initialProps: {
          source: nodes.slice(0, 12).map((node) => ({ node_id: node.id, column: 'text' })),
        },
        wrapper: StrictMode,
      },
    );

    rerender({
      source: nodes.slice(1, 13).map((node) => ({ node_id: node.id, column: 'text' })),
    });

    expect(onTabInputSetChange).toHaveBeenCalledTimes(2);
    expect(
      onTabInputSetChange.mock.calls.map(([, inputs]) =>
        inputs.map((input: { node_id: string }) => input.node_id),
      ),
    ).toEqual([
      ['node-11', 'node-12'],
      ['node-12', 'node-13'],
    ]);
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
