import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getNodeRowsTableMock = vi.hoisted(() => vi.fn());
vi.mock('@/api', () => ({
  getNodeRowsTable: getNodeRowsTableMock,
}));

import { NULL_OPTION_KEY } from '../../utils/categoricalOptions';
import type { FilterConditionWithId } from '../../../types';
import { useFilterCategoricalOptions } from '../useFilterCategoricalOptions';

const categoricalCondition: FilterConditionWithId = {
  id: 'condition-1',
  column: 'speaker',
  operator: 'in',
  value: [],
  dataType: 'categorical',
  negate: false,
  regex: false,
  caseSensitive: false,
};

describe('useFilterCategoricalOptions', () => {
  beforeEach(() => {
    getNodeRowsTableMock.mockReset();
  });

  it('loads and stores categorical options for the active workspace/node/column key', async () => {
    getNodeRowsTableMock.mockResolvedValue({
      rows: [{ speaker: 'Alice' }, { speaker: 'Bob' }, { speaker: null }],
      columns: ['speaker'],
      hasNext: false,
    });

    const { result } = renderHook(() =>
      useFilterCategoricalOptions({
        currentWorkspaceId: 'workspace-1',
        selectedNodeId: 'node-1',
        conditions: [],
      }),
    );

    await act(async () => {
      await result.current.ensureCategoricalOptions('speaker', 'categorical');
    });

    const key = result.current.getCategoricalKey('speaker');
    expect(getNodeRowsTableMock).toHaveBeenCalledWith({
      path: { workspace_id: 'workspace-1', node_id: 'node-1' },
      query: { page: 1, page_size: 1000 },
    });
    expect(result.current.categoricalOptions[key]).toMatchObject({
      hasNull: true,
      loading: false,
      error: null,
    });
    expect(result.current.categoricalOptions[key]?.options.map((option) => option.key)).toEqual([
      NULL_OPTION_KEY,
      'string::Alice',
      'string::Bob',
    ]);
  });

  it('skips loading without an active workspace and node', async () => {
    const { result } = renderHook(() =>
      useFilterCategoricalOptions({
        currentWorkspaceId: null,
        selectedNodeId: null,
        conditions: [],
      }),
    );

    await act(async () => {
      await result.current.ensureCategoricalOptions('speaker', 'categorical');
    });

    expect(getNodeRowsTableMock).not.toHaveBeenCalled();
    expect(result.current.categoricalOptions).toEqual({});
  });

  it('auto-loads checklist-backed conditions and resets search state when node changes', async () => {
    getNodeRowsTableMock.mockResolvedValue({
      rows: [{ speaker: 'Alice' }],
      columns: ['speaker'],
      hasNext: false,
    });

    const { result, rerender } = renderHook(
      ({ selectedNodeId, conditions }) =>
        useFilterCategoricalOptions({
          currentWorkspaceId: 'workspace-1',
          selectedNodeId,
          conditions,
        }),
      {
        initialProps: {
          selectedNodeId: 'node-1',
          conditions: [categoricalCondition],
        },
      },
    );

    await waitFor(() => {
      expect(getNodeRowsTableMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { workspace_id: 'workspace-1', node_id: 'node-1' },
        }),
      );
    });

    act(() => {
      result.current.setOptionSearchQuery('condition-1', 'ali');
    });
    expect(result.current.optionSearchQueries).toEqual({ 'condition-1': 'ali' });

    rerender({
      selectedNodeId: 'node-2',
      conditions: [categoricalCondition],
    });

    await waitFor(() => {
      expect(result.current.optionSearchQueries).toEqual({});
    });
  });
});
