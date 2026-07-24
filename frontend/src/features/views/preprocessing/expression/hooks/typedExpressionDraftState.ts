import type { ExpressionItemInput, PolarsExpressionRequest } from '@/api';

export type ExpressionContextTab = PolarsExpressionRequest['context'];

/**
 * Each editor row carries an opaque id for React list identity and one JSON
 * draft for a generated ExpressionItemInput.
 */
export interface ExpressionDraftItem {
  id: string;
  source: string;
}

export interface SortExpressionDraftItem extends ExpressionDraftItem {
  descending: boolean;
}

interface GroupByAggState {
  keySource: string;
  aggExpressions: ExpressionDraftItem[];
}

export interface TypedExpressionDraftState {
  activeContext: ExpressionContextTab;
  filterSource: string;
  withColumns: ExpressionDraftItem[];
  selectExpressions: ExpressionDraftItem[];
  sortItems: SortExpressionDraftItem[];
  groupByState: GroupByAggState;
}

export type ExpressionListTarget = 'withColumns' | 'selectExpressions' | 'groupByAgg';

export type TypedExpressionDraftAction =
  | { type: 'setActiveContext'; context: ExpressionContextTab }
  | { type: 'setFilterSource'; source: string }
  | { type: 'setGroupByKeySource'; source: string }
  | { type: 'addExpression'; target: ExpressionListTarget }
  | {
      type: 'updateExpressionSource';
      target: ExpressionListTarget;
      id: string;
      source: string;
    }
  | { type: 'removeExpression'; target: ExpressionListTarget; id: string }
  | { type: 'addSortExpression' }
  | { type: 'updateSortSource'; id: string; source: string }
  | { type: 'updateSortDescending'; id: string; descending: boolean }
  | { type: 'removeSortExpression'; id: string };

const newId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;

const blankExpression = (): ExpressionDraftItem => ({ id: newId(), source: '' });

const blankSortExpression = (): SortExpressionDraftItem => ({
  id: newId(),
  source: '',
  descending: false,
});

export const createTypedExpressionDraftState = (): TypedExpressionDraftState => ({
  activeContext: 'filter',
  filterSource: '',
  withColumns: [blankExpression()],
  selectExpressions: [blankExpression()],
  sortItems: [blankSortExpression()],
  groupByState: {
    keySource: '',
    aggExpressions: [blankExpression()],
  },
});

const updateList = (
  state: TypedExpressionDraftState,
  target: ExpressionListTarget,
  updater: (items: ExpressionDraftItem[]) => ExpressionDraftItem[],
): TypedExpressionDraftState => {
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

export const typedExpressionDraftReducer = (
  state: TypedExpressionDraftState,
  action: TypedExpressionDraftAction,
): TypedExpressionDraftState => {
  switch (action.type) {
    case 'setActiveContext':
      return { ...state, activeContext: action.context };
    case 'setFilterSource':
      return { ...state, filterSource: action.source };
    case 'setGroupByKeySource':
      return { ...state, groupByState: { ...state.groupByState, keySource: action.source } };
    case 'addExpression':
      return updateList(state, action.target, (items) => [...items, blankExpression()]);
    case 'updateExpressionSource':
      return updateList(state, action.target, (items) =>
        items.map((item) => (item.id === action.id ? { ...item, source: action.source } : item)),
      );
    case 'removeExpression':
      return updateList(state, action.target, (items) =>
        items.filter((item) => item.id !== action.id),
      );
    case 'addSortExpression':
      return { ...state, sortItems: [...state.sortItems, blankSortExpression()] };
    case 'updateSortSource':
      return {
        ...state,
        sortItems: state.sortItems.map((item) =>
          item.id === action.id ? { ...item, source: action.source } : item,
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

const parseExpressionItem = (source: string, label: string): ExpressionItemInput => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const item = parsed as Record<string, unknown>;
  if ('code' in item) {
    throw new Error(`${label} uses the removed raw-code format`);
  }
  const expression = item.expression;
  if (
    !expression ||
    typeof expression !== 'object' ||
    Array.isArray(expression) ||
    typeof (expression as Record<string, unknown>).op !== 'string'
  ) {
    throw new Error(`${label} requires an expression object with an op`);
  }
  return item as ExpressionItemInput;
};

const parseRows = (rows: ExpressionDraftItem[], label: string): ExpressionItemInput[] => {
  const parsed = rows
    .map((row) => row.source.trim())
    .filter(Boolean)
    .map((source, index) => parseExpressionItem(source, `${label} ${String(index + 1)}`));
  if (parsed.length === 0) throw new Error(`${label} is required`);
  return parsed;
};

export const buildTypedExpressionRequest = (
  drafts: TypedExpressionDraftState,
): PolarsExpressionRequest => {
  const { activeContext, filterSource, withColumns, selectExpressions, sortItems, groupByState } =
    drafts;

  if (activeContext === 'group_by_agg') {
    const groupSource = groupByState.keySource.trim();
    if (!groupSource) throw new Error('Grouping key is required');
    return {
      context: 'group_by_agg',
      expressions: parseRows(groupByState.aggExpressions, 'Aggregation'),
      group_by: [parseExpressionItem(groupSource, 'Grouping key')],
    };
  }

  if (activeContext === 'sort') {
    const expressions = sortItems
      .filter((item) => item.source.trim())
      .map((item, index) => ({
        ...parseExpressionItem(item.source.trim(), `Sort expression ${String(index + 1)}`),
        descending: item.descending,
      }));
    return { context: 'sort', expressions };
  }

  if (activeContext === 'filter') {
    const source = filterSource.trim();
    if (!source) throw new Error('Filter expression is required');
    return {
      context: 'filter',
      expressions: [parseExpressionItem(source, 'Filter expression')],
    };
  }

  if (activeContext === 'with_columns') {
    return {
      context: 'with_columns',
      expressions: parseRows(withColumns, 'With-columns expression'),
    };
  }

  return {
    context: 'select',
    expressions: parseRows(selectExpressions, 'Select expression'),
  };
};
