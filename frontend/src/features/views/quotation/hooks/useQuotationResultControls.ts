import { useCallback, useReducer, type Dispatch, type SetStateAction } from 'react';

import type { QuotationAnalysisResponse, QuotationMetadata } from '@/api';
import type { NodePaginationState } from '../../common/tasks/types';
import { QUOTATION_COLUMN_KEYS } from '../../common/generatedColumns';

export interface QuotationResultState {
  groupedRows: QuotationGroupedRow[];
  rows: QuotationDisplayRow[];
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

type QuotationDisplayRow = QuotationHitRow & {
  __spans: { start: number; end: number; type: string }[];
};

export interface MaterializeSummary {
  recordCount: number;
  uniqueDocuments: number;
  totalDocuments: number;
}

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
      path: unknown;
      summary: Record<string, unknown> | undefined;
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
 * Parses backend materialization summary metadata into the display shape used
 * by the Quotation result controls.
 * Used by: useQuotationResultControls because saved requests and completed
 * materialize tasks both return snake_case summary fields from the backend.
 */
function parseMaterializeSummary(
  summary: Record<string, unknown> | undefined,
): MaterializeSummary | null {
  if (!summary) return null;
  return {
    recordCount: Number(summary.record_count) || 0,
    uniqueDocuments: Number(summary.unique_documents_with_hits) || 0,
    totalDocuments: Number(summary.total_source_documents) || 0,
  };
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
    .map((row) => {
      const spans: { start: number; end: number; type: string }[] = [];
      const addSpan = (start?: unknown, end?: unknown, type?: string) => {
        if (!type) return;
        const s = Number(start);
        const e = Number(end);
        if (Number.isFinite(s) && Number.isFinite(e) && s < e) {
          spans.push({ start: s, end: e, type });
        }
      };
      addSpan(
        row[QUOTATION_COLUMN_KEYS.speakerStartIdx],
        row[QUOTATION_COLUMN_KEYS.speakerEndIdx],
        'speaker',
      );
      addSpan(
        row[QUOTATION_COLUMN_KEYS.quoteStartIdx],
        row[QUOTATION_COLUMN_KEYS.quoteEndIdx],
        'quote',
      );
      addSpan(
        row[QUOTATION_COLUMN_KEYS.verbStartIdx],
        row[QUOTATION_COLUMN_KEYS.verbEndIdx],
        'verb',
      );
      return { ...row, __spans: spans };
    }) as QuotationDisplayRow[];

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
        materializedPaths:
          typeof action.path === 'string' && action.path
            ? { ...state.materializedPaths, [action.nodeId]: action.path }
            : withoutKey(state.materializedPaths, action.nodeId),
        materializeSummary: parseMaterializeSummary(action.summary),
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
    dispatch({ type: 'apply-materialized-request', nodeId, path, summary });
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
