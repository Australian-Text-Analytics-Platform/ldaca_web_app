import { describe, expect, it } from 'vitest';

import { QUOTATION_COLUMN_KEYS, QUOTATION_DOCUMENT_COLUMN } from '../../common/generatedColumns';
import {
  buildQuotationDisplayColumns,
  buildQuotationMetadataColumns,
  filterQuotationRowsWithQuotes,
  resolveQuotationMetadataColumns,
} from '../quotationResultsModel';

describe('quotationResultsModel', () => {
  it('offers backend metadata first and generated quotation columns when present', () => {
    expect(
      buildQuotationMetadataColumns({
        metadata: {
          metadata_columns: ['source', '__internal', 'speaker'],
          quotation_columns: [
            QUOTATION_COLUMN_KEYS.quote,
            QUOTATION_COLUMN_KEYS.speaker,
            QUOTATION_COLUMN_KEYS.quoteType,
          ],
        },
      }),
    ).toEqual([
      'source',
      'speaker',
      QUOTATION_COLUMN_KEYS.quote,
      QUOTATION_COLUMN_KEYS.speaker,
      QUOTATION_COLUMN_KEYS.quoteType,
    ]);
  });

  it('filters selected metadata columns against the available result shape', () => {
    expect(
      resolveQuotationMetadataColumns(['source', 'missing', 'speaker'], ['speaker', 'source']),
    ).toEqual(['source', 'speaker']);
  });

  it('builds document-first display columns without duplicates', () => {
    expect(buildQuotationDisplayColumns(['source', QUOTATION_DOCUMENT_COLUMN, 'source'])).toEqual([
      QUOTATION_DOCUMENT_COLUMN,
      'source',
    ]);
  });

  it('keeps only rows that contain a quotation value', () => {
    const rows = [
      { id: 1, [QUOTATION_COLUMN_KEYS.quote]: 'hello' },
      { id: 2, [QUOTATION_COLUMN_KEYS.quote]: '' },
      { id: 3 },
    ];

    expect(filterQuotationRowsWithQuotes(rows)).toEqual([
      { id: 1, [QUOTATION_COLUMN_KEYS.quote]: 'hello' },
    ]);
  });
});
