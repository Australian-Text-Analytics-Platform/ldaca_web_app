import { useCallback, useReducer, type Dispatch, type SetStateAction } from 'react';

import type { QuotationAnalysisResponse, QuotationMetadata } from '@/api';
import type { NodePaginationState } from '../../common/tasks/types';
import {
  normalizeQuotationMaterialization,
  normalizeQuotationRow,
  type QuotationMaterialization,
  type QuotationMaterializeSummary,
  type QuotationResultRow,
} from '../quotationResultsModel';

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

export type MaterializeSummary = QuotationMaterializeSummary;

interface QuotationResultControlsState {
  nodeState: Record<string, NodePaginationState>;
  nodeDetaching: Record<string, boolean>;
  nodeMaterializing: Record<string, boolean>;
  materializeTaskIds: Record<string, string>;
  materializedPaths: Record<string, string>;
  materializeSummary: MaterializeSummary | null;
  resultsByNode: Record<string, QuotationResultState>;
}

type BooleanMapUpdater = SetStateAction<Record<string, boolean>>;
type StringMapUpdater = SetStateAction<Record<string, string>>;

type QuotationResultControlsAction =
  | {
      type: 'store-result';
      nodeId: string;
      normalized: QuotationResultState;
    }
  | {
      type: 'apply-materialized-request';
      nodeId: string;
      materialization: QuotationMaterialization;
    }
  | { type: 'reset-after-clear' }
  | { type: 'set-node-detaching'; updater: BooleanMapUpdater }
  | { type: 'set-node-materializing'; updater: BooleanMapUpdater }
  | { type: 'set-materialize-task-ids'; updater: StringMapUpdater };

const initialQuotationResultControlsState: QuotationResultControlsState = {
  nodeState: {},
  nodeDetaching: {},
  nodeMaterializing: {},
  materializeTaskIds: {},
  materializedPaths: {},
  materializeSummary: null,
  resultsByNode: {},
};

/**
 * Applies a React set-state-style updater inside the reducer.
 * Used by: useQuotationResultControls' adapter setters because
 * useQuotationTaskFlow and useMaterializeLifecycle already accept Dispatch
 * setters and should not need to know that the hook now stores one coherent
 * reducer state.
 */
function applyMapUpdater<T>(current: T, updater: SetStateAction<T>): T {
  if (typeof updater === 'function') {
    return (updater as (previous: T) => T)(current);
  }
  return updater;
}

/**
 * Removes one keyed entry without mutating the previous map.
 * Used by: quotationResultControlsReducer when a refreshed request or
 * terminal materialize task clears a node-scoped marker.
 */
function withoutKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const { [key]: _removed, ...next } = map;
  void _removed;
  return next;
}

/**
 * Normalizes a Quotation response into the result-state shape consumed by
 * QuotationNodeBlock.
 * Used by: useQuotationResultControls when live searches, stored-task updates,
 * and hydration need to fold backend rows into table state consistently.
 * Flow: flatten grouped rows for display, collect generated quote/speaker/verb
 * spans, then preserve backend pagination, sorting, metadata, and selected
 * source column.
 */
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

/**
 * Owns every quotation result-control transition in one place.
 * Used by: useQuotationResultControls so normalized rows, pagination mirrors,
 * materialize paths, summaries, and async progress maps cannot drift across
 * independent state setters.
 * Flow: store backend results with their matching pagination state, apply
 * refreshed materialization metadata, keep adapter setter updates compatible,
 * and reset result-owned state after Clear Results.
 */
