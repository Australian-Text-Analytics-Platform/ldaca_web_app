import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Analysis } from '@/api';
import { useAnalysisFeature } from '../hooks/useAnalysisFeature';

const mocks = vi.hoisted(() => ({
  cancelAnalysis: vi.fn(),
  clearTabAnalysis: vi.fn(),
  session: {
    analysis: null as Analysis | null,
    result: null as unknown,
  },
  sessionOptions: null as {
    loadResult?: (
      workspaceId: string,
      analysisId: string,
      query?: Readonly<Record<string, unknown>>,
    ) => Promise<unknown>;
  } | null,
  toastError: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  cancelAnalysis: mocks.cancelAnalysis,
  clearTabAnalysis: mocks.clearTabAnalysis,
}));

vi.mock('../hooks/useAnalysisSession', () => ({
  useAnalysisSession: (options: typeof mocks.sessionOptions) => {
    mocks.sessionOptions = options;
    return mocks.session;
  },
}));

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError },
}));

const analysis = (overrides: Partial<Analysis> = {}): Analysis => ({
  id: 'analysis-1',
  tab_id: 'tab-1',
  parent_analysis_id: null,
  execution_scope: 'run_all',
  supersedes_analysis_ids: [],
  state: 'succeeded',
  cancellation_requested_at: null,
  created_at: '2026-01-01T00:00:00Z',
  started_at: '2026-01-01T00:00:01Z',
  finished_at: '2026-01-01T00:00:02Z',
  revision: 1,
  progress: { fraction: 1, message: 'Complete' },
  error: null,
  integrity: { status: 'valid' },
  output_node_ids: [],
  request: {
    kind: 'token_frequency',
    node_ids: ['node-1'],
    node_columns: { 'node-1': 'text' },
    node_tokenizer_models: { 'node-1': 'native:plain_words_en' },
    stop_words: [],
    token_limit: 20,
  },
  ...overrides,
});

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const baseConfig = () => ({
  taskType: 'token_frequency',
  workspaceId: 'workspace-1',
  tabId: 'tab-1',
  hydrationTaskId: 'analysis-1',
  controlAnalysisId: 'analysis-1',
  tabAnalysisIds: ['analysis-1'],
  fetchResult: vi.fn(() => Promise.resolve({ rows: [] })),
  onRequest: vi.fn(),
  onCleared: vi.fn(),
});

describe('useAnalysisFeature', () => {
  beforeEach(() => {
    mocks.cancelAnalysis.mockReset();
    mocks.clearTabAnalysis.mockReset();
    mocks.toastError.mockReset();
    mocks.session.analysis = null;
    mocks.session.result = null;
    mocks.sessionOptions = null;
    mocks.cancelAnalysis.mockResolvedValue({ data: analysis({ state: 'cancelled' }) });
    mocks.clearTabAnalysis.mockResolvedValue({ data: undefined });
  });

  it('applies the immutable request once and exposes the Query-owned Result', async () => {
    const config = baseConfig();
    const resultResource = { rows: [{ token: 'word' }] };
    mocks.session.analysis = analysis();
    mocks.session.result = resultResource;

    const view = renderHook(() => useAnalysisFeature(config), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(config.onRequest).toHaveBeenCalledWith(mocks.session.analysis?.request);
      expect(view.result.current.result).toBe(resultResource);
      expect(view.result.current.request).toBe(mocks.session.analysis?.request);
    });
    view.rerender();
    expect(config.onRequest).toHaveBeenCalledTimes(1);
  });

  it('hydrates parameters from a standalone Run All source without loading it as Preview', async () => {
    const request = analysis().request;
    const config = {
      ...baseConfig(),
      hydrationTaskId: null,
      requestHydration: { analysisId: 'run-all-1', request },
    };

    const view = renderHook(() => useAnalysisFeature(config), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(config.onRequest).toHaveBeenCalledWith(request);
      expect(view.result.current.request).toBe(request);
    });
    expect(view.result.current.result).toBeNull();
    expect(mocks.sessionOptions).toMatchObject({ analysisId: null });
  });

  it('forwards the query-key projection to the Result loader', async () => {
    const config = baseConfig();
    renderHook(() => useAnalysisFeature(config), { wrapper: createWrapper() });
    const projection = { page: 1, sort_by: 'text', descending: true };

    await mocks.sessionOptions?.loadResult?.('workspace-1', 'analysis-1', projection);

    expect(config.fetchResult).toHaveBeenCalledWith('analysis-1', projection);
  });

  it('derives failure state from Analysis without inventing a Result lifecycle', () => {
    const config = baseConfig();
    mocks.session.analysis = analysis({
      state: 'failed',
      progress: { fraction: null, message: null },
      error: { code: 'quotation_failed', message: 'Extractor failed' },
    });

    const { result } = renderHook(() => useAnalysisFeature(config), {
      wrapper: createWrapper(),
    });

    expect(result.current.analysisState).toBe('failed');
    expect(result.current.analysisError).toBe('Extractor failed');
    expect(result.current.taskStatus.failedTask?.task_id).toBe('analysis-1');
  });

  it('clears the Tab-owned Analysis and reports the removed identities', async () => {
    const config = baseConfig();
    mocks.session.analysis = analysis();
    const { result } = renderHook(() => useAnalysisFeature(config), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      expect(await result.current.clearResults()).toBe(true);
    });

    expect(mocks.clearTabAnalysis).toHaveBeenCalledWith({
      path: { workspace_id: 'workspace-1', tab_id: 'tab-1' },
      throwOnError: true,
    });
    expect(config.onCleared).toHaveBeenCalledWith(['analysis-1']);
  });

  it('cancels exactly the Analysis owned by the Tab', async () => {
    const config = baseConfig();
    mocks.session.analysis = analysis({ state: 'running' });
    const { result } = renderHook(() => useAnalysisFeature(config), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.stopTask();
    });

    expect(mocks.cancelAnalysis).toHaveBeenCalledWith({
      path: { workspace_id: 'workspace-1', analysis_id: 'analysis-1' },
      throwOnError: true,
    });
  });

  it('releases a locally submitted Preview after successful Run All supersedes it', async () => {
    mocks.session.analysis = analysis({
      execution_scope: 'preview',
      state: 'running',
    });
    const initialConfig = {
      ...baseConfig(),
      tabAnalysisIds: ['analysis-1'],
    };
    const { result, rerender } = renderHook(
      ({ config }: { config: ReturnType<typeof baseConfig> & { tabAnalysisIds: string[] } }) =>
        useAnalysisFeature(config),
      {
        initialProps: { config: initialConfig },
        wrapper: createWrapper(),
      },
    );

    act(() => {
      result.current.setLocalTaskId('analysis-1');
      result.current.setIsRunning(true);
    });
    expect(result.current.isRunning).toBe(true);

    rerender({
      config: {
        ...initialConfig,
        hydrationTaskId: null,
        tabAnalysisIds: ['run-all-1'],
        retiredAnalysisIds: ['analysis-1'],
      },
    });

    await waitFor(() => {
      expect(result.current.request).toBeNull();
      expect(result.current.isRunning).toBe(false);
    });
  });
});
