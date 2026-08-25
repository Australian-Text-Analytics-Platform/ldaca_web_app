import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { tableFromArrays } from 'apache-arrow';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ArrowTablePage } from '@/lib/arrow/arrowTable';
import { createNodeDataRequest } from '@/lib/queryKeys';

import { useQuotationPage } from '../useQuotationPage';

const queryQuotationPreviewArrowTable = vi.hoisted(() => vi.fn());
vi.mock('@/api/tableApi', async (importOriginal) => ({
  ...(await importOriginal()),
  queryQuotationPreviewArrowTable,
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
});
