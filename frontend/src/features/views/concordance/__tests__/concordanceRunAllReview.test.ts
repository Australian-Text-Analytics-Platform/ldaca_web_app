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
    document_count: 1,
    match_count: 2,
    table: {
      delivery: 'projected' as const,
      table_id: 'concordance-run-all',
      documents: { rows_url: '/documents/rows', schema_url: '/documents/schema' },
      matches: { rows_url: '/matches/rows', schema_url: '/matches/schema' },
      density_url: '/density',
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
            __wordflow_source_row_id: 7,
            concordance: [
              { CONC_matched_text: 'Queensland', CONC_start_idx: 0 },
              { CONC_matched_text: 'Queensland', CONC_start_idx: 11 },
            ],
          },
        ],
        hasNext: false,
        etag: null,
      },
      1,
      20,
      null,
      false,
      'documents',
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toHaveLength(2);
    expect(result.columns).not.toContain('__wordflow_source_row_id');
    expect(result.metadata.metadata_columns).toContain('speaker');
    expect(result.metadata.concordance_columns).toContain('CONC_matched_text');
    expect(result.pagination.total_source_rows).toBe(1);
  });

  it('keeps match projection rows as independent occurrences', () => {
    const result = projectConcordanceRunAllReviewPage(
      source,
      {
        table: {} as never,
        columns: ['text', 'CONC_matched_text', 'CONC_start_idx'],
        schema: [],
        rows: [
          { text: 'Queensland Queensland', CONC_matched_text: 'Queensland', CONC_start_idx: 0 },
          { text: 'Queensland Queensland', CONC_matched_text: 'Queensland', CONC_start_idx: 11 },
        ],
        hasNext: false,
        etag: null,
      },
      1,
      20,
      null,
      false,
      'matches',
    );

    expect(result.data).toHaveLength(2);
    expect(result.data.every((group) => group.length === 1)).toBe(true);
    expect(result.pagination.total_source_rows).toBe(2);
  });
});
