import { describe, expect, it } from 'vitest';

import { getRerunActionState } from '../rerunActionState';

const baseInput = {
  hasWorkspace: true,
  isRunnable: true,
  hasAttachedAnalysis: false,
  analysisState: null,
  hasChanges: true,
};

describe('getRerunActionState', () => {
  it('enables Run and disables Clear before the Tab owns an Analysis', () => {
    expect(getRerunActionState(baseInput)).toMatchObject({
      runLabel: 'Run',
      runDisabled: false,
      clearDisabled: true,
    });
  });

  it.each([
    'queued',
    'running',
  ] as const)('disables Re-run and enables Clear while an Analysis is %s', (analysisState) => {
    expect(
      getRerunActionState({
        ...baseInput,
        hasAttachedAnalysis: true,
        analysisState,
      }),
    ).toMatchObject({
      runLabel: 'Re-run',
      runDisabled: true,
      clearDisabled: false,
    });
  });

  it('requires a change before rerunning a successful Analysis', () => {
    expect(
      getRerunActionState({
        ...baseInput,
        hasAttachedAnalysis: true,
        analysisState: 'successful',
        hasChanges: false,
      }),
    ).toMatchObject({
      runLabel: 'Re-run',
      runDisabled: true,
      clearDisabled: false,
    });
  });

  it.each([
    'failed',
    'cancelled',
  ] as const)('enables unchanged retry and Clear after an Analysis is %s', (analysisState) => {
    expect(
      getRerunActionState({
        ...baseInput,
        hasAttachedAnalysis: true,
        analysisState,
        hasChanges: false,
      }),
    ).toMatchObject({
      runLabel: 'Re-run',
      runDisabled: false,
      clearDisabled: false,
    });
  });

  it('keeps Clear available but disables retry for an attached Analysis with unknown state', () => {
    expect(
      getRerunActionState({
        ...baseInput,
        hasAttachedAnalysis: true,
        analysisState: null,
        hasChanges: false,
      }),
    ).toMatchObject({
      runLabel: 'Re-run',
      runDisabled: true,
      clearDisabled: false,
    });
  });
});
