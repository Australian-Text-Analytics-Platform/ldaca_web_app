/**
 * Pure helpers for the Pagination UI. Lives in its own file so the
 * `Pagination.tsx` module can stay component-only (Fast Refresh's
 * `react-refresh/only-export-components` rule).
 */

export type PaginationRangeItem = number | "dots";

/**
 * Builds compact page ranges for pagination components. Analysis tables and
 * server-row paginators use it to share first/last/current-window behavior
 * while still supporting unknown totals via `hasNext`.
 * Called by: AnalysisPagination and ServerTablePagination before rendering page controls because the caller needs a focused rendering boundary for layout, accessibility, and state handoff steps.
 * Flow: emit first/last/current-window pages with dots for known totals, or emit a current-window plus trailing dots when unknown totals still have next pages.
 */
export const buildPaginationRange = (
  current: number,
  totalPages: number | undefined,
  hasNext: boolean = false,
): PaginationRangeItem[] => {
  if (typeof totalPages === "number" && totalPages > 0) {
    const total = Math.max(totalPages, 1);
    const output: PaginationRangeItem[] = [];
    let previous: number | null = null;

    for (let page = 1; page <= total; page++) {
      const isBoundary = page === 1 || page === total;
      const isNearCurrent = Math.abs(page - current) <= 1;
      const shouldShow = total <= 5 || isBoundary || isNearCurrent;

      if (!shouldShow) continue;

      if (previous !== null) {
        const gap = page - previous;
        if (gap === 2) {
          output.push(previous + 1);
        } else if (gap > 2) {
          output.push("dots");
        }
      }

      output.push(page);
      previous = page;
    }

    return output;
  }

  // Unknown total (concordance / quotation source-row pagination).
  // Show pages around current and an ellipsis at the end when more exist.
  const output: PaginationRangeItem[] = [];

  if (current <= 3) {
    for (let p = 1; p <= current; p++) output.push(p);
  } else {
    output.push(1);
    output.push("dots");
    output.push(current - 1);
    output.push(current);
  }

  if (hasNext) {
    output.push(current + 1);
    output.push("dots");
  }

  return output;
};
