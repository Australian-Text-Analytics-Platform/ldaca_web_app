import { describe, expect, it } from 'vitest';

import { QUOTATION_COLUMN_KEYS, QUOTATION_DOCUMENT_COLUMN } from '../../common/generatedColumns';
import {
  buildQuotationDisplayColumns,
  buildQuotationSegments,
  buildQuotationMetadataColumns,
  filterQuotationRowsWithQuotes,
  getQuotationHighlightColor,
  normalizeQuotationRow,
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
      normalizeQuotationRow({ id: 1, [QUOTATION_COLUMN_KEYS.quote]: 'hello' }, 'text'),
      normalizeQuotationRow({ id: 2, [QUOTATION_COLUMN_KEYS.quote]: '' }, 'text'),
      normalizeQuotationRow({ id: 3 }, 'text'),
    ];

    expect(filterQuotationRowsWithQuotes(rows)).toEqual([rows[0]]);
  });

  it('normalizes Python code-point indices before segmenting Unicode text', () => {
    const row = normalizeQuotationRow(
      {
        text: 'A😀BCD',
        [QUOTATION_COLUMN_KEYS.quote]: '😀B',
        [QUOTATION_COLUMN_KEYS.quoteStartIdx]: 1,
        [QUOTATION_COLUMN_KEYS.quoteEndIdx]: 3,
      },
      'text',
    );

    expect(row.spans).toEqual([{ start: 1, end: 4, type: 'quote' }]);
    expect(buildQuotationSegments(row.text, row.spans)).toEqual([
      { start: 0, end: 1, text: 'A', types: [], primaryType: null },
      { start: 1, end: 4, text: '😀B', types: ['quote'], primaryType: 'quote' },
      { start: 4, end: 6, text: 'CD', types: [], primaryType: null },
    ]);
  });

  it('normalizes custom overlapping spans once and preserves canonical type order', () => {
    const row = normalizeQuotationRow(
      {
        text: 'abcdef',
        __spans: [
          { start: 1, end: 5, type: 'speaker' },
          { start: 2, end: 4, type: 'quote' },
          { start: 3, end: 6, type: 'verb' },
          { start: -1, end: 1, type: 'quote' },
          { start: 0, end: 1, type: 'unknown' },
        ],
      },
      'text',
    );

    expect(row.spans).toEqual([
      { start: 1, end: 5, type: 'speaker' },
      { start: 2, end: 4, type: 'quote' },
      { start: 3, end: 6, type: 'verb' },
    ]);
    expect(buildQuotationSegments(row.text, row.spans).map((segment) => segment.types)).toEqual([
      [],
      ['speaker'],
      ['quote', 'speaker'],
      ['quote', 'speaker', 'verb'],
      ['speaker', 'verb'],
      ['verb'],
    ]);
  });

  it('keeps empty text and non-scalar metadata safe without renderer parsing', () => {
    const row = normalizeQuotationRow(
      {
        text: null,
        metadata: { source: 'archive' },
        [QUOTATION_COLUMN_KEYS.quoteType]: 2,
      },
      'text',
    );

    expect(row.text).toBe('');
    expect(row.quoteType).toBe('2');
    expect(row.cellText('metadata')).toBe('{"source":"archive"}');
    expect(row.spans).toEqual([]);
  });

  it('owns a stable highlight palette', () => {
    expect((['speaker', 'quote', 'verb'] as const).map(getQuotationHighlightColor)).toEqual([
      '#2563eb',
      '#059669',
      '#7c3aed',
    ]);
  });
});
