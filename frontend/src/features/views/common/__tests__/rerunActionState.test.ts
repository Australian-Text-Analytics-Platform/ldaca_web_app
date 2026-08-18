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
  it('enables execution and disables Clear before the Tab owns an Analysis', () => {
    expect(getRerunActionState(baseInput)).toMatchObject({
      runDisabled: false,
      clearDisabled: true,
      clearDisabledReason: 'There are no results to clear',
    });
  });

  it('explains that Clear requires an open workspace', () => {
    expect(
      getRerunActionState({
        ...baseInput,
        hasWorkspace: false,
      }),
    ).toMatchObject({
      clearDisabled: true,
      clearDisabledReason: 'Open a workspace first',
    });
  });

  it.each([
    'queued',
    'running',
  ] as const)('disables execution and Clear while an Analysis is %s', (analysisState) => {
    expect(
      getRerunActionState({
        ...baseInput,
        hasAttachedAnalysis: true,
        analysisState,
      }),
    ).toMatchObject({
      runDisabled: true,
      clearDisabled: true,
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
      runDisabled: true,
      clearDisabled: false,
    });
  });

  it('enables the same static action after a successful request changes', () => {
    expect(
      getRerunActionState({
        ...baseInput,
        hasAttachedAnalysis: true,
        analysisState: 'succeeded',
        hasChanges: true,
      }),
    ).toMatchObject({
      runDisabled: false,
      clearDisabled: false,
    });
  });

  it.each([
    'failed',
    'cancelled',
  ] as const)('requires Clear before retrying an Analysis that is %s', (analysisState) => {
    expect(
      getRerunActionState({
        ...baseInput,
        hasAttachedAnalysis: true,
        analysisState,
        hasChanges: false,
      }),
    ).toMatchObject({
      runDisabled: true,
      clearDisabled: false,
      runDisabledReason: 'Clear Results before running again',
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
      runDisabled: true,
      clearDisabled: false,
    });
  });

  it('blocks an unsubmitted action when another root requires Clear', () => {
    expect(
      getRerunActionState({
        ...baseInput,
        requiresClear: true,
        hasAnyAnalysis: true,
      }),
    ).toMatchObject({
      runDisabled: true,
      clearDisabled: false,
      runDisabledReason: 'Clear Results before running again',
    });
  });
});
