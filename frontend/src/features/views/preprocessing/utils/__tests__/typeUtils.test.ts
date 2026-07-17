import { describe, expect, it } from 'vitest';

import { getOperatorsForType } from '../typeUtils';

describe('preprocessing type utils', () => {
  it('offers checklist operators for Arrow-derived string-list columns', () => {
    expect(getOperatorsForType('string-list')).toEqual([{ value: 'in', label: 'contains any of' }]);
  });

  it('offers proportion operators for Topic Distribution columns', () => {
    expect(getOperatorsForType('topic-distribution')).toEqual([
      { value: 'gte', label: '≥' },
      { value: 'gt', label: '>' },
      { value: 'lte', label: '≤' },
      { value: 'lt', label: '<' },
    ]);
  });
});
