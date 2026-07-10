import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchNodeInfoMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/nodeInfo', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    nodeInfoQueryOptions: (args: { workspaceId: string; nodeId: string }) => ({
      queryKey: ['workspaces', args.workspaceId, 'nodes', args.nodeId, 'info'] as const,
      queryFn: () =>
        fetchNodeInfoMock({
          workspaceId: args.workspaceId,
          nodeId: args.nodeId,
        }),
    }),
  };
});

import { normalizeSchemaFromInfo, useSchemaManagement } from '../useSchemaManagement';

/** Renders schema hooks under an isolated query client for cache/invalidation assertions. */
/** Used by: tests in this file. */
const renderWithClient = <T,>(callback: () => T) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  /** Provides the per-test query client to hook renders without leaking cache between tests. */
  /** Used by: tests in this file. */
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(callback, { wrapper: Wrapper }) };
};

describe('normalizeSchemaFromInfo', () => {
  it('returns {} when info is null/undefined or has no schema field', () => {
    expect(normalizeSchemaFromInfo(null)).toEqual({});
    expect(normalizeSchemaFromInfo(undefined)).toEqual({});
    expect(normalizeSchemaFromInfo({ id: 'node-1', name: 'Node 1' })).toEqual({});
  });

  it('normalizes object-shape schemas via normalizeTypeName', () => {
    const result = normalizeSchemaFromInfo({
      id: 'node-1',
      name: 'Node 1',
      schema: { id: 'Int64', name: 'Utf8', is_active: 'Boolean' },
    });
    // `Int64` → 'integer', `Utf8` → 'string', `Boolean` → 'boolean'.
    expect(result).toEqual({
      id: 'integer',
      name: 'string',
      is_active: 'boolean',
    });
  });
});

describe('useSchemaManagement', () => {
  beforeEach(() => {
    fetchNodeInfoMock.mockReset();
  });

  describe('availableColumns', () => {
    it('uses currentSchema once the query resolves', async () => {
      fetchNodeInfoMock.mockResolvedValue({
        schema: { col_a: 'integer', col_b: 'string' },
      });

      const { result } = renderWithClient(() =>
        useSchemaManagement({
          nodeId: 'node-1',
          isLocked: false,
          workspaceId: 'ws-1',
        }),
      );

      await waitFor(() => {
        expect(result.current.availableColumns).toEqual([
          { name: 'col_a', dataType: 'integer' },
          { name: 'col_b', dataType: 'string' },
        ]);
      });
    });

    it('returns no columns when no node-info query is available', () => {
      const { result } = renderWithClient(() =>
        useSchemaManagement({
          nodeId: null,
          isLocked: false,
          workspaceId: undefined,
        }),
      );

      expect(result.current.availableColumns).toEqual([]);
    });
  });

  describe('lock controls', () => {
    it('keeps the captured schema visible when the feature becomes locked', async () => {
      fetchNodeInfoMock.mockResolvedValue({ schema: { col_a: 'integer' } });
      let isLocked = false;

      const { result, rerender } = renderWithClient(() =>
        useSchemaManagement({
          nodeId: 'node-1',
          isLocked,
          workspaceId: 'ws-1',
        }),
      );

      await waitFor(() => {
        expect(result.current.availableColumns).toEqual([{ name: 'col_a', dataType: 'integer' }]);
      });

      act(() => {
        result.current.lockCurrentSchema();
      });
      isLocked = true;
      rerender();

      expect(result.current.availableColumns).toEqual([{ name: 'col_a', dataType: 'integer' }]);
    });

    it('accepts an explicit schema restored for a locked task', () => {
      let isLocked = false;
      const { result, rerender } = renderWithClient(() =>
        useSchemaManagement({
          nodeId: null,
          isLocked,
          workspaceId: undefined,
        }),
      );

      act(() => {
        result.current.setLockedSchema({ explicit: 'integer' });
      });
      isLocked = true;
      rerender();

      expect(result.current.availableColumns).toEqual([{ name: 'explicit', dataType: 'integer' }]);
    });
  });

  describe('schema query gating', () => {
    it('does not fetch when nodeId is null', () => {
      renderWithClient(() =>
        useSchemaManagement({
          nodeId: null,
          isLocked: false,
          workspaceId: 'ws-1',
        }),
      );
      expect(fetchNodeInfoMock).not.toHaveBeenCalled();
    });

    it('does not fetch while locked, even when a node is selected', async () => {
      renderWithClient(() =>
        useSchemaManagement({
          nodeId: 'node-1',
          isLocked: true,
          workspaceId: 'ws-1',
        }),
      );
      // give react-query a tick — even so, enabled=false should keep it idle
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetchNodeInfoMock).not.toHaveBeenCalled();
    });
  });
});
