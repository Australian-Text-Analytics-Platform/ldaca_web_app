import { describe, expect, it } from 'vitest';

import { defaultNodeNameFromFile } from '../fileTreeHelpers';

describe('defaultNodeNameFromFile', () => {
  it('strips a known extension and keeps last two path components', () => {
    expect(defaultNodeNameFromFile('sample_data/Hansard/housing_agenda.csv')).toBe(
      'Hansard/housing_agenda',
    );
  });

  it('returns just the stem when the file lives at the data root', () => {
    expect(defaultNodeNameFromFile('corpus.parquet')).toBe('corpus');
  });

  it('handles backslash separators (windows-style upload paths)', () => {
    expect(defaultNodeNameFromFile('LDaCA\\Sydney\\dataset.tsv')).toBe('Sydney/dataset');
  });

  it('is case-insensitive on the extension match', () => {
    expect(defaultNodeNameFromFile('Reports/Q1.CSV')).toBe('Reports/Q1');
  });

  it('leaves files with no recognised extension untouched', () => {
    expect(defaultNodeNameFromFile('Reports/Q1.unknown')).toBe('Reports/Q1.unknown');
  });

  it('returns empty string when the filename is empty', () => {
    expect(defaultNodeNameFromFile('')).toBe('');
  });
});
