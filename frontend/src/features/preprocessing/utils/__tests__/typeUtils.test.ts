import { describe, expect, it } from 'vitest';
import {
  getOperatorsForType,
  normalizeTypeName as normalizePreprocessingType,
} from '../typeUtils';
import { normalizeTypeName as normalizeSharedType } from '@/utils/columnTypes';

describe('preprocessing type utils', () => {
  it('normalizes list string dtype to list_string', () => {
    expect(normalizePreprocessingType('List(String)')).toBe('list_string');
    expect(normalizePreprocessingType('list_string')).toBe('list_string');
  });

  it('maps non-string list/array dtypes to unknown', () => {
    expect(normalizePreprocessingType('List(Int64)')).toBe('unknown');
    expect(normalizePreprocessingType('Array(Int64, 2)')).toBe('unknown');
  });

  it('offers checklist operator set for list_string', () => {
    expect(getOperatorsForType('list_string')).toEqual([
      { value: 'in', label: 'contains any of' },
    ]);
  });
});

describe('shared column type utils', () => {
  it('normalizes list string dtype to list_string', () => {
    expect(normalizeSharedType('List(String)')).toBe('list_string');
  });

  it('maps non-string list/array dtypes to unknown', () => {
    expect(normalizeSharedType('List(Int64)')).toBe('unknown');
    expect(normalizeSharedType('Array(Int64, 3)')).toBe('unknown');
  });
});
