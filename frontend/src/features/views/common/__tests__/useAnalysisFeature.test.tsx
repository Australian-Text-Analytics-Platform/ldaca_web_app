import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnalysisFeature } from '../hooks/useAnalysisFeature';

const { cancelTaskMock, clearAnalysisMock, hydrateFromServerMock, taskFlowOptionsMock } =
  vi.hoisted(() => ({
    cancelTaskMock: vi.fn(),
    clearAnalysisMock: vi.fn(),
    hydrateFromServerMock: vi.fn(() => Promise.resolve()),
    taskFlowOptionsMock: vi.fn(),
  }));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(() => undefined),
  }),
}));

vi.mock('../clearAnalysis', () => ({
  clearAnalysis: clearAnalysisMock,
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  cancelTask: cancelTaskMock,
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
    cancelTaskMock.mockReset();
    cancelTaskMock.mockResolvedValue({ data: { state: 'successful' }, error: undefined });
    clearAnalysisMock.mockReset();
    clearAnalysisMock.mockImplementation(({ onCleanup }) => {
      onCleanup(['task-1']);
    });
    hydrateFromServerMock.mockClear();
    taskFlowOptionsMock.mockClear();
  });

  it('passes clear options through to onCleared cleanup handlers', async () => {
    const onCleared = vi.fn();

    const { result } = renderHook(() =>
      useAnalysisFeature({
        analysisType: 'sequential_analysis',
        taskType: 'sequential_analysis',
        workspaceId: 'workspace-1',
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
    const { result } = renderHook(() =>
      useAnalysisFeature({
        analysisType: 'sequential_analysis',
        taskType: 'sequential_analysis',
        workspaceId: 'workspace-1',
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
      path: { task_id: 'task-1' },
      throwOnError: true,
    });
  });

  it('passes explicit empty and hydrated tab-owned task ids to task status', () => {
    const baseConfig = {
      analysisType: 'token_frequencies' as const,
      taskType: 'token_frequencies',
      workspaceId: 'workspace-1',
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

  it('hydrates again when the owning tab task id changes after a run', async () => {
    const baseConfig = {
      analysisType: 'token_frequencies' as const,
      taskType: 'token_frequencies',
      workspaceId: 'workspace-1',
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
