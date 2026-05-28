import { describe, expect, it, vi } from 'vitest';
import {
  resolvePagination,
  type PaginationSource,
  type PaginationState,
} from '../pagination';

interface Row {
  id: number;
  name: string;
}

const fullRows: Row[] = Array.from({ length: 23 }, (_, i) => ({
  id: i + 1,
  name: `row-${(i + 1).toString().padStart(2, '0')}`,
}));

/**
 * Builds pagination state fixtures with only the relevant override changed.
 * Used by: Vitest setup or assertions in snapshot-view/pagination.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 */
function defaultState(overrides: Partial<PaginationState> = {}): PaginationState {
  return { currentPage: 1, pageSize: 10, descending: false, ...overrides };
}

describe('resolvePagination — server mode', () => {
  it('passes server-supplied rows through unchanged', () => {
    const setState = vi.fn();
    const serverRows: Row[] = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ];
    const source: PaginationSource<Row> = {
      kind: 'server',
      state: defaultState({ pageSize: 10 }),
      rows: serverRows,
      total: 42,
      setState,
    };
    const view = resolvePagination(source);
    expect(view.rows).toBe(serverRows);
    expect(view.total).toBe(42);
    expect(view.hasPrev).toBe(false);
    expect(view.hasNext).toBe(true);
  });

  it('setCurrentPage forwards a new state to the parent', () => {
    const setState = vi.fn();
    const view = resolvePagination<Row>({
      kind: 'server',
      state: defaultState(),
      rows: [],
      total: 100,
      setState,
    });
    view.setCurrentPage(3);
    expect(setState).toHaveBeenCalledWith(expect.objectContaining({ currentPage: 3 }));
  });

  it('setPageSize resets currentPage to 1', () => {
    const setState = vi.fn();
    const view = resolvePagination<Row>({
      kind: 'server',
      state: defaultState({ currentPage: 5 }),
      rows: [],
      total: 100,
      setState,
    });
    view.setPageSize(25);
    expect(setState).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 25, currentPage: 1 }),
    );
  });

  it('hasNext is false on the last page', () => {
    const view = resolvePagination<Row>({
      kind: 'server',
      state: defaultState({ currentPage: 10, pageSize: 10 }),
      rows: [],
      total: 100,
      setState: vi.fn(),
    });
    expect(view.hasNext).toBe(false);
    expect(view.hasPrev).toBe(true);
  });
});

describe('resolvePagination — client mode', () => {
  it('slices the full table by page', () => {
    const view = resolvePagination<Row>({
      kind: 'client',
      state: defaultState({ currentPage: 2, pageSize: 10 }),
      rows: fullRows,
      setState: vi.fn(),
    });
    expect(view.rows.map((r) => r.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(view.total).toBe(23);
    expect(view.hasPrev).toBe(true);
    expect(view.hasNext).toBe(true);
  });

  it('hasNext is false on the last partial page', () => {
    const view = resolvePagination<Row>({
      kind: 'client',
      state: defaultState({ currentPage: 3, pageSize: 10 }),
      rows: fullRows,
      setState: vi.fn(),
    });
    expect(view.rows.map((r) => r.id)).toEqual([21, 22, 23]);
    expect(view.hasNext).toBe(false);
  });

  it('applies the filter before slicing, total reflects filtered count', () => {
    const view = resolvePagination<Row>({
      kind: 'client',
      state: defaultState({ pageSize: 5 }),
      rows: fullRows,
            /**
       * Keeps only even rows so the test proves filtering precedes slicing.
             * Used by: test mock object in snapshot-view/pagination.
             * Why: because the mock needs the production-shaped dependency while the test isolates this feature path.
             */
      filter: (r) => r.id % 2 === 0,
      setState: vi.fn(),
    });
    expect(view.total).toBe(11);
    expect(view.rows.map((r) => r.id)).toEqual([2, 4, 6, 8, 10]);
  });

  it('applies the comparator when sortBy is set, asc/desc honoured', () => {
    const view = resolvePagination<Row>({
      kind: 'client',
      state: defaultState({ pageSize: 3, sortBy: 'id', descending: true }),
      rows: fullRows,
            /**
       * Sorts by id in the requested direction for the client resolver test.
             * Used by: test mock object in snapshot-view/pagination.
             * Why: because the mock needs the production-shaped dependency while the test isolates this feature path.
             */
      comparator: (sortBy, descending) => {
        if (sortBy !== 'id') return null;
        return (a, b) => (descending ? b.id - a.id : a.id - b.id);
      },
      setState: vi.fn(),
    });
    expect(view.rows.map((r) => r.id)).toEqual([23, 22, 21]);
  });

  it('skips sorting when comparator returns null for the column', () => {
    const view = resolvePagination<Row>({
      kind: 'client',
      state: defaultState({ pageSize: 3, sortBy: 'unknown_column' }),
      rows: fullRows,
            /**
       * Returns null so the resolver's no-comparator path is exercised.
             * Used by: test mock object in snapshot-view/pagination.
             * Why: because the mock needs the production-shaped dependency while the test isolates this feature path.
             */
      comparator: () => null,
      setState: vi.fn(),
    });
    expect(view.rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('client setCurrentPage forwards a new state', () => {
    const setState = vi.fn();
    const view = resolvePagination<Row>({
      kind: 'client',
      state: defaultState(),
      rows: fullRows,
      setState,
    });
    view.setCurrentPage(2);
    expect(setState).toHaveBeenCalledWith(expect.objectContaining({ currentPage: 2 }));
  });

  it('client setSort resets to page 1 (parity with server-mode adapter)', () => {
    const setState = vi.fn();
    const view = resolvePagination<Row>({
      kind: 'client',
      state: defaultState({ currentPage: 3 }),
      rows: fullRows,
      setState,
    });
    view.setSort('name', true);
    expect(setState).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: 'name', descending: true, currentPage: 1 }),
    );
  });
});
