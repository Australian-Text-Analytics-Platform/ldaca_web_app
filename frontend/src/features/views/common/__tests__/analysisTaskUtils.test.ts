import { describe, expect, it } from 'vitest';

import { getTaskTypeCandidates } from '../analysisTaskUtils';

describe('analysisTaskUtils', () => {
  it('returns only the canonical task type supplied by the caller', () => {
    expect(getTaskTypeCandidates(' token_frequencies ')).toEqual(['token_frequencies']);
    expect(getTaskTypeCandidates('token-frequency')).toEqual(['token-frequency']);
    expect(getTaskTypeCandidates('')).toEqual([]);
  });
});
