import React from 'react';
import { Field, Int64, Utf8 } from 'apache-arrow';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchNodeSchemaMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/nodeSchema', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    nodeSchemaQueryOptions: (args: { workspaceId: string; nodeId: string }) => ({
      queryKey: ['workspaces', args.workspaceId, 'nodes', args.nodeId, 'schema'] as const,
      queryFn: () => fetchNodeSchemaMock(args),
    }),
  };
});

import { arrowSchemaToKinds, useSchemaManagement } from '../useSchemaManagement';

const integerColumn = {
  name: 'col_a',
  kind: 'integer' as const,
  field: new Field('col_a', new Int64()),
};
const stringColumn = {
  name: 'col_b',
  kind: 'string' as const,
  field: new Field('col_b', new Utf8()),
};

const renderWithClient = <T,>(callback: () => T) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(callback, { wrapper: Wrapper }) };
};

describe('arrowSchemaToKinds', () => {
  it('projects only UI semantic kinds from authoritative Arrow fields', () => {
    expect(arrowSchemaToKinds([integerColumn, stringColumn])).toEqual({
      col_a: 'integer',
      col_b: 'string',
    });
  });
});

describe('useSchemaManagement', () => {
  beforeEach(() => fetchNodeSchemaMock.mockReset());

  it('uses the Arrow schema once the query resolves', async () => {
    fetchNodeSchemaMock.mockResolvedValue([integerColumn, stringColumn]);
    const { result } = renderWithClient(() =>
      useSchemaManagement({ nodeId: 'node-1', isLocked: false, workspaceId: 'ws-1' }),
    );

    await waitFor(() => {
      expect(result.current.availableColumns).toEqual([
        { name: 'col_a', dataType: 'integer' },
        { name: 'col_b', dataType: 'string' },
      ]);
    });
  });

  it('returns no columns without a selected node', () => {
    const { result } = renderWithClient(() =>
      useSchemaManagement({ nodeId: null, isLocked: false, workspaceId: undefined }),
    );
    expect(result.current.availableColumns).toEqual([]);
  });

  it('keeps the captured schema visible while locked', async () => {
    fetchNodeSchemaMock.mockResolvedValue([integerColumn]);
    let isLocked = false;
    const { result, rerender } = renderWithClient(() =>
      useSchemaManagement({ nodeId: 'node-1', isLocked, workspaceId: 'ws-1' }),
    );
    await waitFor(() => {
      expect(result.current.availableColumns).toEqual([{ name: 'col_a', dataType: 'integer' }]);
    });
    act(() => result.current.lockCurrentSchema());
    isLocked = true;
    rerender();
    expect(result.current.availableColumns).toEqual([{ name: 'col_a', dataType: 'integer' }]);
  });

  it('accepts an explicitly restored semantic schema', () => {
    let isLocked = false;
    const { result, rerender } = renderWithClient(() =>
      useSchemaManagement({ nodeId: null, isLocked, workspaceId: undefined }),
    );
    act(() => result.current.setLockedSchema({ explicit: 'integer' }));
    isLocked = true;
    rerender();
    expect(result.current.availableColumns).toEqual([{ name: 'explicit', dataType: 'integer' }]);
  });

  it('does not fetch without a selected node or while locked', async () => {
    renderWithClient(() =>
      useSchemaManagement({ nodeId: null, isLocked: false, workspaceId: 'ws-1' }),
    );
    renderWithClient(() =>
      useSchemaManagement({ nodeId: 'node-1', isLocked: true, workspaceId: 'ws-1' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchNodeSchemaMock).not.toHaveBeenCalled();
  });
});
