import { describe, expect, it } from 'vitest';

import { getAnalysisActionLifecycle, hasClearRequiredAnalysis } from '../analysisActionLifecycle';

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

  it('locks parameters and both actions during Preview execution', () => {
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
      parametersLocked: true,
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

  it('locks at the local Run All submission boundary before an Analysis exists', () => {
    expect(
      getAnalysisActionLifecycle({
        isPreviewing: false,
        isSubmittingRunAll: true,
        runAllState: null,
        hasActiveAnalysis: false,
      }),
    ).toMatchObject({
      isRunningAll: true,
      parametersLocked: true,
      previewDisabled: true,
      runAllDisabled: true,
    });
  });

  it('unlocks parameters and actions after Run All succeeds', () => {
    expect(
      getAnalysisActionLifecycle({
        isPreviewing: false,
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

  it('blocks both actions without locking parameters when Clear Results is required', () => {
    expect(
      getAnalysisActionLifecycle({
        isPreviewing: false,
        isSubmittingRunAll: false,
        runAllState: 'failed',
        hasActiveAnalysis: false,
        requiresClear: true,
      }),
    ).toEqual({
      isPreviewing: false,
      isRunningAll: false,
      parametersLocked: false,
      previewDisabled: true,
      runAllDisabled: true,
    });
  });

  it('requires Clear for failed or cancelled roots but ignores supporting Analyses', () => {
    const analysis = (executionScope: 'preview' | 'supporting', state: 'failed' | 'cancelled') =>
      ({ execution_scope: executionScope, state }) as Parameters<
        typeof hasClearRequiredAnalysis
      >[0][number];

    expect(hasClearRequiredAnalysis([analysis('supporting', 'failed')])).toBe(false);
    expect(hasClearRequiredAnalysis([analysis('preview', 'failed')])).toBe(true);
    expect(hasClearRequiredAnalysis([analysis('preview', 'cancelled')])).toBe(true);
  });
});
