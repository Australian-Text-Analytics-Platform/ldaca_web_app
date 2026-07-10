import type { ConcordanceNodeResult } from '@/api';
import { CONCORDANCE_CORE_COLUMNS } from '../common/generatedColumns';

type ConcordanceHitRow = Record<string, unknown>;
type ConcordanceGroupedRow = ConcordanceHitRow[];

const CORE_COLUMN_SET = new Set<string>(CONCORDANCE_CORE_COLUMNS);

/**
 * Coerce an unknown concordance cell value to a display string.
 *
 * Behaves exactly like the historical ``String(value ?? '')`` call sites
 * (null/undefined → '', primitives stringified) but keeps the result typed as
 * ``string`` so the strict template/stringification lints pass. The cast is to
 * a primitive union, so runtime coercion is byte-identical to the old code for
 * every input — concordance cells are scalars in practice.
 *
 * Used by: ConcordanceDispersionCell.tsx, ConcordanceDispersionNodeBlock.tsx,
 * ConcordanceTableNodeBlock.tsx and this module because every hit/metadata cell
 * renders an unknown Polars value as text.
 */
export const toCellText = (value: unknown): string =>
  String((value as string | number | boolean | null | undefined) ?? '');

/** Flattens grouped concordance hits for the standard table-oriented view. */
/**
 * Used by: concordanceDomains.test.ts, ConcordanceTableNodeBlock.tsx.
 */
export function flattenConcordanceGroups(groups: ConcordanceGroupedRow[]): ConcordanceHitRow[] {
  return groups.flatMap((group) => group);
}

/**
 * Synthesizes the client-side "combined" concordance view from two per-node
 * result slices. Replaces the former backend ``collect_interleaved_combined``
 * helper: the backend now only ever returns per-node slices, and the Combined
 * layout is composed entirely on the frontend.
 *
 * Used by: useConcordanceViewModeSwap because entering Combined view (or paging
 * within it) fetches both nodes at the same page and folds them into a single
 * ``__COMBINED__`` block.
 *
 * Flow:
 * - Interleave the two slices' grouped rows left/right (alternating, with the
 *   longer side's leftover rows appended in order). Rows already carry
 *   ``__source_node`` so the table can colour each hit by origin.
 * - Union the column lists (dedupe, left order first) and recompute the
 *   concordance/metadata column split from the core-column set.
 * - Pagination spans the larger of the two nodes: ``total_source_*`` use max(),
 *   ``has_next``/``has_prev`` derive from the shared page, and ``result_count``
 *   is the interleaved row count.
 */
export function buildCombinedSlice(
  leftSlice: ConcordanceNodeResult,
  rightSlice: ConcordanceNodeResult,
  page: number,
  pageSize: number,
): ConcordanceNodeResult {
  const leftRows = leftSlice.data;
  const rightRows = rightSlice.data;

  const interleaved: ConcordanceNodeResult['data'] = [];
  let li = 0;
  let ri = 0;
  let useLeft = true;
  while (li < leftRows.length || ri < rightRows.length) {
    if (useLeft) {
      const leftRow = leftRows[li];
      if (leftRow !== undefined) {
        interleaved.push(leftRow);
        li += 1;
      } else {
        const rightRow = rightRows[ri];
        if (rightRow !== undefined) {
          interleaved.push(rightRow);
          ri += 1;
          useLeft = !useLeft;
          continue;
        }
        break;
      }
    } else {
      const rightRow = rightRows[ri];
      if (rightRow !== undefined) {
        interleaved.push(rightRow);
        ri += 1;
      } else {
        const leftRow = leftRows[li];
        if (leftRow !== undefined) {
          interleaved.push(leftRow);
          li += 1;
          useLeft = !useLeft;
          continue;
        }
        break;
      }
    }
    useLeft = !useLeft;
  }

  const leftColumns = leftSlice.columns;
  const rightColumns = rightSlice.columns;
  let columns: string[] = leftColumns.length > 0 ? leftColumns : rightColumns;
  if (leftColumns.length > 0 && rightColumns.length > 0) {
    columns = Array.from(new Set([...leftColumns, ...rightColumns]));
  }

  const leftPag = leftSlice.pagination;
  const rightPag = rightSlice.pagination;
  const totalSourceRows = Math.max(leftPag.total_source_rows, rightPag.total_source_rows);
  const totalSourcePages = Math.max(leftPag.total_source_pages, rightPag.total_source_pages);
  const resolvedPageSize = leftPag.page_size || rightPag.page_size || pageSize;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty-string sort_by means "unsorted" and must fall back to the other node, then null
  const effectiveSortBy = leftSlice.sorting.sort_by || rightSlice.sorting.sort_by || null;

  return {
    data: interleaved,
    columns,
    metadata: {
      concordance_columns: columns.filter((c) => CORE_COLUMN_SET.has(c)),
      metadata_columns: columns.filter((c) => !CORE_COLUMN_SET.has(c)),
      all_columns: columns,
    },
    pagination: {
      page,
      page_size: resolvedPageSize,
      total_source_rows: totalSourceRows,
      total_source_pages: totalSourcePages,
      result_count: interleaved.length,
      has_next: page < totalSourcePages,
      has_prev: page > 1,
    },
    sorting: {
      sort_by: effectiveSortBy,
      descending: leftSlice.sorting.descending,
    },
  };
}

export const CONCORDANCE_COMBINED_NODE_KEY = '__COMBINED__';
