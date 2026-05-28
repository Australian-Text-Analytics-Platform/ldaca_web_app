import { describe, expect, it, vi } from 'vitest';

import { executeAnalysisRunOrUpdate } from '../runOrUpdate';

describe('executeAnalysisRunOrUpdate', () => {
  it('clears previous results before rerunning when parameters changed', async () => {
    const events: string[] = [];

    await executeAnalysisRunOrUpdate({
      hasLockedParameterChanges: true,
      /** Called by: executeAnalysisRunOrUpdate when locked parameters changed because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
      // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async interface
      clearResults: async () => {
        events.push('clear');
      },
      /** Called by: executeAnalysisRunOrUpdate after optional clear completes because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
      // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async interface
      runFreshAnalysis: async () => {
        events.push('run');
      },
    });

    expect(events).toEqual(['clear', 'run']);
  });

  it('runs directly when there is no locked-parameter update', async () => {
    const clearResults = vi.fn(async () => {});
    const runFreshAnalysis = vi.fn(async () => {});

    await executeAnalysisRunOrUpdate({
      hasLockedParameterChanges: false,
      clearResults,
      runFreshAnalysis,
    });

    expect(clearResults).not.toHaveBeenCalled();
    expect(runFreshAnalysis).toHaveBeenCalledTimes(1);
  });

  it('passes update clear options through to clearResults', async () => {
    const clearResults = vi.fn(async () => {});

    await executeAnalysisRunOrUpdate({
      hasLockedParameterChanges: true,
      clearResults,
      runFreshAnalysis: vi.fn(async () => {}),
      clearOptionsOnUpdate: { preserveLocalState: true },
    });

    expect(clearResults).toHaveBeenCalledWith({ preserveLocalState: true });
  });
});
