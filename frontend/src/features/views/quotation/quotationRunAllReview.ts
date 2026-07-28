import type {
  QuotationAnalysisResponse,
  QuotationResultQuery,
  RunAllSourceTableResource,
} from '@/api';
import type { ArrowTablePage } from '@/lib/arrow/arrowTable';

export type QuotationReviewRowUnit = 'documents' | 'matches';

const quotationFieldMap: Record<string, string> = {
  speaker: 'QUOTE_speaker',
  speaker_start_idx: 'QUOTE_speaker_start_idx',
  speaker_end_idx: 'QUOTE_speaker_end_idx',
  quote: 'QUOTE_quote',
  quote_start_idx: 'QUOTE_quote_start_idx',
  quote_end_idx: 'QUOTE_quote_end_idx',
  verb: 'QUOTE_verb',
  verb_start_idx: 'QUOTE_verb_start_idx',
  verb_end_idx: 'QUOTE_verb_end_idx',
  quote_type: 'QUOTE_quote_type',
  quote_token_count: 'QUOTE_quote_token_count',
  is_floating_quote: 'QUOTE_is_floating_quote',
  quote_row_idx: 'QUOTE_quote_row_idx',
};

const projectQuotationHit = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).map(([column, cell]) => [quotationFieldMap[column] ?? column, cell]),
  );

/** Projects one immutable Run All table page into the existing Quotation presentation model. */
export function projectQuotationRunAllReviewPage(
  source: RunAllSourceTableResource,
  page: ArrowTablePage,
  query: Required<Pick<QuotationResultQuery, 'page' | 'page_size' | 'descending'>> &
    Pick<QuotationResultQuery, 'sort_by'>,
  rowUnit: QuotationReviewRowUnit,
): QuotationAnalysisResponse {
  const data = page.rows.flatMap((rawRow) => {
    const base = Object.fromEntries(
      Object.entries(rawRow).filter(
        ([column]) => !source.internal_columns.includes(column) && column !== 'quotation',
      ),
    );
    const hits =
      rowUnit === 'documents' && Array.isArray(rawRow.quotation) ? rawRow.quotation : [rawRow];
    const group = hits.flatMap((hit) =>
      hit && typeof hit === 'object'
        ? [{ ...base, ...projectQuotationHit(hit as Record<string, unknown>) }]
        : [],
    );
    return group.length > 0 ? [group] : [];
  });
  const columns = [source.document_column, ...source.metadata_columns, ...source.analysis_columns];
  const totalRows = rowUnit === 'documents' ? source.document_count : source.match_count;
  return {
    kind: 'quotation',
    ready: true,
    columns,
    data: data as NonNullable<QuotationAnalysisResponse['data']>,
    metadata: {
      all_columns: columns,
      metadata_columns: source.metadata_columns,
      concordance_columns: [],
      quotation_columns: source.analysis_columns,
    },
    pagination: {
      page: query.page,
      page_size: query.page_size,
      total_source_rows: totalRows,
      total_source_pages: totalRows === 0 ? 0 : Math.ceil(totalRows / query.page_size),
      result_count: data.length,
      has_next: page.hasNext,
      has_prev: query.page > 1,
    },
    sorting: {
      sort_by: query.sort_by ?? null,
      descending: query.descending,
    },
    query: null,
  };
}
