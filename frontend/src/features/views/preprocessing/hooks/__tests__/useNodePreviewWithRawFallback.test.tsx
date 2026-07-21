import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the options each call passes to usePreprocessingPreview so we can
// assert on the signature + fetcher routing without firing real timers.
interface CapturedOptions {
  signature: string;
  request: unknown;
  fetcher: (params: {
    request: { workspaceId: string; nodeId: string; payload: unknown };
    page: number;
    pageSize: number;
    signal: AbortSignal;
  }) => Promise<unknown>;
  debounceMs?: number;
}

const usePreprocessingPreviewMock = vi.hoisted(() =>
  vi.fn<(options: CapturedOptions) => Record<string, unknown>>(),
);

vi.mock('../usePreprocessingPreview', () => ({
  usePreprocessingPreview: usePreprocessingPreviewMock,
}));

const queryWorkspaceSqlTableMock = vi.hoisted(() => vi.fn());
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  queryWorkspaceSqlTable: queryWorkspaceSqlTableMock,
}));

import { useNodePreviewWithRawFallback } from '../useNodePreviewWithRawFallback';

/**
 * Returns the latest mocked preview options so tests can inspect routing.
 */
const lastCapturedOptions = (): CapturedOptions => {
  const calls = usePreprocessingPreviewMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0];
};

describe('useNodePreviewWithRawFallback', () => {
  beforeEach(() => {
    usePreprocessingPreviewMock.mockReset();
    queryWorkspaceSqlTableMock.mockReset();
    usePreprocessingPreviewMock.mockReturnValue({});
  });

  describe('signature + request shape', () => {
    it('builds a "<feature>-preview-disabled" signature with a null request when no node is selected', () => {
      renderHook(() =>
        useNodePreviewWithRawFallback({
          workspaceId: 'workspace-1',
          nodeId: null,
          operationPayload: { regex: 'x' },
          operationFetch: vi.fn(),
          signaturePrefix: 'replace',
        }),
      );

      const opts = lastCapturedOptions();
      expect(opts.signature).toBe('replace-preview-disabled');
      expect(opts.request).toBeNull();
    });

    it('builds a "<workspaceId>::<nodeId>::raw" signature when a node is selected but no payload is configured', () => {
      renderHook(() =>
        useNodePreviewWithRawFallback({
          workspaceId: 'workspace-1',
          nodeId: 'node-1',
          operationPayload: null,
          operationFetch: vi.fn(),
          signaturePrefix: 'filter',
        }),
      );

      const opts = lastCapturedOptions();
      expect(opts.signature).toBe('workspace-1::node-1::raw');
      expect(opts.request).toEqual({ workspaceId: 'workspace-1', nodeId: 'node-1', payload: null });
    });

    it('JSON-stringifies the payload into the signature when a payload is present', () => {
      const payload = { conditions: [{ column: 'id', op: '>', value: 5 }] };
      renderHook(() =>
        useNodePreviewWithRawFallback({
          workspaceId: 'workspace-1',
          nodeId: 'node-1',
          operationPayload: payload,
          operationFetch: vi.fn(),
          signaturePrefix: 'filter',
        }),
      );

      const opts = lastCapturedOptions();
      expect(opts.signature).toBe(`workspace-1::node-1::${JSON.stringify(payload)}`);
      expect(opts.request).toEqual({ workspaceId: 'workspace-1', nodeId: 'node-1', payload });
    });

    it('treats enabled=false the same as no node (disabled signature)', () => {
      renderHook(() =>
        useNodePreviewWithRawFallback({
          workspaceId: 'workspace-1',
          nodeId: 'node-1',
          operationPayload: { foo: 'bar' },
          operationFetch: vi.fn(),
          signaturePrefix: 'filter',
          enabled: false,
        }),
      );

      const opts = lastCapturedOptions();
      expect(opts.signature).toBe('filter-preview-disabled');
      expect(opts.request).toBeNull();
    });
  });

  describe('fetcher routing', () => {
    it('routes through operationFetch when the payload is present', async () => {
      const operationFetch = vi.fn().mockResolvedValue({
        data: [{ a: 1 }],
        columns: ['a'],
        pagination: { page: 2, page_size: 25, has_next: false },
      });

      renderHook(() =>
        useNodePreviewWithRawFallback({
          workspaceId: 'workspace-1',
          nodeId: 'node-1',
          operationPayload: { conditions: [] },
          operationFetch,
          signaturePrefix: 'filter',
        }),
      );

      const opts = lastCapturedOptions();
      const signal = new AbortController().signal;
      const result = await opts.fetcher({
        request: { workspaceId: 'workspace-1', nodeId: 'node-1', payload: { conditions: [] } },
        page: 2,
        pageSize: 25,
        signal,
      });

      expect(operationFetch).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        payload: { conditions: [] },
        page: 2,
        pageSize: 25,
        signal,
      });
      expect(queryWorkspaceSqlTableMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: [{ a: 1 }],
        columns: ['a'],
        pagination: { page: 2, page_size: 25, has_next: false },
      });
    });

    it('falls back to explicit node data when the payload is null', async () => {
      const operationFetch = vi.fn();
      queryWorkspaceSqlTableMock.mockResolvedValue({
        rows: [{ raw: 1 }],
        columns: ['raw'],
        hasNext: false,
      });

      renderHook(() =>
        useNodePreviewWithRawFallback({
          workspaceId: 'workspace-1',
          nodeId: 'node-1',
          operationPayload: null,
          operationFetch,
          signaturePrefix: 'filter',
        }),
      );

      const opts = lastCapturedOptions();
      const signal = new AbortController().signal;
      const result = await opts.fetcher({
        request: { workspaceId: 'workspace-1', nodeId: 'node-1', payload: null },
        page: 1,
        pageSize: 10,
        signal,
      });

      expect(operationFetch).not.toHaveBeenCalled();
      expect(queryWorkspaceSqlTableMock).toHaveBeenCalledWith({
        path: { workspace_id: 'workspace-1' },
        body: {
          mode: 'query',
          node_ids: ['node-1'],
          sql: 'SELECT * FROM "node-1"',
          page: 1,
          page_size: 10,
        },
        signal,
      });
      expect(result).toEqual({
        data: [{ raw: 1 }],
        columns: ['raw'],
        pagination: { page: 1, page_size: 10, has_next: false },
      });
    });
  });

  describe('debounce passthrough', () => {
    it('forwards an explicit debounceMs to usePreprocessingPreview', () => {
      renderHook(() =>
        useNodePreviewWithRawFallback({
          workspaceId: 'workspace-1',
          nodeId: 'node-1',
          operationPayload: null,
          operationFetch: vi.fn(),
          signaturePrefix: 'filter',
          debounceMs: 50,
        }),
      );

      const opts = lastCapturedOptions();
      expect(opts.debounceMs).toBe(50);
    });
  });
});
