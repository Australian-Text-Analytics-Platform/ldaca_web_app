import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QUOTATION_COLUMN_KEYS } from '../../../common/generatedColumns';
import { normalizeQuotationRow } from '../../quotationResultsModel';
import { useQuotationRowDetail } from '../useQuotationRowDetail';

describe('useQuotationRowDetail', () => {
  const row = {
    text: 'Alice said hello.',
    metadata: 'kept',
    [QUOTATION_COLUMN_KEYS.quoteType]: 'direct',
    [QUOTATION_COLUMN_KEYS.speaker]: 'Alice',
    [QUOTATION_COLUMN_KEYS.verb]: 'said',
    [QUOTATION_COLUMN_KEYS.quote]: 'hello',
    [QUOTATION_COLUMN_KEYS.speakerStartIdx]: 0,
    [QUOTATION_COLUMN_KEYS.speakerEndIdx]: 5,
    [QUOTATION_COLUMN_KEYS.verbStartIdx]: 6,
    [QUOTATION_COLUMN_KEYS.verbEndIdx]: 10,
    [QUOTATION_COLUMN_KEYS.quoteStartIdx]: 11,
    [QUOTATION_COLUMN_KEYS.quoteEndIdx]: 16,
  };

  it('opens row details with quotation summary fields and generated-column exclusions', () => {
    const { result } = renderHook(() => useQuotationRowDetail());

    act(() => {
      result.current.handleRowClick(normalizeQuotationRow(row, 'text'));
    });

    expect(result.current.detailOpen).toBe(true);
    expect(result.current.detailPayload?.record).toMatchObject(row);
    expect(result.current.detailPayload?.textColumn).toBe('text');
    expect(result.current.detailPayload?.fullText).toBe('Alice said hello.');
    expect(result.current.detailPayload?.excludeMetadataColumns).toContain(
      QUOTATION_COLUMN_KEYS.quote,
    );
    expect(result.current.detailPayload?.excludeMetadataColumns).toContain('__spans');

    const fields = result.current.quotationCustomization?.summaryFields ?? [];
    expect(fields.map((field) => [field.label, field.value])).toEqual([
      ['Quote Type', 'direct'],
      ['Speaker', 'Alice'],
      ['Verb', 'said'],
      ['Quote', 'hello'],
    ]);
    expect(
      result.current.quotationCustomization?.renderDocumentText?.('Alice said hello.', row),
    ).toBeTruthy();
  });

  it('omits full text when the selected text column is absent', () => {
    const { result } = renderHook(() => useQuotationRowDetail());

    act(() => {
      result.current.handleRowClick(normalizeQuotationRow(row, 'missing_text'));
    });

    expect(result.current.detailPayload?.fullText).toBe('');
    expect(result.current.quotationCustomization?.label).toBe('Quotation');
  });
});
