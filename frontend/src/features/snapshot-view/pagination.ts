/**
 * Live result tables paginate server-side: the component receives a
 * pre-sliced page of rows and a setter that triggers a refetch via
 * React Query. Snapshot-mode tables paginate client-side: the
 * component receives the full table in memory and the adapter slices
 * it on each page change.
 *
 * Both flows yield the same ``PaginationView<TRow>`` shape, so table
 * components consume one interface and stay mode-agnostic.
 */

export interface PaginationState {
  /** 1-based, to match the existing ``NodePaginationState`` in
   * ``features/views/common/tasks/types``. */
  currentPage: number;
  pageSize: number;
  sortBy?: string;
  descending: boolean;
}

export interface PaginationView<TRow> {
  /** Rows for the current page in display order. */
  rows: TRow[];
  /** Total row count after any filter has been applied (client mode)
   * or as reported by the server (server mode). Drives the page-count
   * display in the table footer. */
  total: number;
  state: PaginationState;
  setCurrentPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSort: (sortBy: string | undefined, descending: boolean) => void;
  hasPrev: boolean;
  hasNext: boolean;
}

/** Adapter input. ``server`` rows are already a single page; ``client``
 * rows are the full in-memory table, sliced here. */
export type PaginationSource<TRow> =
  | {
      kind: 'server';
      state: PaginationState;
      rows: TRow[];
      total: number;
      setState: (next: PaginationState) => void;
    }
  | {
      kind: 'client';
      state: PaginationState;
      rows: TRow[];
      setState: (next: PaginationState) => void;
      /** Optional row-level filter applied before sort + slice. */
      filter?: (row: TRow) => boolean;
      /** Optional comparator factory keyed by column. Returns ``null``
       * to indicate "no comparator for this column" — the resolver
       * skips sorting in that case rather than picking an arbitrary
       * order. */
      comparator?: (sortBy: string, descending: boolean) => ((a: TRow, b: TRow) => number) | null;
    };

/**
 * Pure resolver with no React state.
 * Used by: index module, pagination tests (rg call sites/imports) because snapshot-backed results need live-table pagination semantics without fetching from the backend.
 * Flow: source rows and page state are clamped, sliced, and returned with pagination metadata that mirrors live API responses.
 */
export function resolvePagination<TRow>(source: PaginationSource<TRow>): PaginationView<TRow> {
  if (source.kind === 'server') {
    const { state, rows, total, setState } = source;
    return {
      rows,
      total,
      state,
      /**
       * Forwards server-page navigation to the owner state so React Query refetches.
       * Consumed by: resolvePagination return object for feature components.
       * Why: because snapshot-backed feature panels need live-like page metadata while reading from fixed snapshot rows.
       */
      setCurrentPage: (page) => setState({ ...state, currentPage: page }),
      /**
       * Resets to the first server page when the page size changes.
       * Consumed by: resolvePagination return object for feature components.
       * Why: because snapshot-backed feature panels need live-like page metadata while reading from fixed snapshot rows.
       */
      setPageSize: (size) => setState({ ...state, pageSize: size, currentPage: 1 }),
      /**
       * Records server sort intent and resets paging for the sorted result.
       * Consumed by: resolvePagination return object for feature components.
       * Why: because snapshot-backed feature panels need live-like page metadata while reading from fixed snapshot rows.
       */
      setSort: (sortBy, descending) => setState({ ...state, sortBy, descending, currentPage: 1 }),
      hasPrev: state.currentPage > 1,
      hasNext: state.currentPage * state.pageSize < total,
    };
  }

  // client mode — filter, sort, then slice in memory.
  const { state, setState, comparator, filter } = source;
  const filtered = filter ? source.rows.filter(filter) : source.rows;
  const total = filtered.length;

  let ordered = filtered;
  if (state.sortBy && comparator) {
    const cmp = comparator(state.sortBy, state.descending);
    if (cmp) {
      ordered = [...filtered].sort(cmp);
    }
  }

  const start = (state.currentPage - 1) * state.pageSize;
  const end = start + state.pageSize;
  const rows = ordered.slice(start, end);

  return {
    rows,
    total,
    state,
    /**
     * Moves the client-side slice window without refetching data.
     * Consumed by: resolvePagination return object for feature components.
     * Why: because snapshot-backed feature panels need live-like page metadata while reading from fixed snapshot rows.
     */
    setCurrentPage: (page) => setState({ ...state, currentPage: page }),
    /**
     * Changes the client-side slice size and restarts at the first page.
     * Consumed by: resolvePagination return object for feature components.
     * Why: because snapshot-backed feature panels need live-like page metadata while reading from fixed snapshot rows.
     */
    setPageSize: (size) => setState({ ...state, pageSize: size, currentPage: 1 }),
    /**
     * Stores client-side sort intent before the adapter reorders rows.
     * Consumed by: resolvePagination return object for feature components.
     * Why: because snapshot-backed feature panels need live-like page metadata while reading from fixed snapshot rows.
     */
    setSort: (sortBy, descending) => setState({ ...state, sortBy, descending, currentPage: 1 }),
    hasPrev: state.currentPage > 1,
    hasNext: end < total,
  };
}
