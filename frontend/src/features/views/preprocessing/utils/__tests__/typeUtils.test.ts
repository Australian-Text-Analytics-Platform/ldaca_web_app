import { Field, FixedSizeList, Float64, Int64, LargeList, Struct, Utf8View } from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { TOPIC_COVERAGE_EXTENSION } from '@/lib/arrow/semanticTypes';
import { getOperatorsForField } from '../typeUtils';

describe('preprocessing type utils', () => {
  it('offers checklist operators directly from an Arrow list-of-strings field', () => {
    const field = new Field('words', new LargeList(new Field('item', new Utf8View())));
    expect(getOperatorsForField(field)).toEqual([{ value: 'in', label: 'contains any of' }]);
  });

  it('offers comparison operators from Topic Coverage extension metadata', () => {
    const entry = new Field(
      'item',
      new Struct([new Field('topic_id', new Int64()), new Field('coverage', new Float64())]),
    );
    const field = new Field(
      'coverage',
      new FixedSizeList(2, entry),
      true,
      new Map([['ARROW:extension:name', TOPIC_COVERAGE_EXTENSION]]),
    );
    expect(getOperatorsForField(field)).toEqual([
      { value: 'gte', label: '≥' },
      { value: 'gt', label: '>' },
      { value: 'lte', label: '≤' },
      { value: 'lt', label: '<' },
    ]);
  });
});