function quotationResultControlsReducer(
  state: QuotationResultControlsState,
  action: QuotationResultControlsAction,
): QuotationResultControlsState {
  switch (action.type) {
    case 'store-result':
      return {
        ...state,
        resultsByNode: {
          ...state.resultsByNode,
          [action.nodeId]: action.normalized,
        },
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
    case 'apply-materialized-request':
      return {
        ...state,
        materializedPaths: action.materialization.path
          ? { ...state.materializedPaths, [action.nodeId]: action.materialization.path }
          : withoutKey(state.materializedPaths, action.nodeId),
        materializeSummary: action.materialization.summary,
      };
    case 'reset-after-clear':
      return {
        ...state,
        resultsByNode: {},
        nodeState: {},
        materializedPaths: {},
        materializeSummary: null,
      };
    case 'set-node-detaching':
      return {
        ...state,
        nodeDetaching: applyMapUpdater(state.nodeDetaching, action.updater),
      };
    case 'set-node-materializing':
      return {
        ...state,
        nodeMaterializing: applyMapUpdater(state.nodeMaterializing, action.updater),
      };
    case 'set-materialize-task-ids':
      return {
        ...state,
        materializeTaskIds: applyMapUpdater(state.materializeTaskIds, action.updater),
      };
    default:
      return state;
  }
}

/**
 * Owns Quotation result state and per-node result controls.
 * Used by: QuotationFeature so task-flow callbacks and the result table share
 * one small API for result normalization, pagination state, materialize
 * progress, materialized-path hydration, and clear reset.
 * Flow: normalize incoming backend results, mirror their pagination/sorting
 * into node state, track detach/materialize flags, parse materialize request
 * metadata, and clear all result-specific state when the user clears results.
 */
export function useQuotationResultControls() {
  const [state, dispatch] = useReducer(
    quotationResultControlsReducer,
    initialQuotationResultControlsState,
  );

  const setNodeDetaching: Dispatch<SetStateAction<Record<string, boolean>>> = useCallback(
    (updater) => {
      dispatch({ type: 'set-node-detaching', updater });
    },
    [],
  );

  const setNodeMaterializing: Dispatch<SetStateAction<Record<string, boolean>>> = useCallback(
    (updater) => {
      dispatch({ type: 'set-node-materializing', updater });
    },
    [],
  );

  const setMaterializeTaskIds: Dispatch<SetStateAction<Record<string, string>>> = useCallback(
    (updater) => {
      dispatch({ type: 'set-materialize-task-ids', updater });
    },
    [],
  );

  /**
   * Stores normalized quotation results and matching pagination/sort state for one node.
   * Called by: QuotationFeature hydration and useQuotationTaskFlow after the
   * backend returns live or stored quotation results.
   */
  const updateResultState = (
    nodeId: string,
    column: string,
    result: QuotationAnalysisResponse,
  ): QuotationResultState => {
    const normalized = buildQuotationResultState(result, column);
    dispatch({ type: 'store-result', nodeId, normalized });
    return normalized;
  };

  /**
   * Applies materialized-path and summary values from a saved or refreshed request.
   * Called by: QuotationFeature request hydration and materialize-task success
   * refresh so the result controls can switch from grouped preview counts to
   * materialized-corpus counts.
   */
  const applyMaterializedRequest = (
    nodeId: string,
    path: unknown,
    summary: Record<string, unknown> | undefined,
  ) => {
    dispatch({
      type: 'apply-materialized-request',
      nodeId,
      materialization: normalizeQuotationMaterialization(path, summary),
    });
  };

  /**
   * Clears state that belongs to the active quotation result.
   * Called by: QuotationFeature's analysis lifecycle clear callback so stale
   * rows, pagination, summaries, and materialized-path markers cannot leak into
   * the next run for the same node.
   */
  const resetAfterClear = () => {
    dispatch({ type: 'reset-after-clear' });
  };

  return {
    nodeState: state.nodeState,
    nodeDetaching: state.nodeDetaching,
    setNodeDetaching,
    nodeMaterializing: state.nodeMaterializing,
    setNodeMaterializing,
    materializeTaskIds: state.materializeTaskIds,
    setMaterializeTaskIds,
    materializedPaths: state.materializedPaths,
    materializeSummary: state.materializeSummary,
    resultsByNode: state.resultsByNode,
    updateResultState,
    applyMaterializedRequest,
    resetAfterClear,
  };
}
