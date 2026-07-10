import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnnotationClassDescriptions } from '../useAnnotationClassDescriptions';

const mocks = vi.hoisted(() => ({
  getAnnotationClassDescriptions: vi.fn(),
}));

vi.mock('@/api', () => ({
  getAnnotationClassDescriptions: mocks.getAnnotationClassDescriptions,
}));

const wrapper = ({ children }: { children: ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

describe('useAnnotationClassDescriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches class descriptions with the shared query key and normalized rows', async () => {
    mocks.getAnnotationClassDescriptions.mockResolvedValue({
      data: {
        class_column: 'class',
        description_column: 'description',
        rows: [{ class: 'support' }, { description: 'Missing class' }],
      },
    });

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

    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });

    expect(mocks.getAnnotationClassDescriptions).toHaveBeenCalledWith({
      path: { workspace_id: 'workspace-1', node_id: 'classes-node' },
      query: { class_column: 'class', description_column: 'description' },
      signal: expect.any(AbortSignal),
      throwOnError: true,
    });
    expect(result.current.rows).toEqual([
      { class: 'support', description: '' },
      { class: '', description: 'Missing class' },
    ]);
  });

  it('stays disabled until all class-description selectors are available', () => {
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
    expect(mocks.getAnnotationClassDescriptions).not.toHaveBeenCalled();
  });
});
