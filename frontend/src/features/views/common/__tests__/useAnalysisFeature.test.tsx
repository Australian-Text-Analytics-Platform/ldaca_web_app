import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnalysisFeature } from '../hooks/useAnalysisFeature';

const { cancelTaskMock, clearAnalysisMock, hydrateFromServerMock } = vi.hoisted(() => ({
  cancelTaskMock: vi.fn(),
  clearAnalysisMock: vi.fn(),
  hydrateFromServerMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tanstack/react-query', () => ({
  /** Called by: useAnalysisFeature under test when it requests a query client because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
  useQueryClient: () => ({
    invalidateQueries: vi.fn(() => undefined),
  }),
}));

vi.mock('../clearAnalysis', () => ({
  clearAnalysis: clearAnalysisMock,
}));

vi.mock('@/api/generated/sdk.gen', () => ({
  cancelTask: cancelTaskMock,
}));

vi.mock('../useAnalysisHydration', () => ({
  /** Called by: useAnalysisFeature under test while keeping hydration inert because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
  useAnalysisHydration: () => ({
    hydrateFromServer: hydrateFromServerMock,
    hydrationState: { status: 'idle' as const },
  }),
}));

vi.mock('../tasks/useAnalysisTaskFlow', () => ({
  /** Called by: useAnalysisFeature under test to provide empty task-flow state because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
  useAnalysisTaskFlow: () => ({
    status: {
      tasks: [],
      activeTaskId: null,
      runningTask: null,
      queuedTask: null,
      terminalTask: null,
      successfulTask: null,
      failedTask: null,
      bannerMessage: null,
    },
    banner: null,
    hasActiveTask: false,
  }),
}));

describe('useAnalysisFeature', () => {
  beforeEach(() => {
    cancelTaskMock.mockReset();
    cancelTaskMock.mockResolvedValue({ data: { state: 'successful' }, error: undefined });
    clearAnalysisMock.mockReset();
    clearAnalysisMock.mockImplementation(({ onCleanup }) => {
      onCleanup(['task-1']);
    });
    hydrateFromServerMock.mockClear();
  });

  it('passes clear options through to onCleared cleanup handlers', async () => {
    const onCleared = vi.fn();

    const { result } = renderHook(() =>
      useAnalysisFeature({
        analysisType: 'sequential_analysis',
        taskType: 'sequential_analysis',
        workspaceId: 'workspace-1',
        /** Called by: useAnalysisFeature clear plumbing if auth headers are needed because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
        getAuthHeaders: () => ({}),
        isTabActive: true,
        resultRef: { current: null },
        fetchResult: vi.fn(() => Promise.resolve(null)),
        onResultFetched: vi.fn(),
        onCleared,
      }),
    );

    await act(async () => {
      await result.current.clearResults({ preserveLocalState: true });
    });

    expect(clearAnalysisMock).toHaveBeenCalledTimes(1);
    expect(onCleared).toHaveBeenCalledWith(['task-1'], {
      preserveLocalState: true,
    });
  });

  it('cancels the resolved analysis task from the owning analysis tab', async () => {
    const headers = { Authorization: 'Bearer token' };

    const { result } = renderHook(() =>
      useAnalysisFeature({
        analysisType: 'sequential_analysis',
        taskType: 'sequential_analysis',
        workspaceId: 'workspace-1',
        /** Called by: stopTask before forwarding headers to cancelTask because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
        getAuthHeaders: () => headers,
        isTabActive: true,
        resultRef: { current: { metadata: { task_id: 'task-1' } } },
        fetchResult: vi.fn(() => Promise.resolve(null)),
        onResultFetched: vi.fn(),
        onCleared: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.stopTask();
    });

    expect(cancelTaskMock).toHaveBeenCalledWith({
      headers,
      query: { task_id: 'task-1' },
      throwOnError: true,
    });
  });

  it('ignores terminal refreshes for another task when a tab has no task id', async () => {
    const fetchResult = vi.fn(() => Promise.resolve({ state: 'successful' }));
    const onResultFetched = vi.fn();

    const { result } = renderHook(() =>
      useAnalysisFeature({
        analysisType: 'token_frequencies',
        taskType: 'token_frequencies',
        workspaceId: 'workspace-1',
        getAuthHeaders: () => ({}),
        isTabActive: true,
        hydrationTaskId: null,
        resultRef: { current: null },
        fetchResult,
        onResultFetched,
        onCleared: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.fetchAndApplyResult('task-from-first-tab', 'successful');
    });

    expect(fetchResult).not.toHaveBeenCalled();
    expect(onResultFetched).not.toHaveBeenCalled();
  });

  it('fetches terminal refreshes for the task owned by the active tab', async () => {
    const terminalResult = { state: 'successful', metadata: { task_id: 'owned-task' } };
    const fetchResult = vi.fn(() => Promise.resolve(terminalResult));
    const onResultFetched = vi.fn();

    const { result } = renderHook(() =>
      useAnalysisFeature({
        analysisType: 'token_frequencies',
        taskType: 'token_frequencies',
        workspaceId: 'workspace-1',
        getAuthHeaders: () => ({}),
        isTabActive: true,
        hydrationTaskId: 'owned-task',
        resultRef: { current: null },
        fetchResult,
        onResultFetched,
        onCleared: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.fetchAndApplyResult('owned-task', 'successful');
    });

    expect(fetchResult).toHaveBeenCalledWith('owned-task', {});
    expect(onResultFetched).toHaveBeenCalledWith(terminalResult, 'owned-task');
  });

  it('hydrates again when the owning tab task id changes after a run', async () => {
    const baseConfig = {
      analysisType: 'token_frequencies' as const,
      taskType: 'token_frequencies',
      workspaceId: 'workspace-1',
      getAuthHeaders: () => ({}),
      isTabActive: true,
      resultRef: { current: null },
      fetchResult: vi.fn(() => Promise.resolve(null)),
      onResultFetched: vi.fn(),
      onCleared: vi.fn(),
    };

    const { rerender } = renderHook(
      ({ taskId }: { taskId: string | null }) =>
        useAnalysisFeature({ ...baseConfig, hydrationTaskId: taskId }),
      { initialProps: { taskId: null as string | null } },
    );

    await waitFor(() => { expect(hydrateFromServerMock).toHaveBeenCalledTimes(1); });

    rerender({ taskId: 'new-run-task' });

    await waitFor(() => { expect(hydrateFromServerMock).toHaveBeenCalledTimes(2); });
  });
});
