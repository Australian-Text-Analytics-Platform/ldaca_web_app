import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnalysisFeature } from '../hooks/useAnalysisFeature';

const { cancelTaskMock, clearAnalysisMock } = vi.hoisted(() => ({
  cancelTaskMock: vi.fn(),
  clearAnalysisMock: vi.fn(),
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
    hydrateFromServer: vi.fn(() => undefined),
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
});
