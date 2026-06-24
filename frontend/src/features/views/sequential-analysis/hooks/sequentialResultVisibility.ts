interface SequentialResultVisibilityInput {
  rows: Record<string, unknown>[];
  groupByColumns: string[];
  hiddenKeys: Set<string>;
  chartData: Record<string, unknown>[];
  selectedPeriodIndices: Set<number>;
  resultTotalRecords: unknown;
  sourceDocumentCount: unknown;
}

interface SequentialResultVisibility {
  totalPointCount: number;
  totalDocumentCount: number;
  shownPointCount: number;
  shownDocumentCount: number;
  chosenPointCount: number;
  chosenDocumentCount: number;
}

/** Normalizes a row's group value into the key used by chart legend controls. */
/**
 * Called by: deriveSequentialResultVisibility when hidden legend keys need to
 * be matched back to backend rows without depending on React chart state.
 */
function foldGroupValue(raw: unknown): string {
  return String((raw as string | number | boolean | null | undefined) ?? '');
}

/** Builds the visible-series key for one raw result row. */
/**
 * Called by: deriveSequentialResultVisibility because grouped sequential rows
 * use the same "col1 - col2" key format as the chart legend.
 */
function getGroupKey(row: Record<string, unknown>, groupByColumns: string[]): string {
  return groupByColumns.map((column) => foldGroupValue(row[column])).join(' - ');
}

/** Produces the bucket id used to match selected chart points back to raw rows. */
/**
 * Called by: deriveSequentialResultVisibility so selected chart periods and
 * backend rows can be compared across formatted and raw bucket fields.
 */
function getTimeBucketKey(row: Record<string, unknown>): string {
  return String(
    (row.time_period_formatted as string | number | undefined) ??
      (row.time_period as string | number | undefined) ??
      '',
  );
}

/** Sums sequential document counts across raw rows for summary metrics. */
/**
 * Called by: deriveSequentialResultVisibility for shown/chosen document totals
 * and as a fallback when the source node shape is unavailable.
 */
function sumSequentialDocs(rows: Record<string, unknown>[]): number {
  return rows.reduce((total, row) => {
    const count = row.sequential_count;
    return total + (typeof count === 'number' ? count : Number(count ?? 0));
  }, 0);
}

/**
 * Derives the visible/chosen row counts for Sequential Analysis results.
 * Used by: SequentialAnalysisFeature because both the results panel and chart
 * export header need the same totals after legend filtering and chart-period
 * selection are applied.
 * Flow: hide rows whose group key is disabled, map selected chart indices to
 * time buckets, count rows/documents for all, shown, and chosen states, and
 * fall back to raw row totals when backend/source totals are unavailable.
 */
export function deriveSequentialResultVisibility({
  rows,
  groupByColumns,
  hiddenKeys,
  chartData,
  selectedPeriodIndices,
  resultTotalRecords,
  sourceDocumentCount,
}: SequentialResultVisibilityInput): SequentialResultVisibility {
  const isRowVisible = (row: Record<string, unknown>) => {
    if (!groupByColumns.length) return true;
    return !hiddenKeys.has(getGroupKey(row, groupByColumns));
  };

  const selectedTimeBucketKeys = new Set(
    Array.from(selectedPeriodIndices)
      .map((index) => String((chartData[index]?.time_period as string | number | undefined) ?? ''))
      .filter((value) => value.length > 0),
  );

  const shownRows = rows.filter(isRowVisible);
  const chosenRows = shownRows.filter((row) => selectedTimeBucketKeys.has(getTimeBucketKey(row)));

  return {
    totalPointCount: typeof resultTotalRecords === 'number' ? resultTotalRecords : rows.length,
    totalDocumentCount:
      typeof sourceDocumentCount === 'number' ? sourceDocumentCount : sumSequentialDocs(rows),
    shownPointCount: shownRows.length,
    shownDocumentCount: sumSequentialDocs(shownRows),
    chosenPointCount: selectedPeriodIndices.size > 0 ? chosenRows.length : 0,
    chosenDocumentCount: selectedPeriodIndices.size > 0 ? sumSequentialDocs(chosenRows) : 0,
  };
}
