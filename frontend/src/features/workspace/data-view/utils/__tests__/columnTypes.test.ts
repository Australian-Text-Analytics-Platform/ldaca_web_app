import { Field, Int64, Utf8 } from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { mapArrowColumnsToInfo } from '../columnTypes';

describe('Arrow column metadata', () => {
  const fields = [
    { name: 'title', field: new Field('title', new Utf8()) },
    { name: 'count', field: new Field('count', new Int64()) },
  ];

  it('preserves Arrow field order and native type names', () => {
    expect(mapArrowColumnsToInfo(fields)).toEqual([
      { name: 'title', typeName: 'Utf8', field: fields[0]?.field },
      { name: 'count', typeName: 'Int64', field: fields[1]?.field },
    ]);
  });
});
