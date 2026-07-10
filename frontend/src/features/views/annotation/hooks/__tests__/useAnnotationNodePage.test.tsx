import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnnotationNodePage } from '../useAnnotationNodePage';

const mocks = vi.hoisted(() => ({ getNodeDataByWorkspaceId: vi.fn() }));
vi.mock('@/api', () => ({ getNodeDataByWorkspaceId: mocks.getNodeDataByWorkspaceId }));

const wrapper = ({ children }: PropsWithChildren) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  mocks.getNodeDataByWorkspaceId.mockReset();
});

describe('useAnnotationNodePage', () => {
  it('owns canonical page identity and passes TanStack cancellation through the SDK', async () => {
    mocks.getNodeDataByWorkspaceId.mockResolvedValue({
      data: {
        data: [{ text: 'one' }],
        revision: 'node-revision-1',
        pagination: { total_rows: 51 },
      },
    });
    const { result } = renderHook(
      () => useAnnotationNodePage({ workspaceId: 'workspace-1', nodeId: 'node-1', pageSize: 50 }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.rows).toEqual([{ text: 'one' }]);
    });
    expect(result.current.revision).toBe('node-revision-1');
    expect(mocks.getNodeDataByWorkspaceId).toHaveBeenLastCalledWith({
      path: { workspace_id: 'workspace-1', node_id: 'node-1' },
      query: {
        page: 1,
        page_size: 50,
        sort_by: null,
        descending: false,
        filter_column: null,
        filter_value: null,
        filter_op: 'contains',
      },
      signal: expect.any(AbortSignal),
      throwOnError: true,
    });

    act(() => {
      result.current.setPagination({ pageIndex: 1, pageSize: 50 });
    });
    await waitFor(() => {
      expect(mocks.getNodeDataByWorkspaceId).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ page: 2, page_size: 50 }),
        }),
      );
    });
  });

  it('aborts an in-flight page when the source identity changes', async () => {
    let firstSignal: AbortSignal | undefined;
    mocks.getNodeDataByWorkspaceId.mockImplementation(
      (options: { signal?: AbortSignal; path: { node_id: string } }) => {
        if (options.path.node_id === 'node-1') {
          firstSignal = options.signal;
          return new Promise(() => undefined);
        }
        return Promise.resolve({ data: { data: [], pagination: { total_rows: 0 } } });
      },
    );
    const { rerender } = renderHook(
      ({ nodeId }) => useAnnotationNodePage({ workspaceId: 'workspace-1', nodeId, pageSize: 20 }),
      { wrapper, initialProps: { nodeId: 'node-1' } },
    );
    await waitFor(() => {
      expect(firstSignal).toBeInstanceOf(AbortSignal);
    });

    rerender({ nodeId: 'node-2' });

    await waitFor(() => {
      expect(firstSignal?.aborted).toBe(true);
    });
  });
});
