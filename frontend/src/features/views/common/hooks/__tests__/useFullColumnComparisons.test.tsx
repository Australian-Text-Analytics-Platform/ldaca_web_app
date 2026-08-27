import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useFullColumnComparisons } from '../useFullColumnComparisons';

const queryWorkspaceSqlTable = vi.hoisted(() => vi.fn());

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  queryWorkspaceSqlTable,
}));

describe('useFullColumnComparisons', () => {
  it('shares canonical Codebook classes between the query key and SQL', async () => {
    queryWorkspaceSqlTable.mockResolvedValue({
      columns: ['__reference', '__comparison', '__count'],
      rows: [{ __reference: 'job', __comparison: 'covid', __count: 2 }],
      hasNext: false,
      etag: 'revision-1',
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useFullColumnComparisons({
          workspaceId: 'workspace-1',
          nodeIds: ['node-1'],
          sql: 'SELECT * FROM "node-1"',
          referenceColumn: 'annotation',
          comparisonColumns: ['reviewer'],
          classOptions: [' job ', 'covid', 'job', ''],
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current[0]?.isSuccess).toBe(true);
    });
    expect(queryWorkspaceSqlTable).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          sql: expect.stringContaining("IN ('job', 'covid')"),
        }),
      }),
    );
    expect(client.getQueryCache().getAll()[0]?.queryKey).toEqual([
      'workspaces',
      'workspace-1',
      'annotation-column-comparisons',
      {
        nodeIds: ['node-1'],
        sql: 'SELECT * FROM "node-1"',
        referenceColumn: 'annotation',
        comparisonColumn: 'reviewer',
        classOptions: ['job', 'covid'],
      },
    ]);
  });
});
