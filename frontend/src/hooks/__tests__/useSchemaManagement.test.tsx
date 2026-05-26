import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchNodeInfoMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/nodeInfo', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchNodeInfo: fetchNodeInfoMock,
  };
});

import {
  applySelectedColumnsToSnapshots,
  createNodeSnapshot,
  createNodeSnapshots,
  normalizeSchemaFromInfo,
  useSchemaManagement,
} from '../useSchemaManagement';

const renderWithClient = <T,>(callback: () => T) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(callback, { wrapper: Wrapper }) };
};

describe('normalizeSchemaFromInfo', () => {
  it('returns {} when info is null/undefined or has no schema field', () => {
    expect(normalizeSchemaFromInfo(null)).toEqual({});
    expect(normalizeSchemaFromInfo(undefined)).toEqual({});
    expect(normalizeSchemaFromInfo({})).toEqual({});
  });

  it('flattens an array-shape schema using the `js_type` field, defaulting to string', () => {
    const result = normalizeSchemaFromInfo({
      schema: [
        { name: 'col_a', js_type: 'integer' },
        { name: 'col_b', js_type: 'string' },
        { name: 'col_no_js_type' },
      ],
    });
    expect(result).toEqual({
      col_a: 'integer',
      col_b: 'string',
      col_no_js_type: 'string',
    });
  });

  it('normalizes object-shape schemas via normalizeTypeName', () => {
    const result = normalizeSchemaFromInfo({
      schema: { id: 'Int64', name: 'Utf8', is_active: 'Boolean' },
    });
    // `Int64` → 'integer', `Utf8` → 'string', `Boolean` → 'boolean'.
    expect(result).toEqual({
      id: 'integer',
      name: 'string',
      is_active: 'boolean',
    });
  });

  it('falls back to "string" when an object-shape entry holds a non-string value', () => {
    const result = normalizeSchemaFromInfo({ schema: { col: 123 } });
    expect(result).toEqual({ col: 'string' });
  });
});

describe('applySelectedColumnsToSnapshots', () => {
  const baseSnapshots = [
    { id: 'n1', name: 'Node 1', columns: ['col_a', 'col_b'] },
    { id: 'n2', name: 'Node 2', columns: ['col_x'] },
    { id: 'n3', name: 'Node 3', columns: [] },
  ];

  it('uses the chosen column when present', () => {
    const result = applySelectedColumnsToSnapshots(baseSnapshots, { n1: 'col_b', n2: 'col_x' });
    expect(result.find((s) => s.id === 'n1')?.columns).toEqual(['col_b']);
    expect(result.find((s) => s.id === 'n2')?.columns).toEqual(['col_x']);
  });

  it('falls back to the first available column when no choice is given', () => {
    const result = applySelectedColumnsToSnapshots(baseSnapshots, {});
    expect(result.find((s) => s.id === 'n1')?.columns).toEqual(['col_a']);
    expect(result.find((s) => s.id === 'n2')?.columns).toEqual(['col_x']);
  });

  it('returns [] when neither choice nor fallback is available', () => {
    const result = applySelectedColumnsToSnapshots(baseSnapshots, {});
    expect(result.find((s) => s.id === 'n3')?.columns).toEqual([]);
  });

  it('treats whitespace-only choices as missing and falls back', () => {
    const result = applySelectedColumnsToSnapshots(baseSnapshots, { n1: '   ' });
    expect(result.find((s) => s.id === 'n1')?.columns).toEqual(['col_a']);
  });
});

describe('createNodeSnapshot', () => {
  beforeEach(() => {
    fetchNodeInfoMock.mockReset();
  });

  it('builds a snapshot from the fetched info, preferring the top-level name + columns', async () => {
    fetchNodeInfoMock.mockResolvedValue({
      name: 'Top Level Name',
      columns: ['a', 'b'],
      schema: { a: 'integer', b: 'string' },
      shape: [42, 2],
    });

    const queryClient = new QueryClient();
    const snapshot = await createNodeSnapshot(
      'ws-1',
      'node-1',
      () => ({ Authorization: 'Bearer x' }),
      queryClient,
    );

    expect(fetchNodeInfoMock).toHaveBeenCalledWith({
      queryClient,
      workspaceId: 'ws-1',
      nodeId: 'node-1',
      getAuthHeaders: expect.any(Function),
    });
    expect(snapshot).toEqual({
      id: 'node-1',
      name: 'Top Level Name',
      columns: ['a', 'b'],
      schema: { a: 'integer', b: 'string' },
      shape: [42, 2],
    });
  });

  it('uses nodeId and no columns when generated node info omits optional fields', async () => {
    fetchNodeInfoMock.mockResolvedValue({
      schema: {},
    });

    const queryClient = new QueryClient();
    const snapshot = await createNodeSnapshot(
      'ws-1',
      'node-fallback',
      () => ({}),
      queryClient,
    );

    expect(snapshot.name).toBe('node-fallback');
    expect(snapshot.columns).toEqual([]);
    expect(snapshot.shape).toBeUndefined();
  });
});

