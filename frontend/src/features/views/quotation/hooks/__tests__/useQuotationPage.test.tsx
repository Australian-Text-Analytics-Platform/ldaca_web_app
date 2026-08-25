import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { tableFromArrays } from 'apache-arrow';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ArrowTablePage } from '@/lib/arrow/arrowTable';
import { createNodeDataRequest } from '@/lib/queryKeys';

import { useQuotationPage } from '../useQuotationPage';

const queryQuotationPreviewArrowTable = vi.hoisted(() => vi.fn());
const fetchArrowTablePage = vi.hoisted(() => vi.fn());
vi.mock('@/api/tableApi', async (importOriginal) => ({
  ...(await importOriginal()),
  queryQuotationPreviewArrowTable,
}));
vi.mock('@/lib/arrow/arrowTable', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchArrowTablePage,
}));

const emptyPage = (): ArrowTablePage => ({
  table: tableFromArrays({ text: [] }),
  columns: ['text'],
  schema: [],
  rows: [],
  hasNext: true,
  totalRows: 100,
  etag: null,
});

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const runAllTarget = {
  kind: 'run_all' as const,
  workspaceId: 'workspace-1',
  analysisId: 'analysis-1',
  rowUnit: 'documents' as const,
  source: {
    node_id: 'node-1',
    node_name: 'Corpus',
    document_column: 'text',
    metadata_columns: [],
    analysis_columns: [],
    internal_columns: [],
    document_count: 100,
    match_count: 20,
    table: {
      delivery: 'projected' as const,
      table_id: 'quotation-run-all',
      documents: { rows_url: '/documents/rows', schema_url: '/documents/schema' },
      matches: { rows_url: '/matches/rows', schema_url: '/matches/schema' },
      density_url: null,
    },
  },
};

describe('useQuotationPage', () => {
  it('keys Preview by Analysis, semantic table, row unit and the complete request', async () => {
    queryQuotationPreviewArrowTable.mockResolvedValueOnce(emptyPage());
    const request = createNodeDataRequest({
      page: 2,
      page_size: 50,
      sort_by: 'text',
      descending: true,
    });
    const { client, wrapper } = setup();
    const { result } = renderHook(
      () =>
        useQuotationPage(
          {
            kind: 'preview',
            workspaceId: 'workspace-1',
            analysisId: 'analysis-1',
            nodeId: 'node-1',
            documentColumn: 'text',
          },
          request,
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryCache().getAll()[0]?.queryKey).toEqual([
      'workspaces',
      'workspace-1',
      'analyses',
      'analysis-1',
      'results',
      'tables',
      'quotation-preview',
      'projections',
      'documents',
      request,
    ]);
    expect(result.current.data?.pagination.has_next).toBe(true);
  });

  it('surfaces Preview transport errors through the shared query', async () => {
    queryQuotationPreviewArrowTable.mockRejectedValueOnce(new Error('IPC unavailable'));
    const { wrapper } = setup();
    const { result } = renderHook(
      () =>
        useQuotationPage(
          {
            kind: 'preview',
            workspaceId: 'workspace-1',
            analysisId: 'analysis-1',
            nodeId: 'node-1',
            documentColumn: 'text',
          },
          createNodeDataRequest({ page: 1, page_size: 50 }),
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.error).toEqual(new Error('IPC unavailable')));
  });

  it('retains a Run All page while an uncached same-owner request is pending', async () => {
    const nextPage = deferred<ArrowTablePage>();
    fetchArrowTablePage
      .mockResolvedValueOnce(emptyPage())
      .mockReturnValueOnce(nextPage.promise);
    let request = createNodeDataRequest({ page: 1, page_size: 20 });
    const { wrapper } = setup();
    const { result, rerender } = renderHook(() => useQuotationPage(runAllTarget, request), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const firstPage = result.current.data;

    request = createNodeDataRequest({
      page: 1,
      page_size: 20,
      sort_by: 'text',
      descending: false,
    });
    rerender();

    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data).toBe(firstPage);

    act(() => {
      nextPage.resolve(emptyPage());
    });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
  });

  it('does not retain a page across Run All ownership changes', async () => {
    const nextPage = deferred<ArrowTablePage>();
    fetchArrowTablePage
      .mockResolvedValueOnce(emptyPage())
      .mockReturnValueOnce(nextPage.promise);
    let target = runAllTarget;
    const request = createNodeDataRequest({ page: 1, page_size: 20 });
    const { wrapper } = setup();
    const { result, rerender } = renderHook(() => useQuotationPage(target, request), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    target = {
      ...runAllTarget,
      analysisId: 'analysis-2',
      source: {
        ...runAllTarget.source,
        table: { ...runAllTarget.source.table, table_id: 'quotation-run-all-2' },
      },
    };
    rerender();

    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
