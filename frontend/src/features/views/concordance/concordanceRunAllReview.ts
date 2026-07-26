import { type ConcordanceNodeResult, type RunAllSourceTableResource } from '@/api';
import type { ArrowTablePage } from '@/lib/arrow/arrowTable';
import {
  CONCORDANCE_COLUMN_KEYS,
  CONCORDANCE_RUN_ALL_GENERATED_COLUMNS,
} from '../common/generatedColumns';

const SOURCE_ROW_ID_COLUMN = '__wordflow_source_row_id';
const REVIEW_CONCORDANCE_COLUMNS = CONCORDANCE_RUN_ALL_GENERATED_COLUMNS.filter(
  (column) => column !== CONCORDANCE_COLUMN_KEYS.extraction,
);
export interface ConcordanceRunAllReviewSource {
  analysisId: string;
  source: RunAllSourceTableResource;
}

/**
 * Rebuilds the grouped Concordance page model from the immutable Run All table.
 * `CONC_dispersion` remains presentation-only and is derived by the existing
 * dispersion model from these grouped hit rows.
 */
export function projectConcordanceRunAllReviewPage(
  source: ConcordanceRunAllReviewSource,
  page: ArrowTablePage,
  pageNumber: number,
  pageSize: number,
  sortBy: string | null,
  descending: boolean,
): ConcordanceNodeResult {
  const columns = page.columns.filter((column) => !source.source.internal_columns.includes(column));
  const groups = new Map<string, Record<string, unknown>[]>();

  page.rows.forEach((rawRow) => {
    const row = Object.fromEntries(
      Object.entries(rawRow).filter(([column]) => !source.source.internal_columns.includes(column)),
    );
    row.__source_node = source.source.node_id;
    const sourceRowId = rawRow[SOURCE_ROW_ID_COLUMN];
    const groupKey = `${typeof sourceRowId}:${String(sourceRowId)}`;
    const existing = groups.get(groupKey);
    if (existing) existing.push(row);
    else groups.set(groupKey, [row]);
  });

  const data = Array.from(groups.values());
  const metadataColumns = source.source.metadata_columns;
  const totalRows = source.source.record_count;
  const totalPages = totalRows === 0 ? 0 : Math.ceil(totalRows / pageSize);

  return {
    data: data as ConcordanceNodeResult['data'],
    columns,
    metadata: {
      all_columns: columns,
      concordance_columns: [...REVIEW_CONCORDANCE_COLUMNS],
      metadata_columns: metadataColumns,
      quotation_columns: [],
    },
    pagination: {
      page: pageNumber,
      page_size: pageSize,
      total_source_rows: totalRows,
      total_source_pages: totalPages,
      result_count: data.length,
      has_next: page.hasNext,
      has_prev: pageNumber > 1,
    },
    sorting: {
      sort_by: sortBy,
      descending,
    },
  };
}
