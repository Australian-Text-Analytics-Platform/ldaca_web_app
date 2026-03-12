import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnalysisFeature } from '../hooks/useAnalysisFeature';

const { clearAnalysisMock } = vi.hoisted(() => ({
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
});
