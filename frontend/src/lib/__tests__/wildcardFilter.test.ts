import { describe, expect, it } from 'vitest';

import { createWildcardMatcher, filterByWildcard } from '../wildcardFilter';

const COLUMNS = [
  'speaker_id',
  'Speaker_Name',
  'utterance_text',
  'utterance.count',
  'session (2024)',
  'notes',
];

describe('createWildcardMatcher', () => {
  it('returns null for a blank query so callers can skip filtering', () => {
    expect(createWildcardMatcher('')).toBeNull();
    expect(createWildcardMatcher('   ')).toBeNull();
  });
});

describe('filterByWildcard', () => {
  it('returns every value when the query is blank', () => {
    expect(filterByWildcard(COLUMNS, '  ')).toEqual(COLUMNS);
  });

  it('matches case-insensitive substrings for plain queries', () => {
    expect(filterByWildcard(COLUMNS, 'speaker')).toEqual(['speaker_id', 'Speaker_Name']);
    expect(filterByWildcard(COLUMNS, 'TEXT')).toEqual(['utterance_text']);
  });

  it('treats * as any run of characters, anchored to the whole name', () => {
    expect(filterByWildcard(COLUMNS, 'utterance*')).toEqual(['utterance_text', 'utterance.count']);
    expect(filterByWildcard(COLUMNS, '*_id')).toEqual(['speaker_id']);
    expect(filterByWildcard(COLUMNS, '*')).toEqual(COLUMNS);
  });

  it('treats ? as exactly one character', () => {
    expect(filterByWildcard(['a1', 'a12', 'b1'], 'a?')).toEqual(['a1']);
  });

  it('anchors wildcard queries, so a bare fragment does not match', () => {
    expect(filterByWildcard(COLUMNS, 'speaker*')).toEqual(['speaker_id', 'Speaker_Name']);
    expect(filterByWildcard(COLUMNS, '*eaker')).toEqual([]);
  });

  it('matches regex metacharacters in column names literally', () => {
    expect(filterByWildcard(COLUMNS, 'utterance.')).toEqual(['utterance.count']);
    expect(filterByWildcard(COLUMNS, '(2024)')).toEqual(['session (2024)']);
    expect(filterByWildcard(COLUMNS, 'session*')).toEqual(['session (2024)']);
  });

  it('preserves the original column order', () => {
    expect(filterByWildcard(COLUMNS, '*e*')).toEqual([
      'speaker_id',
      'Speaker_Name',
      'utterance_text',
      'utterance.count',
      'session (2024)',
      'notes',
    ]);
  });
});
