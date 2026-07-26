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
        record_count: 2,
        table: {
          table_id: 'quotation-run-all',
          rows_url: '/rows',
          schema_url: '/schema',
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
            QUOTE_quote: 'One',
          },
          {
            __wordflow_source_row_id: 4,
            text: 'One document',
            speaker: 'A',
            QUOTE_quote: 'document',
          },
        ],
        hasNext: false,
        etag: null,
      },
      { page: 1, page_size: 20, sort_by: null, descending: false },
    );

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toHaveLength(2);
    expect(result.columns).not.toContain('__wordflow_source_row_id');
    expect(result.metadata?.metadata_columns).toEqual(['speaker']);
  });
});
