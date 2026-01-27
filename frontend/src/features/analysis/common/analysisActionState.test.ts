import { describe, expect, it } from 'vitest';

import { getAnalysisActionState } from './analysisActionState';

describe('getAnalysisActionState', () => {
  it('disables run when locked unless allowRunWhenLocked', () => {
    const locked = getAnalysisActionState({
      hasWorkspace: true,
      hasSelection: true,
      isLocked: true,
      isBusy: false,
      hasActiveTask: false,
      hasResults: false,
    });
    expect(locked.runDisabled).toBe(true);

    const allowed = getAnalysisActionState({
      hasWorkspace: true,
      hasSelection: true,
      isLocked: true,
      allowRunWhenLocked: true,
      isBusy: false,
      hasActiveTask: false,
      hasResults: false,
    });
    expect(allowed.runDisabled).toBe(false);
  });

  it('disables run when selection/workspace missing or busy', () => {
    expect(
      getAnalysisActionState({
        hasWorkspace: false,
        hasSelection: true,
        isLocked: false,
        isBusy: false,
        hasActiveTask: false,
        hasResults: false,
      }).runDisabled
    ).toBe(true);

    expect(
      getAnalysisActionState({
        hasWorkspace: true,
        hasSelection: false,
        isLocked: false,
        isBusy: false,
        hasActiveTask: false,
        hasResults: false,
      }).runDisabled
    ).toBe(true);

    expect(
      getAnalysisActionState({
        hasWorkspace: true,
        hasSelection: true,
        isLocked: false,
        isBusy: true,
        hasActiveTask: false,
        hasResults: false,
      }).runDisabled
    ).toBe(true);
  });

  it('enables clear when locked, results exist, or task active', () => {
    expect(
      getAnalysisActionState({
        hasWorkspace: true,
        hasSelection: true,
        isLocked: true,
        isBusy: false,
        hasActiveTask: false,
        hasResults: false,
      }).clearDisabled
    ).toBe(false);

    expect(
      getAnalysisActionState({
        hasWorkspace: true,
        hasSelection: true,
        isLocked: false,
        isBusy: false,
        hasActiveTask: true,
        hasResults: false,
      }).clearDisabled
    ).toBe(false);

    expect(
      getAnalysisActionState({
        hasWorkspace: true,
        hasSelection: true,
        isLocked: false,
        isBusy: false,
        hasActiveTask: false,
        hasResults: true,
      }).clearDisabled
    ).toBe(false);
  });

  it('disables clear when nothing to clear', () => {
    expect(
      getAnalysisActionState({
        hasWorkspace: true,
        hasSelection: true,
        isLocked: false,
        isBusy: false,
        hasActiveTask: false,
        hasResults: false,
      }).clearDisabled
    ).toBe(true);
  });
});
