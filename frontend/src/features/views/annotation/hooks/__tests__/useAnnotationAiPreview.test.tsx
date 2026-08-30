import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Dictionary, Field, Int32, Int64, Utf8 } from 'apache-arrow';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnnotationAiPreview } from '../useAnnotationAiPreview';

const queryPreview = vi.hoisted(() => vi.fn());
const queryWorkspaceSqlTable = vi.hoisted(() => vi.fn());
vi.mock('@/features/provider-credentials/providerCredentialRequests', () => ({
  queryAnnotationPreviewWithProviderCredential: queryPreview,
}));
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  queryWorkspaceSqlTable,
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const args = {
  workspaceId: 'workspace-1',
  analysisId: 'analysis-1',
  providerConfigurationId: 'provider-1',
  nodeId: 'node-1',
  textColumn: 'text',
  annotationColumn: 'label',
  enabled: true,
};

describe('useAnnotationAiPreview', () => {
  beforeEach(() => {
    queryPreview.mockReset();
    queryPreview.mockResolvedValue({
      data: {
        kind: 'annotation',
        result: {
          variant: 'queried',
          node_id: 'node-1',
          rows: [{ text: 'hello', label: null }],
          labels: [{ row_index: 0, label: 'greeting' }],
          total_rows: 1,
          page: 1,
          page_size: 10,
          query: { kind: 'annotation', page: 1, page_size: 10 },
        },
      },
    });
    queryWorkspaceSqlTable.mockReset();
    queryWorkspaceSqlTable.mockResolvedValue({
      rows: [{ text: 'hello', label: null, review: 'greeting', tweet_id: 1 }],
      columns: ['text', 'label', 'review', 'tweet_id'],
      schema: [
        { name: 'text', field: new Field('text', new Utf8()) },
        { name: 'label', field: new Field('label', new Utf8()) },
        {
          name: 'review',
          field: new Field('review', new Dictionary(new Utf8(), new Int32())),
        },
        { name: 'tweet_id', field: new Field('tweet_id', new Int64()) },
      ],
      hasNext: false,
    });
  });

  it('queries a fresh page from the durable Preview Analysis', async () => {
    const { result } = renderHook(() => useAnnotationAiPreview(args), { wrapper });
    await waitFor(() => expect(queryPreview).toHaveBeenCalledTimes(1));
    expect(queryPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        analysisId: 'analysis-1',
        providerConfigurationId: 'provider-1',
        page: 1,
        pageSize: 10,
      }),
    );
    await waitFor(() => expect(result.current.predictions.labels).toEqual(['greeting']));
  });

  it('loads the complete current source page for corrections and comparisons', async () => {
    const { result } = renderHook(() => useAnnotationAiPreview(args), { wrapper });

    await waitFor(() => expect(result.current.page.rows[0]?.review).toBe('greeting'));
    expect(result.current.sourceColumns).toEqual(['text', 'label', 'review', 'tweet_id']);
    expect(result.current.sourceComparableColumns).toEqual(['text', 'label', 'review']);
    expect(queryWorkspaceSqlTable).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { workspace_id: 'workspace-1' },
        body: expect.objectContaining({
          node_ids: ['node-1'],
          page: 1,
          page_size: 10,
        }),
      }),
    );
  });

  it('requests the selected page without retaining a previous projection', async () => {
    const { result } = renderHook(() => useAnnotationAiPreview(args), { wrapper });
    await waitFor(() => expect(queryPreview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.page.rows).toHaveLength(1));
    let resolveSecondPage: (value: Awaited<ReturnType<typeof queryPreview>>) => void = () =>
      undefined;
    queryPreview.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecondPage = resolve;
      }),
    );
    act(() => {
      result.current.page.setPagination({ pageIndex: 1, pageSize: 10 });
    });
    await waitFor(() => expect(queryPreview).toHaveBeenCalledTimes(2));
    expect(queryPreview.mock.calls[1]?.[0].page).toBe(2);
    expect(result.current.page.rows).toEqual([]);
    expect(result.current.page.rowCount).toBe(20);

    resolveSecondPage({
      data: {
        kind: 'annotation',
        result: {
          variant: 'queried',
          node_id: 'node-1',
          rows: [{ text: 'second page', label: null }],
          labels: [{ row_index: 10, label: 'other' }],
          total_rows: 11,
          page: 2,
          page_size: 10,
          query: { kind: 'annotation', page: 2, page_size: 10 },
        },
      },
    });
    await waitFor(() =>
      expect(result.current.page.rows).toEqual([
        { text: 'second page', label: null, review: 'greeting', tweet_id: 1 },
      ]),
    );
  });

  it('recomputes a previously visited page from the same page projection', async () => {
    queryPreview.mockImplementation(({ page }: { page: number }) =>
      Promise.resolve({
        data: {
          kind: 'annotation',
          result: {
            variant: 'queried',
            node_id: 'node-1',
            rows: [{ text: page === 1 ? 'first page' : 'second page', label: null }],
            labels: [{ row_index: page === 1 ? 0 : 10, label: page === 1 ? 'first' : 'second' }],
            total_rows: 11,
            page,
            page_size: 10,
            query: { kind: 'annotation', page, page_size: 10 },
          },
        },
      }),
    );

    const { result } = renderHook(() => useAnnotationAiPreview(args), { wrapper });
    await waitFor(() => expect(result.current.predictions.labels).toEqual(['first']));

    act(() => {
      result.current.page.setPagination({ pageIndex: 1, pageSize: 10 });
    });
    await waitFor(() => expect(result.current.predictions.labels).toEqual(['second']));

    act(() => {
      result.current.page.setPagination({ pageIndex: 0, pageSize: 10 });
    });
    await waitFor(() => expect(queryPreview).toHaveBeenCalledTimes(3));
    expect(queryPreview.mock.calls.map(([request]) => request.page)).toEqual([1, 2, 1]);
  });
});
