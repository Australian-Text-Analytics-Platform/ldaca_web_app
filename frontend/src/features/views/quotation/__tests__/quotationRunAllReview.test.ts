import { describe, expect, it } from 'vitest';
import { projectQuotationRunAllReviewPage } from '../quotationRunAllReview';

describe('Quotation Run All Review projection', () => {
  it('groups immutable rows and hides internal publication columns', () => {
    const result = projectQuotationRunAllReviewPage(
      {
        node_id: 'node-1',
        node_name: 'Documents',
        document_column: 'text',
        metadata_columns: ['speaker'],
        analysis_columns: ['QUOTE_extraction', 'QUOTE_quote'],
        internal_columns: ['__wordflow_source_row_id'],
        document_count: 1,
        match_count: 2,
        table: {
          delivery: 'projected',
          table_id: 'quotation-run-all',
          documents: { rows_url: '/documents/rows', schema_url: '/documents/schema' },
          matches: { rows_url: '/matches/rows', schema_url: '/matches/schema' },
          density_url: null,
        },
      },
      {
        table: {} as never,
        columns: ['__wordflow_source_row_id', 'text', 'speaker', 'QUOTE_quote'],
        schema: [],
        rows: [
          {
            __wordflow_source_row_id: 4,
            text: 'One document',
            speaker: 'A',
            quotation: [{ quote: 'One' }, { quote: 'document' }],
          },
        ],
        hasNext: false,
        etag: null,
      },
      { page: 1, page_size: 20, sort_by: null, descending: false },
      'documents',
    );

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toHaveLength(2);
    expect(result.columns).not.toContain('__wordflow_source_row_id');
    expect(result.metadata?.metadata_columns).toEqual(['speaker']);
    expect(result.pagination?.total_source_rows).toBe(1);
  });
});
