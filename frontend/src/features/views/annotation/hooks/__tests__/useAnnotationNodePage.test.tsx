import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnnotationNodePage } from '../useAnnotationNodePage';

const getNodeRowsTable = vi.hoisted(() => vi.fn());
vi.mock('@/api', async (importOriginal) => ({ ...(await importOriginal()), getNodeRowsTable }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('useAnnotationNodePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNodeRowsTable.mockResolvedValue({ rows: [{ text: 'one' }], hasNext: true });
  });

  it('uses one-based node row pagination and forwards the query abort signal', async () => {
    const { result } = renderHook(
      () => useAnnotationNodePage({ workspaceId: 'workspace-1', nodeId: 'node-1', pageSize: 50 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.rows).toEqual([{ text: 'one' }]));
    expect(getNodeRowsTable).toHaveBeenCalledWith({
      path: { workspace_id: 'workspace-1', node_id: 'node-1' },
      query: { page: 1, page_size: 50, sort_by: null, descending: false },
      signal: expect.any(AbortSignal),
    });
    expect(result.current.rowCount).toBe(51);
  });
});
