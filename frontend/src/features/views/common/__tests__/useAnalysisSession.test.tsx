import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Analysis } from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import { useAnalysisSession } from '../hooks/useAnalysisSession';

const { getAnalysisResourceMock } = vi.hoisted(() => ({
  getAnalysisResourceMock: vi.fn(),
}));

vi.mock('../analysisApi', () => ({
  getAnalysisResource: getAnalysisResourceMock,
}));

const analysis = {
  id: 'analysis-1',
  state: 'succeeded',
  request: { kind: 'quotation', node_id: 'node-1', column: 'text' },
  error: null,
} as unknown as Analysis;

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useAnalysisSession', () => {
  beforeEach(() => {
    getAnalysisResourceMock.mockReset();
    getAnalysisResourceMock.mockResolvedValue(analysis);
  });

  it('loads the Result only after the owned Analysis succeeds', async () => {
    const { wrapper } = setup();
    const loadResult = vi.fn().mockResolvedValue({ kind: 'quotation', data: [] });
    const { result } = renderHook(
      () =>
        useAnalysisSession({
          workspaceId: 'workspace-1',
          analysisId: 'analysis-1',
          loadResult,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.analysis).toEqual(analysis));
    await waitFor(() => expect(result.current.result).toEqual({ kind: 'quotation', data: [] }));
    expect(loadResult).toHaveBeenCalledTimes(1);
  });

  it('retains server resources in the query cache when a tab panel unmounts', async () => {
    const { queryClient, wrapper } = setup();
    const loadResult = vi.fn().mockResolvedValue({ kind: 'quotation', data: [] });
    const view = renderHook(
      () =>
        useAnalysisSession({
          workspaceId: 'workspace-1',
          analysisId: 'analysis-1',
          loadResult,
        }),
      { wrapper },
    );
    await waitFor(() => expect(view.result.current.result).not.toBeNull());

    view.unmount();

    expect(queryClient.getQueryData(queryKeys.analysis('workspace-1', 'analysis-1'))).toEqual(
      analysis,
    );
    expect(queryClient.getQueryData(queryKeys.analysisResult('workspace-1', 'analysis-1'))).toEqual(
      { kind: 'quotation', data: [] },
    );
  });

  it('retains only the current Analysis presentation shape while a new projection loads', async () => {
    const { queryClient, wrapper } = setup();
    let resolveSecondPage: (value: { page: number }) => void = () => undefined;
    const secondPage = new Promise<{ page: number }>((resolve) => {
      resolveSecondPage = resolve;
    });
    const loadResult = vi.fn(
      (_workspaceId: string, _analysisId: string, query?: Readonly<Record<string, unknown>>) =>
        query?.page === 2 ? secondPage : Promise.resolve({ page: 1 }),
    );
    const view = renderHook(
      ({ page }: { page: number }) =>
        useAnalysisSession({
          workspaceId: 'workspace-1',
          analysisId: 'analysis-1',
          resultQuery: { page },
          loadResult,
        }),
      { wrapper, initialProps: { page: 1 } },
    );

    await waitFor(() => expect(view.result.current.result).toEqual({ page: 1 }));
    view.rerender({ page: 2 });

    await waitFor(() => {
      expect(view.result.current.isResultFetching).toBe(true);
      expect(view.result.current.isResultPlaceholderData).toBe(true);
    });
    expect(view.result.current.result).toEqual({ page: 1 });
    expect(
      queryClient.getQueryData(queryKeys.analysisResult('workspace-1', 'analysis-1', { page: 2 })),
    ).toBeUndefined();

    resolveSecondPage({ page: 2 });
    await waitFor(() => expect(view.result.current.result).toEqual({ page: 2 }));
    expect(view.result.current.isResultPlaceholderData).toBe(false);
  });

  it('does not carry a projection placeholder across Analysis ownership', async () => {
    const { wrapper } = setup();
    const pendingResult = new Promise<{ analysisId: string }>(() => undefined);
    const loadResult = vi.fn((_workspaceId: string, analysisId: string) =>
      analysisId === 'analysis-1' ? Promise.resolve({ analysisId: 'analysis-1' }) : pendingResult,
    );
    const view = renderHook(
      ({ analysisId }: { analysisId: string }) =>
        useAnalysisSession({
          workspaceId: 'workspace-1',
          analysisId,
          resultQuery: { page: 1 },
          loadResult,
        }),
      { wrapper, initialProps: { analysisId: 'analysis-1' } },
    );

    await waitFor(() => expect(view.result.current.result).toEqual({ analysisId: 'analysis-1' }));
    view.rerender({ analysisId: 'analysis-2' });

    expect(view.result.current.result).toBeNull();
    expect(view.result.current.isResultPlaceholderData).toBe(false);
  });

  it('requests every no-store projection attempt without sending its request key', async () => {
    const { wrapper } = setup();
    const loadResult = vi.fn(
      async (
        _workspaceId: string,
        _analysisId: string,
        query?: Readonly<Record<string, unknown>>,
      ) => ({ clusterCount: query?.cluster_count }),
    );
    const view = renderHook(
      ({ resultRequestKey }: { resultRequestKey: number }) =>
        useAnalysisSession({
          workspaceId: 'workspace-1',
          analysisId: 'analysis-1',
          resultQuery: { kind: 'topic_modeling', cluster_count: 3 },
          resultRequestKey,
          resultCacheMode: 'no-store',
          loadResult,
        }),
      { wrapper, initialProps: { resultRequestKey: 1 } },
    );

    await waitFor(() => expect(loadResult).toHaveBeenCalledTimes(1));
    view.rerender({ resultRequestKey: 2 });
    await waitFor(() => expect(loadResult).toHaveBeenCalledTimes(2));

    expect(loadResult).toHaveBeenNthCalledWith(
      1,
      'workspace-1',
      'analysis-1',
      { kind: 'topic_modeling', cluster_count: 3 },
      expect.any(AbortSignal),
    );
    expect(loadResult).toHaveBeenNthCalledWith(
      2,
      'workspace-1',
      'analysis-1',
      { kind: 'topic_modeling', cluster_count: 3 },
      expect.any(AbortSignal),
    );
  });
});
