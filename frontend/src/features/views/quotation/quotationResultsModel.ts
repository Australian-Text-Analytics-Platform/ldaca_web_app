import { QUOTATION_COLUMN_KEYS, QUOTATION_DOCUMENT_COLUMN } from '../common/generatedColumns';

interface QuotationResultMetadataSource {
  metadata: {
    metadata_columns: string[];
    quotation_columns: string[];
  };
}

const QUOTATION_GENERATED_METADATA_COLUMNS = [
  QUOTATION_COLUMN_KEYS.quote,
  QUOTATION_COLUMN_KEYS.speaker,
  QUOTATION_COLUMN_KEYS.speakerStartIdx,
  QUOTATION_COLUMN_KEYS.speakerEndIdx,
  QUOTATION_COLUMN_KEYS.quoteStartIdx,
  QUOTATION_COLUMN_KEYS.quoteEndIdx,
  QUOTATION_COLUMN_KEYS.verb,
  QUOTATION_COLUMN_KEYS.verbStartIdx,
  QUOTATION_COLUMN_KEYS.verbEndIdx,
  QUOTATION_COLUMN_KEYS.quoteType,
  QUOTATION_COLUMN_KEYS.quoteTokenCount,
  QUOTATION_COLUMN_KEYS.isFloatingQuote,
  QUOTATION_COLUMN_KEYS.quoteRowIdx,
];

/**
 * Builds the columns offered by the Quotation metadata selector. Backend
 * metadata columns come first, then generated quote/speaker/verb fields that
 * are actually present in the current result.
 * Used by: QuotationFeature before rendering MetadataColumnSelector so result
 * controls and table columns share one availability rule.
 */
export const buildQuotationMetadataColumns = (
  resultState: QuotationResultMetadataSource | null | undefined,
): string[] => {
  if (!resultState) return [];

  const baseColumns = resultState.metadata.metadata_columns.filter(
    (column) => !column.startsWith('__'),
  );
  const generatedMetadataColumns = QUOTATION_GENERATED_METADATA_COLUMNS.filter((column) =>
    resultState.metadata.quotation_columns.includes(column),
  );

  return Array.from(new Set([...baseColumns, ...generatedMetadataColumns]));
};

/**
 * Keeps explicit user metadata selections valid when a rerun changes result
 * shape.
 * Used by: QuotationFeature when passing selected metadata columns into the
 * result controls and QuotationNodeBlock display-column model.
 */
export const resolveQuotationMetadataColumns = (
  selectedColumns: string[],
  availableColumns: string[],
): string[] => {
  const available = new Set(availableColumns);
  return selectedColumns.filter((column) => available.has(column));
};

/**
 * Builds the ordered table columns for a Quotation result block. The document
 * pseudo-column always leads, followed by user-selected metadata when visible.
 * Used by: QuotationFeature before rendering each QuotationNodeBlock.
 */
export const buildQuotationDisplayColumns = (visibleMetadataColumns: string[]): string[] =>
  Array.from(new Set([QUOTATION_DOCUMENT_COLUMN, ...visibleMetadataColumns]));

/**
 * Removes source rows where the extractor returned no quotation hit. The
 * backend paginates by source documents, so the visible hit table can contain
 * fewer rows than the source page size.
 * Used by: QuotationFeature before handing rows to QuotationNodeBlock.
 */
export const filterQuotationRowsWithQuotes = (
  rows: Record<string, unknown>[] | null | undefined,
): Record<string, unknown>[] =>
  (rows ?? []).filter((row) => Boolean(row[QUOTATION_COLUMN_KEYS.quote]));
