/**
 * Pagination shape used by analysis features that paginate by *source row*
 * (e.g. concordance / quotation), where each source row may produce
 * multiple result rows.
 */
export interface SourceRowPagination {
  page: number;
  page_size: number;
  total_source_rows: number;
  total_source_pages: number;
  result_count: number;
  has_next: boolean;
  has_prev: boolean;
}
