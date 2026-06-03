/**
 * Shared constants for analysis-feature UIs.
 *
 * Concordance/quotation paginate source documents (which can be many per task
 * and benefit from larger pages), so the page-size set skews large.
 */
export const PAGE_SIZE_OPTIONS_DEFAULT = [10, 20, 50, 100, 200, 400, 800] as const;
