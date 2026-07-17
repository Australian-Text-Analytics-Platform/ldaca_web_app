import type { PolarsExpressionContext, PolarsExpressionRequest } from '@/api';

export type ExpressionContextTab = PolarsExpressionContext;

/**
 * Each user-mutable expression entry carries its own opaque `id` so React can
 * use it for the list `key`. Using array index keys here was the B8 bug:
 * adding/removing an item mid-list re-attributed CodeEditor focus to the wrong
 * row.
 */
export interface ExpressionItem {
  id: string;
  code: string;
}

export interface SortExpressionItem extends ExpressionItem {
  descending: boolean;
}

interface GroupByAggState {
  keyCode: string;
  aggExpressions: ExpressionItem[];
}

export interface PolarsExpressionDraftState {
  activeContext: ExpressionContextTab;
  filterCode: string;
  withColumns: ExpressionItem[];
  selectExpressions: ExpressionItem[];
  sortItems: SortExpressionItem[];
  groupByState: GroupByAggState;
}

export type ExpressionListTarget = 'withColumns' | 'selectExpressions' | 'groupByAgg';

export type PolarsExpressionDraftAction =
  | { type: 'setActiveContext'; context: ExpressionContextTab }
  | { type: 'setFilterCode'; code: string }
  | { type: 'setGroupByKeyCode'; code: string }
  | { type: 'addExpression'; target: ExpressionListTarget }
  | { type: 'updateExpressionCode'; target: ExpressionListTarget; id: string; code: string }
  | { type: 'removeExpression'; target: ExpressionListTarget; id: string }
  | { type: 'addSortExpression' }
  | { type: 'updateSortCode'; id: string; code: string }
  | { type: 'updateSortDescending'; id: string; descending: boolean }
  | { type: 'removeSortExpression'; id: string };

/**
 * Generates stable expression row ids for React list keys and focus tracking.
 * Used by: blank expression factories because every editor row needs an id
 * independent from its array index.
 */
const newId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;

/**
 * Creates an empty expression row with a stable id for React list keys.
 * Used by: the Polars expression draft reducer when adding With Columns,
 * Select, or Group By aggregation rows.
 */
const blankExpression = (): ExpressionItem => ({ id: newId(), code: '' });

/**
 * Creates an empty sort expression row with a stable id and default direction.
 * Used by: the Polars expression draft reducer when adding Sort rows.
 */
const blankSortExpression = (): SortExpressionItem => ({
  id: newId(),
  code: '',
  descending: false,
});

/**
 * Builds the initial editor draft for every expression context.
 * Used by: usePolarsExpressionSubTab so all context-specific editor lists are
 * initialized from one model instead of several independent state calls.
 */
export const createPolarsExpressionDraftState = (): PolarsExpressionDraftState => ({
  activeContext: 'filter',
  filterCode: '',
  withColumns: [blankExpression()],
  selectExpressions: [blankExpression()],
  sortItems: [blankSortExpression()],
  groupByState: {
    keyCode: '',
    aggExpressions: [blankExpression()],
  },
});

const updateList = (
  state: PolarsExpressionDraftState,
  target: ExpressionListTarget,
  updater: (items: ExpressionItem[]) => ExpressionItem[],
): PolarsExpressionDraftState => {
  if (target === 'groupByAgg') {
    return {
      ...state,
      groupByState: {
        ...state.groupByState,
        aggExpressions: updater(state.groupByState.aggExpressions),
      },
    };
  }

  return { ...state, [target]: updater(state[target]) };
};

/**
 * Owns context editor draft transitions for the Polars Expression subtab.
 * Used by: usePolarsExpressionSubTab because add/remove/update behavior for
 * expression rows belongs with request serialization, not inside JSX handlers.
 */
export const polarsExpressionDraftReducer = (
  state: PolarsExpressionDraftState,
  action: PolarsExpressionDraftAction,
): PolarsExpressionDraftState => {
  switch (action.type) {
    case 'setActiveContext':
      return { ...state, activeContext: action.context };
    case 'setFilterCode':
      return { ...state, filterCode: action.code };
    case 'setGroupByKeyCode':
      return { ...state, groupByState: { ...state.groupByState, keyCode: action.code } };
    case 'addExpression':
      return updateList(state, action.target, (items) => [...items, blankExpression()]);
    case 'updateExpressionCode':
      return updateList(state, action.target, (items) =>
        items.map((item) => (item.id === action.id ? { ...item, code: action.code } : item)),
      );
    case 'removeExpression':
      return updateList(state, action.target, (items) =>
        items.filter((item) => item.id !== action.id),
      );
    case 'addSortExpression':
      return { ...state, sortItems: [...state.sortItems, blankSortExpression()] };
    case 'updateSortCode':
      return {
        ...state,
        sortItems: state.sortItems.map((item) =>
          item.id === action.id ? { ...item, code: action.code } : item,
        ),
      };
    case 'updateSortDescending':
      return {
        ...state,
        sortItems: state.sortItems.map((item) =>
          item.id === action.id ? { ...item, descending: action.descending } : item,
        ),
      };
    case 'removeSortExpression':
      return { ...state, sortItems: state.sortItems.filter((item) => item.id !== action.id) };
  }
};

/**
 * Serializes the editor drafts for one Polars expression context into the
 * backend request shape.
 * Used by: usePolarsExpressionSubTab and expression-hook tests so branchy
 * request-building rules stay separate from React state orchestration.
 */
export const buildPolarsExpressionRequest = (
  drafts: PolarsExpressionDraftState,
): PolarsExpressionRequest => {
  const { activeContext, filterCode, withColumns, selectExpressions, sortItems, groupByState } =
    drafts;

  if (activeContext === 'group_by_agg') {
    return {
      context: 'group_by_agg',
      expressions: groupByState.aggExpressions
        .filter((it) => it.code.trim())
        .map((it) => ({ code: it.code.trim() })),
      group_by: [{ expression: { op: 'literal', value: groupByState.keyCode.trim() } }],
    };
  }

  if (activeContext === 'sort') {
    return {
      context: 'sort',
      expressions: sortItems
        .filter((it) => it.code.trim())
        .map((it) => ({ code: it.code.trim(), descending: it.descending })),
    };
  }

  if (activeContext === 'filter') {
    return { context: 'filter', expressions: [{ code: filterCode.trim() }] };
  }

  if (activeContext === 'with_columns') {
    return {
      context: 'with_columns',
      expressions: withColumns
        .filter((it) => it.code.trim())
        .map((it) => ({ code: it.code.trim() })),
    };
  }

  return {
    context: 'select',
    expressions: selectExpressions
      .filter((it) => it.code.trim())
      .map((it) => ({ code: it.code.trim() })),
  };
};
