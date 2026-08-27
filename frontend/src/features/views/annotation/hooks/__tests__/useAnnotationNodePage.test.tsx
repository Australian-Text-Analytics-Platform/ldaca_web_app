import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AnnotationRowFilter, annotationLabelSql } from '../../annotationRowFilter';
import { useAnnotationNodePage } from '../useAnnotationNodePage';

const queryWorkspaceSqlTable = vi.hoisted(() => vi.fn());
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  queryWorkspaceSqlTable,
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe('useAnnotationNodePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryWorkspaceSqlTable.mockResolvedValue({
      rows: [{ text: 'one' }],
      hasNext: true,
      etag: '"revision-1"',
    });
  });

  it('uses one-based node row pagination and forwards the query abort signal', async () => {
    const { result } = renderHook(
      () =>
        useAnnotationNodePage({
          workspaceId: 'workspace-1',
          nodeId: 'node-1',
          sourceSql: 'SELECT * FROM "node-1"',
          sourceColumns: ['text', 'annotation', 'reviewer'],
          annotationColumn: 'annotation',
          comparisonColumns: ['reviewer'],
          classOptions: [],
          filter: null,
          rowCount: 2380,
          pageSize: 10,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.rows).toEqual([{ text: 'one' }]));
    expect(queryWorkspaceSqlTable).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { workspace_id: 'workspace-1' },
        body: expect.objectContaining({
          mode: 'query',
          node_ids: ['node-1'],
          sql: expect.stringContaining('ROW_NUMBER() OVER () - 1'),
          page: 1,
          page_size: 10,
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.current.rowCount).toBe(2380);
  });

  it('keys filtered pages and counts by the server-side column predicate', async () => {
    queryWorkspaceSqlTable.mockImplementation(({ body }) =>
      Promise.resolve(
        body.sql.includes('COUNT(*)')
          ? { rows: [{ __wordflow_annotation_filtered_row_count: 7 }] }
          : { rows: [{ __wordflow_annotation_source_row_index: 12, text: 'different' }] },
      ),
    );

    const { result } = renderHook(
      () =>
        useAnnotationNodePage({
          workspaceId: 'workspace-1',
          nodeId: 'node-1',
          sourceSql: 'SELECT * FROM "node-1"',
          sourceColumns: ['text', 'annotation', 'reviewer_one', 'reviewer_two'],
          annotationColumn: 'annotation',
          comparisonColumns: ['reviewer_one', 'reviewer_two'],
          classOptions: ['covid', 'job'],
          filter: { column: 'reviewer_two', differs: true, existence: 'off' },
          rowCount: 2380,
          pageSize: 10,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.rowCount).toBe(7));
    const sqlRequests = queryWorkspaceSqlTable.mock.calls.map(([request]) => request.body.sql);
    expect(sqlRequests).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `${annotationLabelSql('annotation', ['covid', 'job'])} != ${annotationLabelSql('reviewer_two', ['covid', 'job'])}`,
        ),
        expect.stringContaining('COUNT(*)'),
      ]),
    );
    expect(result.current.rows[0]?.__wordflow_annotation_source_row_index).toBe(12);
  });

  it('resets server pagination when the active row filter changes', async () => {
    const { result, rerender } = renderHook(
      ({ filter }: { filter: AnnotationRowFilter | null }) =>
        useAnnotationNodePage({
          workspaceId: 'workspace-1',
          nodeId: 'node-1',
          sourceSql: 'SELECT * FROM "node-1"',
          sourceColumns: ['text', 'annotation', 'reviewer'],
          annotationColumn: 'annotation',
          comparisonColumns: ['reviewer'],
          classOptions: [],
          filter,
          rowCount: 100,
          pageSize: 10,
        }),
      { initialProps: { filter: null as AnnotationRowFilter | null }, wrapper },
    );

    await waitFor(() => expect(queryWorkspaceSqlTable).toHaveBeenCalled());
    act(() => {
      result.current.setPagination({ pageIndex: 4, pageSize: 10 });
    });
    await waitFor(() =>
      expect(queryWorkspaceSqlTable).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.objectContaining({ page: 5 }) }),
      ),
    );

    rerender({ filter: { column: 'reviewer', differs: true, existence: 'off' } });
    await waitFor(() => {
      const lastRequest = queryWorkspaceSqlTable.mock.calls.at(-1)?.[0];
      expect(lastRequest?.body.page).toBe(1);
      expect(lastRequest?.body.sql).toContain(
        `${annotationLabelSql('annotation', [])} != ${annotationLabelSql('reviewer', [])}`,
      );
    });
  });

  it('retains same-node annotation rows while an uncached page is fetching', async () => {
    const secondPage = deferred<{ rows: { text: string }[]; hasNext: boolean; etag: string }>();
    queryWorkspaceSqlTable
      .mockReset()
      .mockResolvedValueOnce({
        rows: [{ text: 'page-one' }],
        hasNext: true,
        etag: 'page-one',
      })
      .mockReturnValueOnce(secondPage.promise);
    const { result } = renderHook(
      () =>
        useAnnotationNodePage({
          workspaceId: 'workspace-1',
          nodeId: 'node-1',
          sourceSql: 'SELECT * FROM "node-1"',
          sourceColumns: ['text', 'annotation'],
          annotationColumn: 'annotation',
          comparisonColumns: [],
          classOptions: [],
          filter: null,
          rowCount: 20,
          pageSize: 10,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.rows).toEqual([{ text: 'page-one' }]));
    act(() => {
      result.current.setPagination({ pageIndex: 1, pageSize: 10 });
    });

    await waitFor(() => {
      expect(queryWorkspaceSqlTable).toHaveBeenCalledTimes(2);
      expect(result.current.query.isFetching).toBe(true);
    });
    expect(result.current.query.isLoading).toBe(false);
    expect(result.current.rows).toEqual([{ text: 'page-one' }]);

    act(() => {
      secondPage.resolve({
        rows: [{ text: 'page-two' }],
        hasNext: false,
        etag: 'page-two',
      });
    });
    await waitFor(() => expect(result.current.rows).toEqual([{ text: 'page-two' }]));
  });
});
