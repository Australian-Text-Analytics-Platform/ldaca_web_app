import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnnotationClassDescriptions } from '../useAnnotationClassDescriptions';

const getNodeRowsTable = vi.hoisted(() => vi.fn());
vi.mock('@/api', async (importOriginal) => ({ ...(await importOriginal()), getNodeRowsTable }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('useAnnotationClassDescriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNodeRowsTable.mockResolvedValue({
      rows: [{ class: 'support', description: 'positive' }, { class: 'reject' }],
      hasNext: false,
    });
  });

  it('loads and normalizes the selected class-description columns through node rows', async () => {
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
    expect(getNodeRowsTable).toHaveBeenCalledWith({
      path: { workspace_id: 'workspace-1', node_id: 'classes-node' },
      query: { page: 1, page_size: 1000 },
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
    expect(getNodeRowsTable).not.toHaveBeenCalled();
  });
});
