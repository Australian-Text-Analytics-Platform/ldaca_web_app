/**
 * Shared constants for analysis-feature UIs.
 *
 * The two page-size sets exist because concordance/quotation paginate
 * source documents (which can be many per task and benefit from larger
 * pages) while AI Annotator paginates per-row reviews (where a tighter
 * range is friendlier to scrolling).
 */
export const PAGE_SIZE_OPTIONS_DEFAULT = [10, 20, 50, 100, 200, 400, 800] as const;
export const PAGE_SIZE_OPTIONS_SMALL = [5, 10, 20, 50, 100] as const;
