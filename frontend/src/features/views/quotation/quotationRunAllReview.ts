import type {
  QuotationAnalysisResponse,
  QuotationResultQuery,
  RunAllSourceTableResource,
} from '@/api';
import type { ArrowTablePage } from '@/lib/arrow/arrowTable';

/** Projects one immutable Run All table page into the existing Quotation presentation model. */
export function projectQuotationRunAllReviewPage(
  source: RunAllSourceTableResource,
  page: ArrowTablePage,
  query: Required<Pick<QuotationResultQuery, 'page' | 'page_size' | 'descending'>> &
    Pick<QuotationResultQuery, 'sort_by'>,
): QuotationAnalysisResponse {
  const columns = page.columns.filter((column) => !source.internal_columns.includes(column));
  const groups = new Map<string, Record<string, unknown>[]>();
  page.rows.forEach((rawRow) => {
    const row = Object.fromEntries(
      Object.entries(rawRow).filter(([column]) => !source.internal_columns.includes(column)),
    );
    const rowId = rawRow.__wordflow_source_row_id;
    const groupKey = `${typeof rowId}:${String(rowId)}`;
    const existing = groups.get(groupKey);
    if (existing) existing.push(row);
    else groups.set(groupKey, [row]);
  });
  const data = Array.from(groups.values());
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
      total_source_rows: source.record_count,
      total_source_pages:
        source.record_count === 0 ? 0 : Math.ceil(source.record_count / query.page_size),
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
