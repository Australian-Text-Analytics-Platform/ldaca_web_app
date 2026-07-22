import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
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
import { useFilterCategoricalOptionQuery } from '../useFilterCategoricalOptionQuery';

const setupClient = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
};

const categoricalArgs = {
  workspaceId: 'workspace-1',
  nodeId: 'node-1',
  column: 'speaker',
  dataType: 'categorical',
  searchQuery: '',
} as const;

describe('useFilterCategoricalOptionQuery', () => {
  beforeEach(() => {
    queryWorkspaceSqlTableMock.mockReset();
  });

  it('loads one distinct SQL page, preserving null and primitive values', async () => {
    queryWorkspaceSqlTableMock.mockResolvedValue({
      rows: [{ value: null }, { value: 'Alice' }, { value: 'Bob' }],
      columns: ['value'],
      hasNext: false,
      etag: '"revision-1"',
    });
    const { wrapper } = setupClient();
    const view = renderHook(() => useFilterCategoricalOptionQuery(categoricalArgs), { wrapper });

    await waitFor(() => expect(view.result.current.loading).toBe(false));

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
    expect(view.result.current.options.map((option) => option.key)).toEqual([
      NULL_OPTION_KEY,
      'string::Alice',
      'string::Bob',
    ]);
  });

  it('does not query without a complete Workspace/Data Block identity', async () => {
    const { wrapper } = setupClient();
    const view = renderHook(
      () =>
        useFilterCategoricalOptionQuery({
          ...categoricalArgs,
          workspaceId: null,
          nodeId: null,
        }),
      { wrapper },
    );

    await act(async () => Promise.resolve());

    expect(queryWorkspaceSqlTableMock).not.toHaveBeenCalled();
    expect(view.result.current.options).toEqual([]);
  });

  it('accumulates independent pages without duplicating loaded values', async () => {
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
    const { wrapper } = setupClient();
    const view = renderHook(() => useFilterCategoricalOptionQuery(categoricalArgs), { wrapper });

    await waitFor(() => expect(view.result.current.hasNext).toBe(true));
    await act(async () => {
      await view.result.current.loadMore();
    });

    await waitFor(() =>
      expect(view.result.current.options.map((option) => option.value)).toEqual([
        'Alice',
        'Bob',
        'Carol',
      ]),
    );
    expect(queryWorkspaceSqlTableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ page: 2, page_size: 500 }) }),
    );
  });

  it('restarts from page one when a later page has a different Workspace ETag', async () => {
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
    const { wrapper } = setupClient();
    const view = renderHook(() => useFilterCategoricalOptionQuery(categoricalArgs), { wrapper });

    await waitFor(() => expect(view.result.current.hasNext).toBe(true));
    await act(async () => {
      await view.result.current.loadMore();
    });

    await waitFor(() =>
      expect(view.result.current.options.map((option) => option.value)).toEqual(['Current']),
    );
    expect(queryWorkspaceSqlTableMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ body: expect.objectContaining({ page: 1 }) }),
    );
  });

  it('debounces search into a new page-one SQL Query resource', async () => {
    queryWorkspaceSqlTableMock.mockResolvedValue({
      rows: [{ value: 'Alice' }],
      columns: ['value'],
      hasNext: false,
      etag: '"revision-1"',
    });
    const { wrapper } = setupClient();
    const view = renderHook(
      ({ searchQuery }) => useFilterCategoricalOptionQuery({ ...categoricalArgs, searchQuery }),
      { wrapper, initialProps: { searchQuery: '' } },
    );
    await waitFor(() => expect(queryWorkspaceSqlTableMock).toHaveBeenCalledTimes(1));

    view.rerender({ searchQuery: 'ali*' });

    await waitFor(() => expect(queryWorkspaceSqlTableMock).toHaveBeenCalledTimes(2), {
      timeout: 1_000,
    });
    expect(queryWorkspaceSqlTableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          page: 1,
          sql: expect.stringMatching(/~\* .*ali%/),
        }),
      }),
    );
  });
});
