interface GroupedResultsPageSizeSummaryProps<
  Row extends Record<string, unknown> = Record<string, unknown>,
> {
  groups: Row[][];
  totalProcessed?: number;
}

/** Called by: GroupedResultsPageSizeSummary when backend totals are unavailable. */
const countGroupedResultMatches = (groups: Record<string, unknown>[][]): number => {
  return groups.reduce((total, group) => total + group.length, 0);
};

/** Called by: GroupedResultsPageSizeSummary for grouped source-document counts. */
const countGroupedResultDocuments = (groups: Record<string, unknown>[][]): number => {
  return groups.length;
};

/**
 * Supplies the shared page-size summary copy for grouped analysis result tables,
 * using the current page's grouped instance and document counts.
 * Used by: concordance and quotation paginated grouped result tables.
 */
export function GroupedResultsPageSizeSummary<Row extends Record<string, unknown>>({
  groups,
  totalProcessed,
}: GroupedResultsPageSizeSummaryProps<Row>) {
  const matchCount = countGroupedResultMatches(groups);
  const documentCount = countGroupedResultDocuments(groups);

  return (
    <>
      (Found {matchCount} match{matchCount === 1 ? '' : 'es'} in {documentCount} document
      {documentCount === 1 ? '' : 's'}
      {totalProcessed != null
        ? ` after processing ${String(totalProcessed)} document${totalProcessed === 1 ? '' : 's'}`
        : ''}
      ).
    </>
  );
}
