import { describe, expect, it, vi } from 'vitest';

import { executeAnalysisRerun } from '../rerunAnalysis';

describe('executeAnalysisRerun', () => {
  it('clears an attached Analysis before rerunning', async () => {
    const events: string[] = [];

    await executeAnalysisRerun({
      hasAttachedAnalysis: true,

      clearResults: async (options) => {
        expect(options).toEqual({ preserveLocalState: true });
        events.push('clear');
        return true;
      },

      runFreshAnalysis: async () => {
        events.push('run');
      },
    });

    expect(events).toEqual(['clear', 'run']);
  });

  it('runs directly when the Tab has no attached Analysis', async () => {
    const clearResults = vi.fn(async () => true);
    const runFreshAnalysis = vi.fn(async () => {
      /* no-op mock */
    });

    await executeAnalysisRerun({
      hasAttachedAnalysis: false,
      clearResults,
      runFreshAnalysis,
    });

    expect(clearResults).not.toHaveBeenCalled();
    expect(runFreshAnalysis).toHaveBeenCalledTimes(1);
  });

  it('does not submit a replacement when clearing the attached Analysis fails', async () => {
    const clearResults = vi.fn(async () => false);
    const runFreshAnalysis = vi.fn(async () => {
      /* no-op mock */
    });

    await executeAnalysisRerun({
      hasAttachedAnalysis: true,
      clearResults,
      runFreshAnalysis,
    });

    expect(clearResults).toHaveBeenCalledWith({ preserveLocalState: true });
    expect(runFreshAnalysis).not.toHaveBeenCalled();
  });
});
