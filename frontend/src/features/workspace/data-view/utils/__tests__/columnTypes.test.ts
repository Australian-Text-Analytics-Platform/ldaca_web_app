import { Field, Int64, Utf8 } from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { filterColumnsByType, mapArrowColumnsToInfo } from '../columnTypes';

describe('Arrow column metadata', () => {
  const fields = [
    { name: 'title', kind: 'string' as const, field: new Field('title', new Utf8()) },
    { name: 'count', kind: 'integer' as const, field: new Field('count', new Int64()) },
  ];

  it('preserves Arrow field order and semantic kinds', () => {
    expect(mapArrowColumnsToInfo(fields)).toEqual([
      { name: 'title', dataType: 'string', field: fields[0]?.field },
      { name: 'count', dataType: 'integer', field: fields[1]?.field },
    ]);
  });

  it('filters only by semantic kinds derived from Arrow', () => {
    expect(filterColumnsByType(mapArrowColumnsToInfo(fields), ['string'])).toEqual([
      { name: 'title', dataType: 'string', field: fields[0]?.field },
    ]);
  });
});
