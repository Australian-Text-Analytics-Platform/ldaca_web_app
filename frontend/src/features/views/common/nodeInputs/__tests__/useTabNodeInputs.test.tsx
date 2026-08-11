import { act, renderHook } from '@testing-library/react';
import { Field, Utf8 } from 'apache-arrow';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecentSelectionsStore } from '@/stores/recentSelectionsStore';
import { isArrowStringField } from '@/lib/arrow/arrowTable';
import { useTabNodeInputs } from '../useTabNodeInputs';

const mocks = vi.hoisted(() => ({
  useWorkspaceData: vi.fn(),
  useWorkspaceSelection: vi.fn(),
  useNodeColumnInfos: vi.fn(),
  useRecentSelectionsStore: vi.fn(),
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

vi.mock('@/stores/recentSelectionsStore', () => ({
  recentSelectionsScopeKey: (userId: string, workspaceId: string | null) =>
    `${userId}:${workspaceId ?? '__none__'}`,
  useRecentSelectionsStore: mocks.useRecentSelectionsStore,
}));

function recentSelectionsStore(overrides: Partial<RecentSelectionsStore> = {}) {
  const store: RecentSelectionsStore = {
    byScope: {},
    record: vi.fn(),
    pruneWorkspaces: vi.fn(),
    pruneNodes: vi.fn(),
    ...overrides,
  };
  mocks.useRecentSelectionsStore.mockImplementation(
    (selector: (state: RecentSelectionsStore) => unknown) => selector(store),
  );
  return store;
}

const stringColumnInfo = (name: string) => ({
  name,
  typeName: 'Utf8',
  field: new Field(name, new Utf8()),
});

describe('useTabNodeInputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useWorkspaceData.mockReturnValue({
      currentWorkspaceId: 'workspace-1',
      nodes: [
        {
          id: 'node-a',
          name: 'Node A',
        },
      ],
    });
    mocks.useWorkspaceSelection.mockReturnValue({ selectedNodeIds: [] });
    mocks.useNodeColumnInfos.mockReturnValue({
      getColumnInfos: () => [stringColumnInfo('text')],
      nodeInfoById: {},
    });
    recentSelectionsStore();
  });

  it('hydrates an add-before-metadata input into a usable document selection', () => {
    const onTabInputSetChange = vi.fn();
    let metadataHydrated = false;
    mocks.useWorkspaceData.mockImplementation(() => ({
      currentWorkspaceId: 'workspace-1',
      nodes: [
        metadataHydrated
          ? {
              id: 'node-a',
              name: 'Node A',
              color: null,
              document: 'document',
              shape: [null, null],
              tokenizer_model: 'native:plain_words_en',
            }
          : { id: 'node-a', name: 'Node A' },
      ],
    }));
    mocks.useNodeColumnInfos.mockImplementation(() => {
      const nodeInfo = metadataHydrated
        ? {
            id: 'node-a',
            name: 'Node A',
            document: 'document',
            tokenizer_model: 'native:plain_words_en',
          }
        : undefined;
      return {
        getColumnInfos: () =>
          nodeInfo ? [stringColumnInfo('document'), stringColumnInfo('speaker')] : [],
        getNodeInfo: () => nodeInfo,
        nodeInfoById: nodeInfo ? { 'node-a': nodeInfo } : {},
      };
    });
    const { result, rerender } = renderHook(
      ({ source }) =>
        useTabNodeInputs({
          tabInputSets: { source },
          onTabInputSetChange,
          constraints: { fieldPredicate: isArrowStringField, maxNodes: 1, docTypeOnly: true },
        }),
      {
        initialProps: {
          source: [{ node_id: 'node-a', column: '' }],
        },
      },
    );

    metadataHydrated = true;
    rerender({ source: [{ node_id: 'node-a', column: '' }] });

    expect(result.current.selectedNodes[0]).toMatchObject({
      id: 'node-a',
      name: 'Node A',
      document: 'document',
      tokenizerModel: 'native:plain_words_en',
    });
    expect(result.current.nodeColumnSelections).toEqual([{ nodeId: 'node-a', column: 'document' }]);
  });

  it.each([
    2, 6,
  ])('normalizes cap %i once with stable identities and capped metadata under StrictMode', (maxNodes) => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      id: `node-${String(index + 1)}`,
      name: `Node ${String(index + 1)}`,
    }));
    const rawInputs = nodes.map((node) => ({ node_id: node.id, column: 'text' }));
    const tabInputSets = { source: rawInputs };
    const constraints = { fieldPredicate: isArrowStringField, maxNodes };
    const onTabInputSetChange = vi.fn();
    mocks.useWorkspaceData.mockReturnValue({ currentWorkspaceId: 'workspace-1', nodes });

    const { result, rerender } = renderHook(
      () =>
        useTabNodeInputs({
          selectorId: 'source',
          tabInputSets,
          onTabInputSetChange,
          constraints,
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
    }));
    const source = nodes.map((node) => ({ node_id: node.id, column: 'text' }));
    const constraints = { fieldPredicate: isArrowStringField, maxNodes: 2 };
    const firstOwner = vi.fn();
    const secondOwner = vi.fn();
    mocks.useWorkspaceData.mockReturnValue({ currentWorkspaceId: 'workspace-1', nodes });

    const { rerender } = renderHook(
      ({ onTabInputSetChange, source: currentSource }) =>
        useTabNodeInputs({
          tabInputSets: { source: currentSource },
          onTabInputSetChange,
          constraints,
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
    }));
    const constraints = { fieldPredicate: isArrowStringField, maxNodes: 2 };
    const onTabInputSetChange = vi.fn();
    mocks.useWorkspaceData.mockReturnValue({ currentWorkspaceId: 'workspace-1', nodes });

    const { rerender } = renderHook(
      ({ source }) =>
        useTabNodeInputs({
          tabInputSets: { source },
          onTabInputSetChange,
          constraints,
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

  it('writes named selector changes through onTabInputSetChange', () => {
    const onTabInputSetChange = vi.fn();
    const { result } = renderHook(() =>
      useTabNodeInputs({
        selectorId: 'classDescriptions',
        tabInputSets: { classDescriptions: [] },
        onTabInputSetChange,
        constraints: { fieldPredicate: isArrowStringField, maxNodes: 1 },
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
