import { describe, expect, it } from 'vitest';

import { applyComparisonValueEdit } from '../columnComparisonModel';

describe('applyComparisonValueEdit', () => {
  it('moves one persisted comparison value between confusion-matrix cells', () => {
    expect(
      applyComparisonValueEdit(
        [
          { reference: 'covid', comparison: 'covid', count: 2 },
          { reference: 'covid', comparison: 'job', count: 1 },
        ],
        {
          reference: 'covid',
          previousComparison: 'covid',
          nextComparison: 'job',
        },
      ),
    ).toEqual([
      { reference: 'covid', comparison: 'covid', count: 1 },
      { reference: 'covid', comparison: 'job', count: 2 },
    ]);
  });

  it('ignores an edit when the reference value is null', () => {
    const rows = [{ reference: 'covid', comparison: 'covid', count: 2 }];
    expect(
      applyComparisonValueEdit(rows, {
        reference: null,
        previousComparison: 'covid',
        nextComparison: 'job',
      }),
    ).toBe(rows);
  });
});
