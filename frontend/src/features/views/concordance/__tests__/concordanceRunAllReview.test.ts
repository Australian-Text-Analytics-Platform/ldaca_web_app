import { describe, expect, it } from 'vitest';
import { projectConcordanceRunAllReviewPage } from '../concordanceRunAllReview';

const source = {
  analysisId: 'analysis-id',
  source: {
    node_id: 'source-id',
    node_name: 'Source',
    document_column: 'text',
    metadata_columns: ['speaker'],
    analysis_columns: ['CONC_matched_text', 'CONC_start_idx', 'CONC_extraction'],
    internal_columns: ['__wordflow_source_row_id'],
    record_count: 2,
    table: {
      table_id: 'concordance-run-all',
      rows_url: '/rows',
      schema_url: '/schema',
    },
  },
};

describe('Concordance Run All Review projection', () => {
  it('groups immutable Result hits for the shared Table and Dispersion presentation', () => {
    const result = projectConcordanceRunAllReviewPage(
      source,
      {
        table: {} as never,
        columns: [
          'text',
          'speaker',
          'CONC_matched_text',
          'CONC_start_idx',
          '__wordflow_source_row_id',
        ],
        schema: [],
        rows: [
          {
            text: 'Queensland Queensland',
            speaker: 'A',
            CONC_matched_text: 'Queensland',
            CONC_start_idx: 0,
            __wordflow_source_row_id: 7,
          },
          {
            text: 'Queensland Queensland',
            speaker: 'A',
            CONC_matched_text: 'Queensland',
            CONC_start_idx: 11,
            __wordflow_source_row_id: 7,
          },
        ],
        hasNext: false,
        etag: null,
      },
      1,
      20,
      null,
      false,
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toHaveLength(2);
    expect(result.columns).not.toContain('__wordflow_source_row_id');
    expect(result.metadata.metadata_columns).toContain('speaker');
    expect(result.metadata.concordance_columns).toContain('CONC_matched_text');
    expect(result.pagination.total_source_rows).toBe(2);
  });
});
