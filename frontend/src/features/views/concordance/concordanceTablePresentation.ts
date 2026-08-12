import { CONCORDANCE_COLUMN_KEYS, CONCORDANCE_FREQ_COLUMNS } from '../common/generatedColumns';

export type ConcordanceHeaderMode = 'plain' | 'preview-review-hint' | 'sortable';

const ALWAYS_PLAIN_COLUMNS: ReadonlySet<string> = new Set([
  CONCORDANCE_COLUMN_KEYS.leftContext,
  CONCORDANCE_COLUMN_KEYS.rightContext,
]);

const REVIEW_SORTABLE_ANALYSIS_COLUMNS: ReadonlySet<string> = new Set([
  CONCORDANCE_COLUMN_KEYS.matchedText,
  CONCORDANCE_COLUMN_KEYS.startIdx,
  CONCORDANCE_COLUMN_KEYS.endIdx,
  CONCORDANCE_COLUMN_KEYS.leftToken,
  CONCORDANCE_COLUMN_KEYS.rightToken,
  ...CONCORDANCE_FREQ_COLUMNS,
]);

interface ConcordanceHeaderPolicyInput {
  columnKey: string;
  documentColumn: string;
  metadataColumns: readonly string[];
  isCombined: boolean;
  isReview: boolean;
}

/**
 * Selects the table-header affordance for one visible Concordance column.
 * Used by: ConcordanceTableNodeBlock for both rendering and click dispatch so
 * Preview, Review, separated, and combined tables cannot drift apart.
 *
 * Flow: combined tables and long document/context strings stay plain; selected
 * source metadata remains sortable; materialized scalar analysis fields sort in
 * separated Review and advertise Run All while still in separated Preview.
 */
export function concordanceHeaderMode({
  columnKey,
  documentColumn,
  metadataColumns,
  isCombined,
  isReview,
}: ConcordanceHeaderPolicyInput): ConcordanceHeaderMode {
  if (isCombined || columnKey === documentColumn || ALWAYS_PLAIN_COLUMNS.has(columnKey)) {
    return 'plain';
  }
  if (metadataColumns.includes(columnKey)) return 'sortable';
  if (!REVIEW_SORTABLE_ANALYSIS_COLUMNS.has(columnKey)) return 'plain';
  return isReview ? 'sortable' : 'preview-review-hint';
}
