import { describe, expect, it } from 'vitest';

import type { QuotationGroupedRow } from '@/api/text';

import { flattenQuotationGroups } from '../quotationViewModels';

describe('quotationViewModels', () => {
  it('flattens grouped quotation rows in document order', () => {
    const groups: QuotationGroupedRow[] = [
      [
        { id: 'a1', QUOTE_quote: 'alpha-1' },
        { id: 'a2', QUOTE_quote: 'alpha-2' },
      ],
      [
        { id: 'b1', QUOTE_quote: 'beta-1' },
      ],
    ];

    expect(flattenQuotationGroups(groups)).toEqual([
      { id: 'a1', QUOTE_quote: 'alpha-1' },
      { id: 'a2', QUOTE_quote: 'alpha-2' },
      { id: 'b1', QUOTE_quote: 'beta-1' },
    ]);
  });
});