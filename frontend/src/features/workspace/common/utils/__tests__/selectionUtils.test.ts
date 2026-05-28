import { describe, it, expect } from 'vitest';
import { takeMostRecent } from '../selectionUtils';

describe('takeMostRecent', () => {
  it('returns items unchanged when count >= length', () => {
    expect(takeMostRecent([1, 2, 3], 3)).toEqual([1, 2, 3]);
    expect(takeMostRecent([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it('returns the last N items when count < length', () => {
    expect(takeMostRecent([1, 2, 3, 4, 5], 2)).toEqual([4, 5]);
    expect(takeMostRecent([1, 2, 3, 4, 5], 1)).toEqual([5]);
  });

  it('handles empty arrays', () => {
    expect(takeMostRecent([], 2)).toEqual([]);
  });

  it('works with string arrays', () => {
    expect(takeMostRecent(['a', 'b', 'c', 'd'], 2)).toEqual(['c', 'd']);
  });
});
