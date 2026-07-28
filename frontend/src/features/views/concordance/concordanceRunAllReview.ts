import { type ConcordanceNodeResult, type RunAllSourceTableResource } from '@/api';
import type { ArrowTablePage } from '@/lib/arrow/arrowTable';
import {
  CONCORDANCE_COLUMN_KEYS,
  CONCORDANCE_RUN_ALL_GENERATED_COLUMNS,
} from '../common/generatedColumns';

const REVIEW_CONCORDANCE_COLUMNS = CONCORDANCE_RUN_ALL_GENERATED_COLUMNS.filter(
  (column) => column !== CONCORDANCE_COLUMN_KEYS.extraction,
);
export interface ConcordanceRunAllReviewSource {
  analysisId: string;
  source: RunAllSourceTableResource;
}

export type ConcordanceReviewRowUnit = 'documents' | 'matches';

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
  rowUnit: ConcordanceReviewRowUnit,
): ConcordanceNodeResult {
  const visibleSourceRow = (rawRow: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(rawRow).filter(
        ([column]) => !source.source.internal_columns.includes(column) && column !== 'concordance',
      ),
    );
  const data = page.rows.flatMap((rawRow) => {
    const base = visibleSourceRow(rawRow);
    const matches =
      rowUnit === 'documents' && Array.isArray(rawRow.concordance) ? rawRow.concordance : [rawRow];
    const group = matches.flatMap((match) => {
      if (!match || typeof match !== 'object') return [];
      return [
        { ...base, ...(match as Record<string, unknown>), __source_node: source.source.node_id },
      ];
    });
    return group.length > 0 ? [group] : [];
  });
  const columns = [
    source.source.document_column,
    ...source.source.metadata_columns,
    ...REVIEW_CONCORDANCE_COLUMNS,
  ];
  const metadataColumns = source.source.metadata_columns;
  const totalRows =
    rowUnit === 'documents' ? source.source.document_count : source.source.match_count;
  const totalPages = totalRows === 0 ? 0 : Math.ceil(totalRows / pageSize);

  return {
    data,
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
