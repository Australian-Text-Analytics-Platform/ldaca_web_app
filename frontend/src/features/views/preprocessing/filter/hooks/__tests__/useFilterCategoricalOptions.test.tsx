import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryWorkspaceSqlTableMock = vi.hoisted(() => vi.fn());
vi.mock('@/api', () => ({
  queryWorkspaceSqlTable: queryWorkspaceSqlTableMock,
  sqlGlobPattern: (value: string) => value.replaceAll('*', '%').replaceAll('?', '_'),
  sqlIdentifier: (value: string) => `"${value}"`,
  sqlString: (value: string) => `'${value}'`,
  sqlTable: (value: string) => `"${value}"`,
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
    queryWorkspaceSqlTableMock.mockReset();
  });

  it('loads and stores categorical options for the active workspace/node/column key', async () => {
    queryWorkspaceSqlTableMock.mockResolvedValue({
      rows: [{ value: null }, { value: 'Alice' }, { value: 'Bob' }],
      columns: ['value'],
      hasNext: false,
      etag: '"revision-1"',
    });

    const { result } = renderHook(() =>
      useFilterCategoricalOptions({
        currentWorkspaceId: 'workspace-1',
        selectedNodeId: 'node-1',
        conditions: [],
        columnOptions: [],
      }),
    );

    await act(async () => {
      await result.current.ensureCategoricalOptions('speaker', 'categorical');
    });

    const key = result.current.getCategoricalKey('speaker');
    expect(queryWorkspaceSqlTableMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { workspace_id: 'workspace-1' },
        body: expect.objectContaining({
          mode: 'query',
          node_ids: ['node-1'],
          page: 1,
          page_size: 500,
          sql: expect.stringContaining('SELECT DISTINCT "value"'),
        }),
      }),
    );
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
        columnOptions: [],
      }),
    );

    await act(async () => {
      await result.current.ensureCategoricalOptions('speaker', 'categorical');
    });

    expect(queryWorkspaceSqlTableMock).not.toHaveBeenCalled();
    expect(result.current.categoricalOptions).toEqual({});
  });

  it('auto-loads checklist-backed conditions and resets search state when node changes', async () => {
    queryWorkspaceSqlTableMock.mockResolvedValue({
      rows: [{ value: 'Alice' }],
      columns: ['value'],
      hasNext: false,
      etag: '"revision-1"',
    });

    const { result, rerender } = renderHook(
      ({ selectedNodeId, conditions }) =>
        useFilterCategoricalOptions({
          currentWorkspaceId: 'workspace-1',
          selectedNodeId,
          conditions,
          columnOptions: [],
        }),
      {
        initialProps: {
          selectedNodeId: 'node-1',
          conditions: [categoricalCondition],
        },
      },
    );

    await waitFor(() => {
      expect(queryWorkspaceSqlTableMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { workspace_id: 'workspace-1' },
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

  it('accumulates later pages without duplicating already loaded values', async () => {
    queryWorkspaceSqlTableMock
      .mockResolvedValueOnce({
        rows: [{ value: 'Alice' }, { value: 'Bob' }],
        columns: ['value'],
        hasNext: true,
        etag: '"revision-1"',
      })
      .mockResolvedValueOnce({
        rows: [{ value: 'Bob' }, { value: 'Carol' }],
        columns: ['value'],
        hasNext: false,
        etag: '"revision-1"',
      });

    const { result } = renderHook(() =>
      useFilterCategoricalOptions({
        currentWorkspaceId: 'workspace-1',
        selectedNodeId: 'node-1',
        conditions: [],
        columnOptions: [],
      }),
    );

    await act(async () => {
      await result.current.ensureCategoricalOptions('speaker', 'categorical');
    });
    await act(async () => {
      await result.current.loadMoreCategoricalOptions('speaker', 'categorical');
    });

    const state = result.current.categoricalOptions[result.current.getCategoricalKey('speaker')];
    expect(state?.options.map((option) => option.value)).toEqual(['Alice', 'Bob', 'Carol']);
    expect(state).toMatchObject({ page: 2, hasNext: false, etag: '"revision-1"' });
    expect(queryWorkspaceSqlTableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ page: 2, page_size: 500 }) }),
    );
  });

  it('restarts from page one when a later page observes a different Workspace ETag', async () => {
    queryWorkspaceSqlTableMock
      .mockResolvedValueOnce({
        rows: [{ value: 'Alice' }],
        columns: ['value'],
        hasNext: true,
        etag: '"revision-1"',
      })
      .mockResolvedValueOnce({
        rows: [{ value: 'stale' }],
        columns: ['value'],
        hasNext: false,
        etag: '"revision-2"',
      })
      .mockResolvedValueOnce({
        rows: [{ value: 'Current' }],
        columns: ['value'],
        hasNext: false,
        etag: '"revision-2"',
      });

    const { result } = renderHook(() =>
      useFilterCategoricalOptions({
        currentWorkspaceId: 'workspace-1',
        selectedNodeId: 'node-1',
        conditions: [],
        columnOptions: [],
      }),
    );

    await act(async () => {
      await result.current.ensureCategoricalOptions('speaker', 'categorical');
    });
    await act(async () => {
      await result.current.loadMoreCategoricalOptions('speaker', 'categorical');
    });

    const state = result.current.categoricalOptions[result.current.getCategoricalKey('speaker')];
    expect(state?.options.map((option) => option.value)).toEqual(['Current']);
    expect(state).toMatchObject({ page: 1, etag: '"revision-2"' });
    expect(queryWorkspaceSqlTableMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ body: expect.objectContaining({ page: 1 }) }),
    );
  });

  it('debounces search into a fresh server-side page-one query', async () => {
    queryWorkspaceSqlTableMock.mockResolvedValue({
      rows: [{ value: 'Alice' }],
      columns: ['value'],
      hasNext: false,
      etag: '"revision-1"',
    });

    const { result } = renderHook(() =>
      useFilterCategoricalOptions({
        currentWorkspaceId: 'workspace-1',
        selectedNodeId: 'node-1',
        conditions: [categoricalCondition],
        columnOptions: [],
      }),
    );
    await waitFor(() => expect(queryWorkspaceSqlTableMock).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.setOptionSearchQuery('condition-1', 'ali');
    });
    await waitFor(() => expect(queryWorkspaceSqlTableMock).toHaveBeenCalledTimes(2), {
      timeout: 1_000,
    });

    expect(queryWorkspaceSqlTableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          page: 1,
          sql: expect.stringMatching(/~\* .*ali/),
        }),
      }),
    );
  });

  it('does not reload options when only the selected condition values change', async () => {
    queryWorkspaceSqlTableMock.mockResolvedValue({
      rows: [{ value: 'Alice' }, { value: 'Bob' }],
      columns: ['value'],
      hasNext: false,
      etag: '"revision-1"',
    });

    const { result, rerender } = renderHook(
      ({ conditions }) =>
        useFilterCategoricalOptions({
          currentWorkspaceId: 'workspace-1',
          selectedNodeId: 'node-1',
          conditions,
          columnOptions: [],
        }),
      { initialProps: { conditions: [categoricalCondition] } },
    );
    await waitFor(() => expect(queryWorkspaceSqlTableMock).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.resetOptionSearchQuery('condition-1');
    });
    await waitFor(() => expect(queryWorkspaceSqlTableMock).toHaveBeenCalledTimes(2), {
      timeout: 1_000,
    });

    rerender({
      conditions: [{ ...categoricalCondition, value: ['Alice'] }],
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    });

    expect(queryWorkspaceSqlTableMock).toHaveBeenCalledTimes(2);
  });
});