describe('createNodeSnapshots', () => {
  beforeEach(() => {
    fetchNodeInfoMock.mockReset();
  });

  it('returns an empty-snapshot stand-in when a single fetch fails, preserving order for the rest', async () => {
    fetchNodeInfoMock
      .mockResolvedValueOnce({ name: 'OK', columns: ['x'], schema: {} })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ name: 'Also OK', columns: ['y'], schema: {} });

    const queryClient = new QueryClient();
    const snapshots = await createNodeSnapshots(
      'ws-1',
      ['n1', 'n2', 'n3'],
      () => ({}),
      queryClient,
    );

    expect(snapshots).toHaveLength(3);
    expect(snapshots[0]?.name).toBe('OK');
    expect(snapshots[1]).toEqual({
      id: 'n2',
      name: 'n2',
      columns: [],
      schema: {},
    });
    expect(snapshots[2]?.name).toBe('Also OK');
  });
});

describe('useSchemaManagement', () => {
  beforeEach(() => {
    fetchNodeInfoMock.mockReset();
  });

  describe('availableColumns fallback chain', () => {
    it('uses currentSchema once the query resolves', async () => {
      fetchNodeInfoMock.mockResolvedValue({
        schema: { col_a: 'integer', col_b: 'string' },
      });

      const { result } = renderWithClient(() =>
        useSchemaManagement({
          nodeId: 'node-1',
          isLocked: false,
          workspaceId: 'ws-1',
          getAuthHeaders: () => ({}),
        }),
      );

      await waitFor(() =>
        expect(result.current.availableColumns).toEqual([
          { name: 'col_a', dataType: 'integer' },
          { name: 'col_b', dataType: 'string' },
        ]),
      );
    });

    it('falls back to nodeData.columns + dtypes when no schema query is available', () => {
      const { result } = renderWithClient(() =>
        useSchemaManagement({
          nodeId: null,
          isLocked: false,
          workspaceId: undefined,
          getAuthHeaders: () => ({}),
          nodeData: {
            columns: ['a', 'b'],
            dtypes: { a: 'integer', b: 'string' },
          },
        }),
      );

      expect(result.current.availableColumns).toEqual([
        { name: 'a', dataType: 'integer' },
        { name: 'b', dataType: 'string' },
      ]);
    });

    it('falls back to selectedNode.data.schema (array form) when nodeData is absent', () => {
      const { result } = renderWithClient(() =>
        useSchemaManagement({
          nodeId: null,
          isLocked: false,
          workspaceId: undefined,
          getAuthHeaders: () => ({}),
          selectedNode: {
            data: {
              schema: [
                { name: 'a', js_type: 'integer' },
                { name: 'b', js_type: 'string' },
              ],
            },
          },
        }),
      );

      expect(result.current.availableColumns).toEqual([
        { name: 'a', dataType: 'integer' },
        { name: 'b', dataType: 'string' },
      ]);
    });
  });

  describe('lock controls', () => {
    it('lockCurrentSchema captures currentSchema by default; effective falls back to it when locked', async () => {
      fetchNodeInfoMock.mockResolvedValue({ schema: { col_a: 'integer' } });

      const { result } = renderWithClient(() =>
        useSchemaManagement({
          nodeId: 'node-1',
          isLocked: false,
          workspaceId: 'ws-1',
          getAuthHeaders: () => ({}),
        }),
      );

      await waitFor(() => expect(result.current.currentSchema).toEqual({ col_a: 'integer' }));

      act(() => {
        result.current.lockCurrentSchema();
      });
      expect(result.current.lockedSchema).toEqual({ col_a: 'integer' });
    });

    it('lockCurrentSchema accepts an explicit override', () => {
      const { result } = renderWithClient(() =>
        useSchemaManagement({
          nodeId: null,
          isLocked: false,
          workspaceId: undefined,
          getAuthHeaders: () => ({}),
        }),
      );

      act(() => {
        result.current.lockCurrentSchema({ explicit: 'integer' });
      });
      expect(result.current.lockedSchema).toEqual({ explicit: 'integer' });
    });

    it('clearLockedSchema resets locked back to null', () => {
      const { result } = renderWithClient(() =>
        useSchemaManagement({
          nodeId: null,
          isLocked: false,
          workspaceId: undefined,
          getAuthHeaders: () => ({}),
        }),
      );

      act(() => {
        result.current.lockCurrentSchema({ a: 'integer' });
      });
      expect(result.current.lockedSchema).toEqual({ a: 'integer' });

      act(() => {
        result.current.clearLockedSchema();
      });
      expect(result.current.lockedSchema).toBeNull();
    });
  });

  describe('getColumnsByType', () => {
    it('filters availableColumns by a single type or a list of types', () => {
      const { result } = renderWithClient(() =>
        useSchemaManagement({
          nodeId: null,
          isLocked: false,
          workspaceId: undefined,
          getAuthHeaders: () => ({}),
          nodeData: {
            columns: ['a', 'b', 'c'],
            dtypes: { a: 'integer', b: 'string', c: 'integer' },
          },
        }),
      );

      expect(result.current.getColumnsByType('integer')).toEqual([
        { name: 'a', dataType: 'integer' },
        { name: 'c', dataType: 'integer' },
      ]);
      expect(result.current.getColumnsByType(['string', 'integer'])).toHaveLength(3);
      expect(result.current.getColumnsByType('boolean')).toEqual([]);
    });
  });

  describe('schema query gating', () => {
    it('does not fetch when nodeId is null', () => {
      renderWithClient(() =>
        useSchemaManagement({
          nodeId: null,
          isLocked: false,
          workspaceId: 'ws-1',
          getAuthHeaders: () => ({}),
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
          getAuthHeaders: () => ({}),
        }),
      );
      // give react-query a tick — even so, enabled=false should keep it idle
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetchNodeInfoMock).not.toHaveBeenCalled();
    });
  });
});
