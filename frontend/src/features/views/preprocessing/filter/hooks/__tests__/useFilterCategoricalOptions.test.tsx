import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getColumnUniqueValuesMock = vi.hoisted(() => vi.fn());
vi.mock('@/api', () => ({
  getColumnUniqueValues: getColumnUniqueValuesMock,
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
    getColumnUniqueValuesMock.mockReset();
  });

  it('loads and stores categorical options for the active workspace/node/column key', async () => {
    getColumnUniqueValuesMock.mockResolvedValue({
      data: {
        unique_values: ['Alice', 'Bob'],
        has_null: true,
      },
    });

    const { result } = renderHook(() =>
      useFilterCategoricalOptions({
        currentWorkspaceId: 'workspace-1',
        selectedNodeId: 'node-1',
        conditions: [],
        getAuthHeaders: () => ({ Authorization: 'Bearer token' }),
      }),
    );

    await act(async () => {
      await result.current.ensureCategoricalOptions('speaker', 'categorical');
    });

    const key = result.current.getCategoricalKey('speaker');
    expect(getColumnUniqueValuesMock).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer token' },
      path: { workspace_id: 'workspace-1', column_name: 'speaker', node_id: 'node-1' },
      throwOnError: true,
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
        getAuthHeaders: () => ({}),
      }),
    );

    await act(async () => {
      await result.current.ensureCategoricalOptions('speaker', 'categorical');
    });

    expect(getColumnUniqueValuesMock).not.toHaveBeenCalled();
    expect(result.current.categoricalOptions).toEqual({});
  });

  it('auto-loads checklist-backed conditions and resets search state when node changes', async () => {
    getColumnUniqueValuesMock.mockResolvedValue({
      data: {
        unique_values: ['Alice'],
        has_null: false,
      },
    });

    const { result, rerender } = renderHook(
      ({ selectedNodeId, conditions }) =>
        useFilterCategoricalOptions({
          currentWorkspaceId: 'workspace-1',
          selectedNodeId,
          conditions,
          getAuthHeaders: () => ({}),
        }),
      {
        initialProps: {
          selectedNodeId: 'node-1',
          conditions: [categoricalCondition],
        },
      },
    );

    await waitFor(() => {
      expect(getColumnUniqueValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { workspace_id: 'workspace-1', column_name: 'speaker', node_id: 'node-1' },
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
