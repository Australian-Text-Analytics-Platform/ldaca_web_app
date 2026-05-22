import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnalysisFeature } from '../hooks/useAnalysisFeature';

const { cancelTaskMock, clearAnalysisMock } = vi.hoisted(() => ({
  cancelTaskMock: vi.fn(),
  clearAnalysisMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(async () => undefined),
  }),
}));

vi.mock('../clearAnalysis', () => ({
  clearAnalysis: clearAnalysisMock,
}));

vi.mock('@/api/workspaces', () => ({
  workspacesApi: {
    cancelTask: cancelTaskMock,
  },
}));

vi.mock('../useAnalysisHydration', () => ({
  useAnalysisHydration: () => ({
    hydrateFromServer: vi.fn(async () => undefined),
    hydrationState: { status: 'idle' as const },
  }),
}));

vi.mock('../tasks/useAnalysisTaskFlow', () => ({
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
    cancelTaskMock.mockResolvedValue({ state: 'successful' });
    clearAnalysisMock.mockReset();
    clearAnalysisMock.mockImplementation(async ({ onCleanup }) => {
      onCleanup(['task-1']);
    });
  });

  it('passes clear options through to onCleared cleanup handlers', async () => {
    const onCleared = vi.fn();

    const { result } = renderHook(() =>
      useAnalysisFeature({
        analysisType: 'sequential_analysis',
        taskType: 'sequential_analysis',
        workspaceId: 'workspace-1',
        getAuthHeaders: () => ({}),
        isTabActive: true,
        resultRef: { current: null },
        fetchResult: vi.fn(async () => null),
        onResultFetched: vi.fn(),
        onCleared,
      })
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
        getAuthHeaders: () => headers,
        isTabActive: true,
        resultRef: { current: { metadata: { task_id: 'task-1' } } },
        fetchResult: vi.fn(async () => null),
        onResultFetched: vi.fn(),
        onCleared: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.stopTask();
    });

    expect(cancelTaskMock).toHaveBeenCalledWith({ task_id: 'task-1' }, headers);
  });
});
