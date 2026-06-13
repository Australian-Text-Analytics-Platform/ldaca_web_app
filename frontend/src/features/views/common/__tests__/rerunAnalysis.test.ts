import { describe, expect, it, vi } from 'vitest';

import { executeAnalysisRerun } from '../rerunAnalysis';

describe('executeAnalysisRerun', () => {
  it('clears previous results before rerunning when current inputs or params changed', async () => {
    const events: string[] = [];

    await executeAnalysisRerun({
      hasUnrunChanges: true,
      // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async interface
      clearResults: async () => {
        events.push('clear');
      },
      // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async interface
      runFreshAnalysis: async () => {
        events.push('run');
      },
    });

    expect(events).toEqual(['clear', 'run']);
  });

  it('runs directly when the current request matches the last run', async () => {
    const clearResults = vi.fn(async () => {
      /* no-op mock */
    });
    const runFreshAnalysis = vi.fn(async () => {
      /* no-op mock */
    });

    await executeAnalysisRerun({
      hasUnrunChanges: false,
      clearResults,
      runFreshAnalysis,
    });

    expect(clearResults).not.toHaveBeenCalled();
    expect(runFreshAnalysis).toHaveBeenCalledTimes(1);
  });

  it('passes rerun clear options through to clearResults', async () => {
    const clearResults = vi.fn(async () => {
      /* no-op mock */
    });

    await executeAnalysisRerun({
      hasUnrunChanges: true,
      clearResults,
      runFreshAnalysis: vi.fn(async () => {
        /* no-op mock */
      }),
      clearOptionsOnRerun: { preserveLocalState: true },
    });

    expect(clearResults).toHaveBeenCalledWith({ preserveLocalState: true });
  });
});
