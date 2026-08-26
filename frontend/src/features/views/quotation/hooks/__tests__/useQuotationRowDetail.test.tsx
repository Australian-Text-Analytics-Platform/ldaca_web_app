import { describe, expect, it } from 'vitest';

import { QUOTATION_COLUMN_KEYS } from '../../../common/generatedColumns';
import { normalizeQuotationRow } from '../../quotationResultsModel';
import {
  buildQuotationRowDetailCustomization,
  buildQuotationRowDetailPayload,
} from '../../quotationRowDetail';

describe('quotationRowDetail', () => {
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

  it('builds quotation summary fields and generated-column exclusions', () => {
    const normalized = normalizeQuotationRow(row, 'text');
    const payload = buildQuotationRowDetailPayload(normalized);
    const customization = buildQuotationRowDetailCustomization(normalized);

    expect(payload.record).toMatchObject(row);
    expect(payload.textColumn).toBe('text');
    expect(payload.fullText).toBe('Alice said hello.');
    expect(payload.excludeMetadataColumns).toContain(QUOTATION_COLUMN_KEYS.quote);
    expect(payload.excludeMetadataColumns).toContain('__spans');

    const fields = customization.summaryFields ?? [];
    expect(fields.map((field) => [field.label, field.value])).toEqual([
      ['Quote Type', 'direct'],
      ['Speaker', 'Alice'],
      ['Verb', 'said'],
      ['Quote', 'hello'],
    ]);
    expect(customization.renderDocumentText?.('Alice said hello.', row)).toBeTruthy();
  });

  it('omits full text when the selected text column is absent', () => {
    const normalized = normalizeQuotationRow(row, 'missing_text');
    expect(buildQuotationRowDetailPayload(normalized).fullText).toBe('');
    expect(buildQuotationRowDetailCustomization(normalized).label).toBe('Quotation');
  });
});
