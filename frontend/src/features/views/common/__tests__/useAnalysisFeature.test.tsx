import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnalysisFeature } from '../hooks/useAnalysisFeature';

const {
  cancelAnalysisMock,
  clearAnalysisMock,
  hydrateFromServerMock,
  taskFlowOptionsMock,
  toastErrorMock,
} =
  vi.hoisted(() => ({
    cancelAnalysisMock: vi.fn(),
    clearAnalysisMock: vi.fn(),
    hydrateFromServerMock: vi.fn(() => Promise.resolve()),
    taskFlowOptionsMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(() => undefined),
  }),
}));

vi.mock('../clearAnalysis', () => ({
  clearAnalysis: clearAnalysisMock,
}));

vi.mock('sonner', () => ({
  toast: { error: toastErrorMock },
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  cancelAnalysis: cancelAnalysisMock,
}));

vi.mock('../useAnalysisHydration', () => ({
  useAnalysisHydration: () => ({
    hydrateFromServer: hydrateFromServerMock,
    hydrationState: { status: 'idle' as const },
  }),
}));

vi.mock('../tasks/useAnalysisTaskFlow', () => ({
  useAnalysisTaskFlow: (options: unknown) => {
    taskFlowOptionsMock(options);
    return {
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
    };
  },
}));

