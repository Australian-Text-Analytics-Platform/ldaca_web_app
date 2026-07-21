import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      () => useAnnotationNodePage({ workspaceId: 'workspace-1', nodeId: 'node-1', pageSize: 50 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.rows).toEqual([{ text: 'one' }]));
    expect(queryWorkspaceSqlTable).toHaveBeenCalledWith({
      path: { workspace_id: 'workspace-1' },
      body: {
        mode: 'query',
        node_ids: ['node-1'],
        sql: 'SELECT * FROM "node-1"',
        page: 1,
        page_size: 50,
      },
      signal: expect.any(AbortSignal),
    });
    expect(result.current.rowCount).toBe(51);
  });
});
