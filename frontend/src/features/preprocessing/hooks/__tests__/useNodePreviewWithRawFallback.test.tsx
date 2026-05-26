import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the options each call passes to usePreprocessingPreview so we can
// assert on the signature + fetcher routing without firing real timers.
type CapturedOptions = {
  signature: string;
  request: unknown;
  fetcher: (params: {
    request: { nodeId: string; payload: unknown };
    page: number;
    pageSize: number;
    signal: AbortSignal;
  }) => Promise<unknown>;
  debounceMs?: number;
};

const usePreprocessingPreviewMock = vi.hoisted(() =>
  vi.fn<(options: CapturedOptions) => Record<string, unknown>>(),
);

vi.mock('../usePreprocessingPreview', () => ({
  usePreprocessingPreview: usePreprocessingPreviewMock,
}));

const useAuthMock = vi.hoisted(() => vi.fn(() => ({
  getAuthHeaders: () => ({ Authorization: 'Bearer test' }),
})));
vi.mock('@/hooks/useAuth', () => ({ useAuth: useAuthMock }));

const nodesApiDataMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/backend/nodes', () => ({
  nodesApi: { data: nodesApiDataMock },
}));

import { useNodePreviewWithRawFallback } from '../useNodePreviewWithRawFallback';

const lastCapturedOptions = (): CapturedOptions => {
  const calls = usePreprocessingPreviewMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0]!;
};

describe('useNodePreviewWithRawFallback', () => {
  beforeEach(() => {
    usePreprocessingPreviewMock.mockReset();
    nodesApiDataMock.mockReset();
    usePreprocessingPreviewMock.mockReturnValue({});
  });

  describe('signature + request shape', () => {
    it('builds a "<feature>-preview-disabled" signature with a null request when no node is selected', () => {
      renderHook(() =>
        useNodePreviewWithRawFallback({
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

    it('builds a "<nodeId>::raw" signature when a node is selected but no payload is configured', () => {
      renderHook(() =>
        useNodePreviewWithRawFallback({
          nodeId: 'node-1',
          operationPayload: null,
          operationFetch: vi.fn(),
          signaturePrefix: 'filter',
        }),
      );

      const opts = lastCapturedOptions();
      expect(opts.signature).toBe('node-1::raw');
      expect(opts.request).toEqual({ nodeId: 'node-1', payload: null });
    });

    it('JSON-stringifies the payload into the signature when a payload is present', () => {
      const payload = { conditions: [{ column: 'id', op: '>', value: 5 }] };
      renderHook(() =>
        useNodePreviewWithRawFallback({
          nodeId: 'node-1',
          operationPayload: payload,
          operationFetch: vi.fn(),
          signaturePrefix: 'filter',
        }),
      );

      const opts = lastCapturedOptions();
      expect(opts.signature).toBe(`node-1::${JSON.stringify(payload)}`);
      expect(opts.request).toEqual({ nodeId: 'node-1', payload });
    });

    it('treats enabled=false the same as no node (disabled signature)', () => {
      renderHook(() =>
        useNodePreviewWithRawFallback({
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
      const operationFetch = vi
        .fn()
        .mockResolvedValue({ data: [{ a: 1 }], columns: ['a'], pagination: null });

      renderHook(() =>
        useNodePreviewWithRawFallback({
          nodeId: 'node-1',
          operationPayload: { conditions: [] },
          operationFetch,
          signaturePrefix: 'filter',
        }),
      );

      const opts = lastCapturedOptions();
      const signal = new AbortController().signal;
      const result = await opts.fetcher({
        request: { nodeId: 'node-1', payload: { conditions: [] } },
        page: 2,
        pageSize: 25,
        signal,
      });

      expect(operationFetch).toHaveBeenCalledWith('node-1', { conditions: [] }, 2, 25);
      expect(nodesApiDataMock).not.toHaveBeenCalled();
      expect(result).toEqual({ data: [{ a: 1 }], columns: ['a'], pagination: null });
    });

    it('falls back to nodesApi.data when the payload is null', async () => {
      const operationFetch = vi.fn();
      nodesApiDataMock.mockResolvedValue({
        data: [{ raw: 1 }],
        columns: ['raw'],
        pagination: null,
      });

      renderHook(() =>
        useNodePreviewWithRawFallback({
          nodeId: 'node-1',
          operationPayload: null,
          operationFetch,
          signaturePrefix: 'filter',
        }),
      );

      const opts = lastCapturedOptions();
      const signal = new AbortController().signal;
      const result = await opts.fetcher({
        request: { nodeId: 'node-1', payload: null },
        page: 1,
        pageSize: 10,
        signal,
      });

      expect(operationFetch).not.toHaveBeenCalled();
      expect(nodesApiDataMock).toHaveBeenCalledWith(
        'node-1',
        { page: 1, pageSize: 10 },
        { Authorization: 'Bearer test' },
      );
      expect(result).toEqual({
        data: [{ raw: 1 }],
        columns: ['raw'],
        pagination: null,
      });
    });

    it('normalises a malformed response into empty arrays + null pagination', async () => {
      // operationFetch returns garbage shape — fetcher should still produce
      // `{ data: [], columns: [], pagination: null }` instead of propagating it.
      const operationFetch = vi.fn().mockResolvedValue({
        data: 'not an array',
        columns: 42,
        pagination: undefined,
      });

      renderHook(() =>
        useNodePreviewWithRawFallback({
          nodeId: 'node-1',
          operationPayload: { foo: 1 },
          operationFetch,
          signaturePrefix: 'filter',
        }),
      );

      const opts = lastCapturedOptions();
      const result = await opts.fetcher({
        request: { nodeId: 'node-1', payload: { foo: 1 } },
        page: 1,
        pageSize: 10,
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ data: [], columns: [], pagination: null });
    });
  });

  describe('debounce passthrough', () => {
    it('forwards an explicit debounceMs to usePreprocessingPreview', () => {
      renderHook(() =>
        useNodePreviewWithRawFallback({
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
