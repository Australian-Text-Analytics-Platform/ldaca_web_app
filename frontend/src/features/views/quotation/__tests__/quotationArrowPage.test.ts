import { Field, Int64, List, Struct, Table, Utf8, tableToIPC, vectorFromArray } from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import type { RunAllSourceTableResource } from '@/api';
import { decodeArrowPage } from '@/lib/arrow/arrowTable';
import { createNodeDataRequest } from '@/lib/queryKeys';

import { projectQuotationArrowPage } from '../quotationArrowPage';

const source: RunAllSourceTableResource = {
  node_id: 'node-1',
  node_name: 'Documents',
  document_column: 'text',
  metadata_columns: ['source'],
  analysis_columns: [
    'QUOTE_speaker',
    'QUOTE_speaker_start_idx',
    'QUOTE_speaker_end_idx',
    'QUOTE_quote',
    'QUOTE_quote_start_idx',
    'QUOTE_quote_end_idx',
    'QUOTE_verb',
    'QUOTE_verb_start_idx',
    'QUOTE_verb_end_idx',
    'QUOTE_quote_type',
    'QUOTE_quote_token_count',
    'QUOTE_is_floating_quote',
    'QUOTE_quote_row_idx',
  ],
  internal_columns: ['__wordflow_source_row_id'],
  document_count: 1,
  match_count: 1,
  table: {
    delivery: 'projected',
    table_id: 'quotation-run-all',
    documents: { rows_url: '/documents/rows', schema_url: '/documents/schema' },
    matches: { rows_url: '/matches/rows', schema_url: '/matches/schema' },
    density_url: null,
  },
};

const request = createNodeDataRequest({ page: 1, page_size: 50 });

describe('Quotation Arrow page projection', () => {
  it('uses native Int64 values instead of JSON-friendly page rows', async () => {
    const table = new Table({
      text: vectorFromArray(['😀 Alice said hello'], new Utf8()),
      source: vectorFromArray(['nested'], new Utf8()),
      QUOTE_quote: vectorFromArray(['hello'], new Utf8()),
      QUOTE_quote_start_idx: vectorFromArray([13n], new Int64()),
      QUOTE_quote_end_idx: vectorFromArray([18n], new Int64()),
    });
    const page = await decodeArrowPage(
      tableToIPC(table, 'stream').buffer as ArrayBuffer,
      new Response(null, { headers: { 'X-Wordflow-Total-Rows': '1' } }),
    );
    page.rows[0] = {
      ...page.rows[0],
      QUOTE_quote_start_idx: '0',
      QUOTE_quote_end_idx: '1',
    };

    const state = projectQuotationArrowPage(
      { kind: 'run_all', resource: source, rowUnit: 'matches' },
      page,
      request,
    );

    expect(state.rows[0]?.raw.QUOTE_quote_start_idx).toBe(13n);
    expect(state.rows[0]?.spans).toEqual([{ start: 14, end: 19, type: 'quote' }]);
  });

  it('projects equivalent Preview and Run All document pages identically', async () => {
    const quotationType = new List(
      new Field(
        'item',
        new Struct([
          new Field('quote', new Utf8()),
          new Field('quote_start_idx', new Int64()),
          new Field('quote_end_idx', new Int64()),
        ]),
      ),
    );
    const table = new Table({
      __wordflow_source_row_id: vectorFromArray([4n], new Int64()),
      text: vectorFromArray(['Alice said hello'], new Utf8()),
      source: vectorFromArray(['nested'], new Utf8()),
      quotation: vectorFromArray(
        [[{ quote: 'hello', quote_start_idx: 11n, quote_end_idx: 16n }]],
        quotationType,
      ),
    });
    const page = await decodeArrowPage(
      tableToIPC(table, 'stream').buffer as ArrayBuffer,
      new Response(null, { headers: { 'X-Wordflow-Total-Rows': '1' } }),
    );

    const preview = projectQuotationArrowPage(
      { kind: 'preview', nodeId: 'node-1', documentColumn: 'text' },
      page,
      request,
    );
    const runAll = projectQuotationArrowPage(
      { kind: 'run_all', resource: source, rowUnit: 'documents' },
      page,
      request,
    );

    expect(preview.groupedRows).toEqual(runAll.groupedRows);
    expect(preview.rows.map((row) => row.spans)).toEqual(runAll.rows.map((row) => row.spans));
    expect(preview.metadata.quotation_columns).toEqual(runAll.metadata.quotation_columns);
    expect(runAll.rows[0]?.raw).not.toHaveProperty('__wordflow_source_row_id');
  });
});
