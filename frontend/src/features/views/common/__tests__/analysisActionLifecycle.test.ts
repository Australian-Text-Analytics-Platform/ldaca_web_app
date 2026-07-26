import { describe, expect, it } from 'vitest';

import { getAnalysisActionLifecycle } from '../analysisActionLifecycle';

describe('getAnalysisActionLifecycle', () => {
  it('keeps Preview and Run All available before either Analysis exists', () => {
    expect(
      getAnalysisActionLifecycle({
        isPreviewing: false,
        isSubmittingRunAll: false,
        runAllState: null,
        hasActiveAnalysis: false,
      }),
    ).toEqual({
      isPreviewing: false,
      isRunningAll: false,
      parametersLocked: false,
      previewDisabled: false,
      runAllDisabled: false,
    });
  });

  it('keeps Preview as the only running action during Preview execution', () => {
    expect(
      getAnalysisActionLifecycle({
        isPreviewing: true,
        isSubmittingRunAll: false,
        runAllState: null,
        hasActiveAnalysis: true,
      }),
    ).toEqual({
      isPreviewing: true,
      isRunningAll: false,
      parametersLocked: false,
      previewDisabled: true,
      runAllDisabled: true,
    });
  });

  it.each([
    'queued',
    'running',
  ] as const)('attributes an active %s Run All lifecycle to Run All instead of Preview', (runAllState) => {
    expect(
      getAnalysisActionLifecycle({
        isPreviewing: true,
        isSubmittingRunAll: false,
        runAllState,
        hasActiveAnalysis: true,
      }),
    ).toEqual({
      isPreviewing: false,
      isRunningAll: true,
      parametersLocked: true,
      previewDisabled: true,
      runAllDisabled: true,
    });
  });

  it('unlocks parameters and actions after Run All succeeds', () => {
    expect(
      getAnalysisActionLifecycle({
        // A superseded Preview resource may still be present in an individual
        // Query cache. The canonical Run All lifecycle must win presentation.
        isPreviewing: true,
        isSubmittingRunAll: false,
        runAllState: 'succeeded',
        hasActiveAnalysis: false,
      }),
    ).toEqual({
      isPreviewing: false,
      isRunningAll: false,
      parametersLocked: false,
      previewDisabled: false,
      runAllDisabled: false,
    });
  });

  it.each([
    'failed',
    'cancelled',
  ] as const)('unlocks both actions after Run All is %s', (runAllState) => {
    expect(
      getAnalysisActionLifecycle({
        isPreviewing: false,
        isSubmittingRunAll: false,
        runAllState,
        hasActiveAnalysis: false,
      }),
    ).toEqual({
      isPreviewing: false,
      isRunningAll: false,
      parametersLocked: false,
      previewDisabled: false,
      runAllDisabled: false,
    });
  });
});
