import { useCallback, useReducer, type Dispatch, type SetStateAction } from 'react';

import type { QuotationAnalysisResponse, QuotationMetadata } from '@/api';
import type { NodePaginationState } from '../../common/tasks/types';
import { normalizeQuotationRow, type QuotationResultRow } from '../quotationResultsModel';

export interface QuotationResultState {
  groupedRows: QuotationGroupedRow[];
  rows: QuotationResultRow[];
  columns: string[];
  metadata: QuotationMetadata;
  pagination: {
    page: number;
    page_size: number;
    total_source_rows: number;
    total_source_pages: number;
    result_count: number;
    has_next: boolean;
    has_prev: boolean;
  };
  sorting: {
    sort_by?: string | null;
    descending: boolean;
  };
  column: string;
}

type QuotationHitRow = Record<string, unknown>;
type QuotationGroupedRow = QuotationHitRow[];

interface QuotationResultControlsState {
  nodeState: Record<string, NodePaginationState>;
  nodeDetaching: Record<string, boolean>;
  resultsByNode: Record<string, QuotationResultState>;
}

type BooleanMapUpdater = SetStateAction<Record<string, boolean>>;

type QuotationResultControlsAction =
  | { type: 'store-result'; nodeId: string; normalized: QuotationResultState }
  | { type: 'reset-after-clear' }
  | { type: 'set-node-detaching'; updater: BooleanMapUpdater };

const initialState: QuotationResultControlsState = {
  nodeState: {},
  nodeDetaching: {},
  resultsByNode: {},
};

function applyMapUpdater<T>(current: T, updater: SetStateAction<T>): T {
  return typeof updater === 'function' ? (updater as (previous: T) => T)(current) : updater;
}

function buildQuotationResultState(
  result: QuotationAnalysisResponse,
  column: string,
): QuotationResultState {
  const groupedRows = result.data;
  const rows = groupedRows
    .flatMap((group) => group)
    .map((row) => normalizeQuotationRow(row, column));

  return {
    groupedRows,
    rows,
    columns: result.metadata.all_columns.slice(),
    metadata: result.metadata,
    pagination: result.pagination,
    sorting: result.sorting,
    column,
  };
}

function reducer(
  state: QuotationResultControlsState,
  action: QuotationResultControlsAction,
): QuotationResultControlsState {
  switch (action.type) {
    case 'store-result':
      return {
        ...state,
        resultsByNode: { ...state.resultsByNode, [action.nodeId]: action.normalized },
        nodeState: {
          ...state.nodeState,
          [action.nodeId]: {
            currentPage: action.normalized.pagination.page,
            pageSize: action.normalized.pagination.page_size,
            sortBy: action.normalized.sorting.sort_by ?? undefined,
            descending: action.normalized.sorting.descending,
          },
        },
      };
    case 'reset-after-clear':
      return initialState;
    case 'set-node-detaching':
      return {
        ...state,
        nodeDetaching: applyMapUpdater(state.nodeDetaching, action.updater),
      };
  }
}

/** Owns normalized quotation rows, pagination state, and detach progress. */
export function useQuotationResultControls() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const setNodeDetaching: Dispatch<SetStateAction<Record<string, boolean>>> = useCallback(
    (updater) => {
      dispatch({ type: 'set-node-detaching', updater });
    },
    [],
  );

  const updateResultState = (
    nodeId: string,
    column: string,
    result: QuotationAnalysisResponse,
  ): QuotationResultState => {
    const normalized = buildQuotationResultState(result, column);
    dispatch({ type: 'store-result', nodeId, normalized });
    return normalized;
  };

  const resetAfterClear = () => {
    dispatch({ type: 'reset-after-clear' });
  };

  return {
    nodeState: state.nodeState,
    nodeDetaching: state.nodeDetaching,
    setNodeDetaching,
    resultsByNode: state.resultsByNode,
    updateResultState,
    resetAfterClear,
  };
}
