import { describe, expect, it } from 'vitest';
import type { ConcordanceNodeResult } from '@/api';
import {
  buildConcordanceDispersionTableModel,
  getDispersionColumnStyle,
} from '../concordanceDispersionTableModel';

const makeNodeData = (): ConcordanceNodeResult => ({
  columns: ['CONC_dispersion', 'speaker', 'missing_from_metadata'],
  data: [
    [
      {
        text: 'alpha beta',
        speaker: 'A',
        CONC_matched_text: 'alpha',
        CONC_start_idx: 0,
        CONC_end_idx: 5,
      },
    ],
  ],
  metadata: {
    concordance_columns: ['CONC_matched_text'],
    metadata_columns: ['speaker', 'not_in_columns'],
    all_columns: ['CONC_matched_text', 'speaker', 'not_in_columns'],
  },
  pagination: {
    page: 1,
    page_size: 20,
    total_source_rows: 1,
    total_source_pages: 1,
    result_count: 1,
    has_next: false,
    has_prev: false,
  },
  sorting: { sort_by: null, descending: false },
});

describe('concordanceDispersionTableModel', () => {
  it('builds rows, metadata columns, and fixed dispersion width for metadata view', () => {
    const model = buildConcordanceDispersionTableModel({
      nodeData: makeNodeData(),
      textColumn: 'text',
      showMetadata: true,
      selectedMetadataColumns: ['speaker', 'speaker', 'not_in_columns'],
      resultsViewportWidth: 1000,
      proportionalDispersionBars: true,
    });

    expect(model.rows).toHaveLength(1);
    expect(model.tableColumns).toEqual(['CONC_dispersion', 'speaker']);
    expect(model.longestTextLength).toBe('alpha beta'.length);
    expect(model.dispersionColumnStyle).toEqual({
      width: '850px',
      minWidth: '850px',
      maxWidth: '850px',
    });
    expect(model.metadataColumnStyle).toEqual({ minWidth: '200px' });
  });

  it('omits column sizing when metadata is hidden', () => {
    const model = buildConcordanceDispersionTableModel({
      nodeData: makeNodeData(),
      textColumn: 'text',
      showMetadata: false,
      selectedMetadataColumns: ['speaker'],
      resultsViewportWidth: 1000,
      proportionalDispersionBars: false,
    });

    expect(model.tableColumns).toEqual(['CONC_dispersion']);
    expect(model.longestTextLength).toBe(0);
    expect(model.dispersionColumnStyle).toBeUndefined();
    expect(model.metadataColumnStyle).toBeUndefined();
    expect(getDispersionColumnStyle(true, 0)).toBeUndefined();
  });
});
