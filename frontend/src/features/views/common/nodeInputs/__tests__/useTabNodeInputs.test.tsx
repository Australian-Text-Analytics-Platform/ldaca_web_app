import { act, renderHook } from '@testing-library/react';
import { Field, Utf8 } from 'apache-arrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isArrowStringField } from '@/lib/arrow/arrowTable';
import { useTabNodeInputs } from '../useTabNodeInputs';

const mocks = vi.hoisted(() => ({
  useWorkspaceData: vi.fn(),
  useNodeColumnInfos: vi.fn(),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: mocks.useWorkspaceData,
}));

vi.mock('@/features/workspace/common/hooks/useNodeColumnInfos', () => ({
  useNodeColumnInfos: mocks.useNodeColumnInfos,
}));

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
    mocks.useNodeColumnInfos.mockReturnValue({
      getColumnInfos: () => [stringColumnInfo('text')],
      nodeInfoById: {},
    });
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
