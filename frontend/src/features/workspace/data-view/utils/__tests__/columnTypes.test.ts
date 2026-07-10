import { describe, expect, it } from 'vitest';
import { filterColumnsByType, mapColumnsToInfo, normalizeTypeName } from '../columnTypes';

describe('column type normalization', () => {
  it('maps known backend dtypes to canonical UI types', () => {
    expect(normalizeTypeName('Utf8')).toBe('string');
    expect(normalizeTypeName('Int64')).toBe('integer');
    expect(normalizeTypeName('List(String)')).toBe('list[string]');
  });

  it('keeps missing and unrecognized dtypes unknown instead of assuming string', () => {
    expect(normalizeTypeName(undefined)).toBe('unknown');
    expect(normalizeTypeName('mystery')).toBe('unknown');
  });
});

describe('mapColumnsToInfo', () => {
  it('uses the generated schema map and preserves column order', () => {
    expect(
      mapColumnsToInfo({
        columns: ['title', 'count'],
        schema: { title: 'Utf8', count: 'Int64' },
      }),
    ).toEqual([
      { name: 'title', dataType: 'string' },
      { name: 'count', dataType: 'integer' },
    ]);
  });

  it('does not treat a bare columns list as string evidence', () => {
    expect(mapColumnsToInfo({ columns: ['title'] })).toEqual([
      { name: 'title', dataType: 'unknown' },
    ]);
  });

  it('therefore leaves string-only filters empty without dtype evidence', () => {
    const columns = mapColumnsToInfo({ columns: ['title'] });
    expect(filterColumnsByType(columns, ['string'])).toEqual([]);
  });
});
