import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreviewPagination } from '../../types';
import { usePreprocessingPreview } from '../usePreprocessingPreview';

const pagination = (page: number, pageSize = 10): PreviewPagination => ({
  has_next: false,
  page,
  page_size: pageSize,
});

const flushPreviewTimer = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('usePreprocessingPreview', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces the preview fetch and stores successful results', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({
      data: [{ token: 'hello' }],
      columns: ['token'],
      pagination: pagination(1),
    });

    const { result } = renderHook(() =>
      usePreprocessingPreview({
        request: { nodeId: 'node-1' },
        signature: 'node-1::preview',
        debounceMs: 25,
        fetcher,
      }),
    );

    expect(fetcher).not.toHaveBeenCalled();

    await flushPreviewTimer(25);

    expect(fetcher).toHaveBeenCalledWith({
      request: { nodeId: 'node-1' },
      page: 1,
      pageSize: 10,
      signal: expect.any(AbortSignal),
    });
    expect(result.current.data).toEqual([{ token: 'hello' }]);
    expect(result.current.columns).toEqual(['token']);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('uses the latest fetcher supplied during a pending debounce', async () => {
    vi.useFakeTimers();
    const firstFetcher = vi.fn().mockResolvedValue({
      data: [{ token: 'first' }],
      columns: ['token'],
      pagination: pagination(1),
    });
    const secondFetcher = vi.fn().mockResolvedValue({
      data: [{ token: 'second' }],
      columns: ['token'],
      pagination: pagination(1),
    });

    const { result, rerender } = renderHook(
      ({ fetcher }) =>
        usePreprocessingPreview<{ nodeId: string }>({
          request: { nodeId: 'node-1' },
          signature: 'node-1::preview',
          debounceMs: 25,
          fetcher,
        }),
      { initialProps: { fetcher: firstFetcher } },
    );

    rerender({ fetcher: secondFetcher });
    await flushPreviewTimer(25);

    expect(firstFetcher).not.toHaveBeenCalled();
    expect(secondFetcher).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual([{ token: 'second' }]);
  });

  it('resets to page one when page size changes', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({
      data: [{ token: 'page' }],
      columns: ['token'],
      pagination: pagination(1, 10),
    });

    const { result } = renderHook(() =>
      usePreprocessingPreview({
        request: { nodeId: 'node-1' },
        signature: 'node-1::preview',
        debounceMs: 25,
        fetcher,
      }),
    );

    await flushPreviewTimer(25);

    act(() => {
      result.current.setPage(3);
    });
    await flushPreviewTimer(25);

    act(() => {
      result.current.setPageSize(50);
    });
    await flushPreviewTimer(25);

    expect(fetcher).toHaveBeenLastCalledWith({
      request: { nodeId: 'node-1' },
      page: 1,
      pageSize: 50,
      signal: expect.any(AbortSignal),
    });
  });

  it('clears loaded data when the preview is disabled', async () => {
    vi.useFakeTimers();
    interface HookProps {
      request: { nodeId: string } | null;
    }

    const fetcher = vi.fn().mockResolvedValue({
      data: [{ token: 'hello' }],
      columns: ['token'],
      pagination: pagination(1),
    });
    const initialProps: HookProps = { request: { nodeId: 'node-1' } };

    const { result, rerender } = renderHook(
      ({ request }: HookProps) =>
        usePreprocessingPreview<{ nodeId: string }>({
          request,
          signature: request ? 'node-1::preview' : undefined,
          debounceMs: 25,
          fetcher,
        }),
      { initialProps },
    );

    await flushPreviewTimer(25);
    expect(result.current.data).toEqual([{ token: 'hello' }]);

    rerender({ request: null });

    expect(result.current.ready).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(result.current.columns).toEqual([]);
    expect(result.current.pagination).toBeNull();
  });

  it('cancels an in-flight preview when workspace identity changes and ignores its stale completion', async () => {
    vi.useFakeTimers();
    let resolveFirst:
      | ((value: {
          data: { workspace: string }[];
          columns: string[];
          pagination: PreviewPagination;
        }) => void)
      | null = null;
    const firstResponse = new Promise<{
      data: { workspace: string }[];
      columns: string[];
      pagination: PreviewPagination;
    }>((resolve) => {
      resolveFirst = resolve;
    });
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce({
        data: [{ workspace: 'workspace-2' }],
        columns: ['workspace'],
        pagination: pagination(1),
      });

    const { result, rerender } = renderHook(
      ({ workspaceId }) =>
        usePreprocessingPreview({
          request: { workspaceId, nodeId: 'node-1' },
          signature: 'node-1::preview',
          debounceMs: 0,
          fetcher,
        }),
      { initialProps: { workspaceId: 'workspace-1' } },
    );

    await flushPreviewTimer(0);
    const firstSignal = fetcher.mock.calls[0]?.[0].signal as AbortSignal;

    rerender({ workspaceId: 'workspace-2' });
    await flushPreviewTimer(0);

    expect(firstSignal.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual([{ workspace: 'workspace-2' }]);

    await act(async () => {
      resolveFirst?.({
        data: [{ workspace: 'workspace-1' }],
        columns: ['workspace'],
        pagination: pagination(1),
      });
      await firstResponse;
    });

    expect(result.current.data).toEqual([{ workspace: 'workspace-2' }]);
  });
});
