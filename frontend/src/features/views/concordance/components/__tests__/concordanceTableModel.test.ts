import { describe, expect, it } from 'vitest';
import type { ConcordanceNodeResult } from '@/api';
import { alignmentClassForColumn, buildConcordanceTableModel } from '../concordanceTableModel';

const makeNodeData = (columns: string[] = ['CONC_left_context', 'CONC_matched_text', 'speaker']) =>
  ({
    columns,
    data: [
      [
        {
          CONC_left_context: 'before',
          CONC_matched_text: 'alpha',
          CONC_right_context: 'after',
          speaker: 'A',
        },
      ],
    ],
    metadata: {
      concordance_columns: ['CONC_left_context', 'CONC_matched_text', 'CONC_right_context'],
      metadata_columns: ['speaker', 'missing'],
      all_columns: ['CONC_left_context', 'CONC_matched_text', 'CONC_right_context', 'speaker'],
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
  }) as ConcordanceNodeResult;

describe('concordanceTableModel', () => {
  it('returns KWIC alignment classes for context and match columns', () => {
    expect(alignmentClassForColumn('CONC_left_context')).toBe('text-right');
    expect(alignmentClassForColumn('CONC_matched_text')).toBe('text-center');
    expect(alignmentClassForColumn('speaker')).toBe('');
  });

  it('builds flattened rows and filters metadata columns to visible source columns', () => {
    const model = buildConcordanceTableModel({
      nodeData: makeNodeData(),
      showMetadata: true,
      selectedMetadataColumns: ['speaker', 'speaker', 'missing'],
    });

    expect(model.rows).toHaveLength(1);
    expect(model.tableColumns).toEqual(['CONC_left_context', 'CONC_matched_text', 'speaker']);
    expect(model.columns.map((column) => column.id)).toEqual(model.tableColumns);
  });
});
