interface GroupedResultsPageSizeSummaryProps<
  Row extends Record<string, unknown> = Record<string, unknown>,
> {
  groups: Row[][];
  totalProcessed?: number;
  /** Override the instance count computed from groups (e.g. materialized total). */
  totalInstances?: number;
  /** Override the document count computed from groups (e.g. materialized unique docs). */
  totalDocuments?: number;
}

/** Called by: GroupedResultsPageSizeSummary when backend totals are unavailable. */
const countGroupedResultInstances = (groups: Record<string, unknown>[][]): number => {
  return groups.reduce((total, group) => total + group.length, 0);
};

/** Called by: GroupedResultsPageSizeSummary for grouped source-document counts. */
const countGroupedResultDocuments = (groups: Record<string, unknown>[][]): number => {
  return groups.length;
};

/**
 * Supplies the shared page-size summary copy for grouped analysis result tables,
 * using materialized totals when available and group counts otherwise.
 * Used by: concordance and quotation paginated grouped result tables.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
export function GroupedResultsPageSizeSummary<Row extends Record<string, unknown>>({
  groups,
  totalProcessed,
  totalInstances,
  totalDocuments,
}: GroupedResultsPageSizeSummaryProps<Row>) {
  const instanceCount = totalInstances ?? countGroupedResultInstances(groups);
  const documentCount = totalDocuments ?? countGroupedResultDocuments(groups);

  return (
    <>
      (Found {instanceCount} instance{instanceCount === 1 ? '' : 's'} in {documentCount} document
      {documentCount === 1 ? '' : 's'}
      {totalProcessed != null
        ? ` after processing ${String(totalProcessed)} document${totalProcessed === 1 ? '' : 's'}`
        : ''}
      ).
    </>
  );
}