describe('useAnalysisFeature', () => {
  beforeEach(() => {
    cancelAnalysisMock.mockReset();
    cancelAnalysisMock.mockResolvedValue({ data: { state: 'cancelled' }, error: undefined });
    clearAnalysisMock.mockReset();
    clearAnalysisMock.mockImplementation(({ onCleanup }) => {
      onCleanup(['task-1']);
    });
    hydrateFromServerMock.mockClear();
    taskFlowOptionsMock.mockClear();
    toastErrorMock.mockClear();
  });

  it('passes clear options through to onCleared cleanup handlers', async () => {
    const onCleared = vi.fn();

    const { result } = renderHook(() =>
      useAnalysisFeature({
        analysisType: 'sequential_analysis',
        taskType: 'sequential_analysis',
        workspaceId: 'workspace-1',
        tabId: 'tab-1',
        isTabActive: true,
        resultRef: { current: null },
        fetchResult: vi.fn(() => Promise.resolve(null)),
        onResultFetched: vi.fn(),
        onCleared,
      }),
    );

    let cleared = false;
    await act(async () => {
      cleared = await result.current.clearResults({ preserveLocalState: true });
    });

    expect(cleared).toBe(true);
    expect(clearAnalysisMock).toHaveBeenCalledTimes(1);
    expect(onCleared).toHaveBeenCalledWith(['task-1'], {
      preserveLocalState: true,
    });
  });

  it('keeps local Analysis state and reports the backend message when clear fails', async () => {
    const onCleared = vi.fn();
    clearAnalysisMock.mockRejectedValueOnce(new Error('Workspace is closing'));

    const { result } = renderHook(() =>
      useAnalysisFeature({
        analysisType: 'token_frequencies',
        taskType: 'token_frequencies',
        workspaceId: 'workspace-1',
        tabId: 'tab-1',
        isTabActive: true,
        hydrationTaskId: 'analysis-1',
        resultRef: { current: null },
        fetchResult: vi.fn(() => Promise.resolve(null)),
        onResultFetched: vi.fn(),
        onCleared,
      }),
    );

    let cleared = true;
    await act(async () => {
      cleared = await result.current.clearResults();
    });

    expect(cleared).toBe(false);
    expect(onCleared).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Workspace is closing');
  });

  it('cancels the resolved analysis task from the owning analysis tab', async () => {
    const { result } = renderHook(() =>
      useAnalysisFeature({
        analysisType: 'sequential_analysis',
        taskType: 'sequential_analysis',
        workspaceId: 'workspace-1',
        tabId: 'tab-1',
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

    expect(cancelAnalysisMock).toHaveBeenCalledWith({
      path: { workspace_id: 'workspace-1', analysis_id: 'task-1' },
      throwOnError: true,
    });
  });

  it('passes explicit empty and hydrated tab-owned task ids to task status', () => {
    const baseConfig = {
      analysisType: 'token_frequencies' as const,
      taskType: 'token_frequencies',
      workspaceId: 'workspace-1',
      tabId: 'tab-1',
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

    expect(taskFlowOptionsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1', taskIds: [] }),
    );

    rerender({ taskId: 'owned-task' });

    expect(taskFlowOptionsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1', taskIds: ['owned-task'] }),
    );
  });

  it('fetches a terminal refresh delivered for the task owned by the active tab', async () => {
    const terminalResult = { state: 'successful', metadata: { task_id: 'owned-task' } };
    const fetchResult = vi.fn(() => Promise.resolve(terminalResult));
    const onResultFetched = vi.fn();

    renderHook(() =>
      useAnalysisFeature({
        analysisType: 'token_frequencies',
        taskType: 'token_frequencies',
        workspaceId: 'workspace-1',
        tabId: 'tab-1',
        isTabActive: true,
        hydrationTaskId: 'owned-task',
        resultRef: { current: null },
        fetchResult,
        onResultFetched,
        onCleared: vi.fn(),
      }),
    );

    const taskFlowOptions = taskFlowOptionsMock.mock.lastCall?.[0] as {
      refreshResults?: (context: {
        reason: 'terminal';
        task: null;
        taskId: string;
        taskState: 'successful';
      }) => Promise<void>;
    };

    await act(async () => {
      await taskFlowOptions.refreshResults?.({
        reason: 'terminal',
        task: null,
        taskId: 'owned-task',
        taskState: 'successful',
      });
    });

    expect(fetchResult).toHaveBeenCalledWith('owned-task');
    expect(onResultFetched).toHaveBeenCalledWith(terminalResult, 'owned-task');
  });

  it('finishes a failed Analysis without requesting a successful Result resource', async () => {
    const fetchResult = vi.fn(() => Promise.resolve(null));
    const onResultFetched = vi.fn();

    const { result } = renderHook(() =>
      useAnalysisFeature({
        analysisType: 'token_frequencies',
        taskType: 'token_frequencies',
        workspaceId: 'workspace-1',
        tabId: 'tab-1',
        isTabActive: true,
        hydrationTaskId: 'owned-task',
        resultRef: { current: null },
        fetchResult,
        onResultFetched,
        onCleared: vi.fn(),
      }),
    );

    act(() => {
      result.current.setIsRunning(true);
    });

    const taskFlowOptions = taskFlowOptionsMock.mock.lastCall?.[0] as {
      refreshResults?: (context: {
        reason: 'terminal';
        task: null;
        taskId: string;
        taskState: 'failed';
      }) => Promise<void>;
    };

    await act(async () => {
      await taskFlowOptions.refreshResults?.({
        reason: 'terminal',
        task: null,
        taskId: 'owned-task',
        taskState: 'failed',
      });
    });

    expect(fetchResult).not.toHaveBeenCalled();
    expect(onResultFetched).not.toHaveBeenCalled();
    expect(result.current.isRunning).toBe(false);
    expect(result.current.lastFetchedRef.current).toEqual({
      taskId: 'owned-task',
      state: 'failed',
    });
  });

  it('hydrates again when the owning tab task id changes after a run', async () => {
    const baseConfig = {
      analysisType: 'token_frequencies' as const,
      taskType: 'token_frequencies',
      workspaceId: 'workspace-1',
      tabId: 'tab-1',
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

    await waitFor(() => {
      expect(hydrateFromServerMock).toHaveBeenCalledTimes(1);
    });

    rerender({ taskId: 'new-run-task' });

    await waitFor(() => {
      expect(hydrateFromServerMock).toHaveBeenCalledTimes(2);
    });
  });
});
