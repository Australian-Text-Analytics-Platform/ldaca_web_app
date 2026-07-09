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
