import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnnotationClassDescriptions } from '../useAnnotationClassDescriptions';

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

describe('useAnnotationClassDescriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryWorkspaceSqlTable.mockResolvedValue({
      rows: [{ class: 'support', description: 'positive' }, { class: 'reject' }],
      hasNext: false,
      etag: '"revision-1"',
    });
  });

  it('loads and normalizes the selected Codebook columns through Workspace SQL', async () => {
    const { result } = renderHook(
      () =>
        useAnnotationClassDescriptions({
          workspaceId: 'workspace-1',
          nodeId: 'classes-node',
          classColumn: 'class',
          descriptionColumn: 'description',
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(queryWorkspaceSqlTable).toHaveBeenCalledWith({
      path: { workspace_id: 'workspace-1' },
      body: {
        mode: 'query',
        node_ids: ['classes-node'],
        sql: 'SELECT "class", "description" FROM "classes-node"',
        page: 1,
        page_size: 500,
      },
      signal: expect.any(AbortSignal),
    });
    expect(result.current.rows).toEqual([
      { class: 'support', description: 'positive' },
      { class: 'reject', description: '' },
    ]);
  });

  it('remains disabled until every selector is present', () => {
    const { result } = renderHook(
      () =>
        useAnnotationClassDescriptions({
          workspaceId: 'workspace-1',
          nodeId: null,
          classColumn: 'class',
          descriptionColumn: 'description',
        }),
      { wrapper },
    );
    expect(result.current.canLoad).toBe(false);
    expect(result.current.rows).toEqual([]);
    expect(queryWorkspaceSqlTable).not.toHaveBeenCalled();
  });
});
