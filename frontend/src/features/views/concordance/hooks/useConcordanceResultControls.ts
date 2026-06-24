import { useCallback, useEffect, useReducer, useRef, type SetStateAction } from 'react';

import type { ConcordanceAnalysisResponse } from '@/api';
import type { PaginationState } from './useConcordanceTaskFlow';

export interface MaterializeSummary {
  recordCount: number;
  uniqueDocuments: number;
  totalDocuments: number;
}

interface UseConcordanceResultControlsOptions {
  results: ConcordanceAnalysisResponse | null;
}

interface ConcordanceResultControlsState {
  nodePagination: PaginationState;
  nodeLoading: Record<string, boolean>;
  nodeDetaching: Record<string, boolean>;
  nodeMaterializing: Record<string, boolean>;
  materializeTaskIds: Record<string, string>;
  materializeSummaries: Record<string, MaterializeSummary>;
  globalPageSize: number;
}

type ConcordanceResultControlsAction =
  | { type: 'set-node-pagination'; action: SetStateAction<PaginationState> }
  | { type: 'set-node-loading'; action: SetStateAction<Record<string, boolean>> }
  | { type: 'set-node-detaching'; action: SetStateAction<Record<string, boolean>> }
  | { type: 'set-node-materializing'; action: SetStateAction<Record<string, boolean>> }
  | { type: 'set-materialize-task-ids'; action: SetStateAction<Record<string, string>> }
  | {
      type: 'set-materialize-summaries';
      action: SetStateAction<Record<string, MaterializeSummary>>;
    }
  | { type: 'set-global-page-size'; action: SetStateAction<number> }
  | { type: 'apply-global-page-size'; pageSize: number }
  | {
      type: 'sync-hydrated-page-size';
      pageSize: number;
      resetCurrentPage: boolean;
    }
  | {
      type: 'apply-hydrated-materialize-summaries';
      summaries: Record<string, Record<string, unknown>> | undefined;
    }
  | { type: 'reset-after-clear' };

const INITIAL_RESULT_CONTROLS_STATE: ConcordanceResultControlsState = {
  nodePagination: {},
  nodeLoading: {},
  nodeDetaching: {},
  nodeMaterializing: {},
  materializeTaskIds: {},
  materializeSummaries: {},
  globalPageSize: 20,
};

const resolveStateAction = <T,>(current: T, action: SetStateAction<T>): T =>
  typeof action === 'function' ? (action as (value: T) => T)(current) : action;

const applyPageSizeToPagination = (
  nodePagination: PaginationState,
  pageSize: number,
  resetCurrentPage: boolean,
): PaginationState => {
  const updated = { ...nodePagination };
  for (const [nodeId, value] of Object.entries(updated)) {
    updated[nodeId] = {
      ...value,
      pageSize,
      currentPage: resetCurrentPage ? 1 : value.currentPage,
    };
  }
  return updated;
};

/**
 * Parses backend materialization summary metadata into the display shape used
 * by Concordance result blocks.
 * Used by: useConcordanceResultControls and ConcordanceFeature request
 * hydration because materialization summaries can arrive from saved requests or
 * terminal materialize-task refreshes.
 */
function parseMaterializeSummaries(
  summaries: Record<string, Record<string, unknown>> | undefined,
): Record<string, MaterializeSummary> {
  const parsed: Record<string, MaterializeSummary> = {};
  if (!summaries || typeof summaries !== 'object') {
    return parsed;
  }
  for (const [nodeId, summary] of Object.entries(summaries)) {
    parsed[nodeId] = {
      recordCount: Number(summary.record_count) || 0,
      uniqueDocuments: Number(summary.unique_documents_with_hits) || 0,
      totalDocuments: Number(summary.total_source_documents) || 0,
    };
  }
  return parsed;
}

/**
 * Owns result-control maps and page-size transitions for Concordance results.
 * Used by: useConcordanceResultControls so hydration, materialization events,
 * clear actions, and task-flow functional updates share one transition surface.
 */
const concordanceResultControlsReducer = (
  state: ConcordanceResultControlsState,
  action: ConcordanceResultControlsAction,
): ConcordanceResultControlsState => {
  switch (action.type) {
    case 'set-node-pagination':
      return {
        ...state,
        nodePagination: resolveStateAction(state.nodePagination, action.action),
      };
    case 'set-node-loading':
      return { ...state, nodeLoading: resolveStateAction(state.nodeLoading, action.action) };
    case 'set-node-detaching':
      return {
        ...state,
        nodeDetaching: resolveStateAction(state.nodeDetaching, action.action),
      };
    case 'set-node-materializing':
      return {
        ...state,
        nodeMaterializing: resolveStateAction(state.nodeMaterializing, action.action),
      };
    case 'set-materialize-task-ids':
      return {
        ...state,
        materializeTaskIds: resolveStateAction(state.materializeTaskIds, action.action),
      };
    case 'set-materialize-summaries':
      return {
        ...state,
        materializeSummaries: resolveStateAction(state.materializeSummaries, action.action),
      };
    case 'set-global-page-size':
      return { ...state, globalPageSize: resolveStateAction(state.globalPageSize, action.action) };
    case 'apply-global-page-size':
      return {
        ...state,
        globalPageSize: action.pageSize,
        nodePagination: applyPageSizeToPagination(state.nodePagination, action.pageSize, true),
      };
    case 'sync-hydrated-page-size':
      return {
        ...state,
        globalPageSize: action.pageSize,
        nodePagination: applyPageSizeToPagination(
          state.nodePagination,
          action.pageSize,
          action.resetCurrentPage,
        ),
      };
    case 'apply-hydrated-materialize-summaries':
      return {
        ...state,
        materializeSummaries: parseMaterializeSummaries(action.summaries),
      };
    case 'reset-after-clear':
      return {
        ...state,
        nodePagination: {},
        materializeSummaries: {},
      };
  }
};

/**
 * Owns Concordance result control state: per-node pagination/loading flags,
 * materialize progress, materialize summaries, and the shared page-size value.
 * Used by: ConcordanceFeature so result-table controls and materialization
 * bookkeeping are grouped behind one hook instead of scattered across the
 * feature shell.
 * Flow: initialize result-control defaults, hydrate page size once per result
 * load, mirror global page-size changes onto tracked node pagination, parse
 * materialization summaries, and expose reset helpers for clear/hydration.
 */
export function useConcordanceResultControls({ results }: UseConcordanceResultControlsOptions) {
  const [state, dispatch] = useReducer(
    concordanceResultControlsReducer,
    INITIAL_RESULT_CONTROLS_STATE,
  );
  const prefsSyncedRef = useRef(false);

  const setNodePagination = useCallback((action: SetStateAction<PaginationState>) => {
    dispatch({ type: 'set-node-pagination', action });
  }, []);
  const setNodeLoading = useCallback((action: SetStateAction<Record<string, boolean>>) => {
    dispatch({ type: 'set-node-loading', action });
  }, []);
  const setNodeDetaching = useCallback((action: SetStateAction<Record<string, boolean>>) => {
    dispatch({ type: 'set-node-detaching', action });
  }, []);
  const setNodeMaterializing = useCallback((action: SetStateAction<Record<string, boolean>>) => {
    dispatch({ type: 'set-node-materializing', action });
  }, []);
  const setMaterializeTaskIds = useCallback((action: SetStateAction<Record<string, string>>) => {
    dispatch({ type: 'set-materialize-task-ids', action });
  }, []);
  const setMaterializeSummaries = useCallback(
    (action: SetStateAction<Record<string, MaterializeSummary>>) => {
      dispatch({ type: 'set-materialize-summaries', action });
    },
    [],
  );
  const setGlobalPageSize = useCallback((action: SetStateAction<number>) => {
    dispatch({ type: 'set-global-page-size', action });
  }, []);

  /**
   * Applies a page size to every tracked node and resets their current page.
   * Called by: ConcordanceFeature's page-size selector and materialize-event
   * lifecycle when result shape changes back to occurrence-row mode.
   */
  const applyGlobalPageSize = (newSize: number) => {
    dispatch({ type: 'apply-global-page-size', pageSize: newSize });
  };

  /**
   * Replaces materialize summaries from a saved task request.
   * Called by: ConcordanceFeature request hydration so stale summaries from a
   * previous task cannot survive into a restored task.
   */
  const applyHydratedMaterializeSummaries = (
    summaries: Record<string, Record<string, unknown>> | undefined,
  ) => {
    dispatch({ type: 'apply-hydrated-materialize-summaries', summaries });
  };

  /**
   * Clears result-specific control state after Clear Results.
   * Called by: ConcordanceFeature's shared analysis lifecycle callback.
   */
  const resetAfterClear = () => {
    dispatch({ type: 'reset-after-clear' });
  };

  useEffect(() => {
    if (!results) {
      prefsSyncedRef.current = false;
      return;
    }
    // Only sync preferences on the first result load (hydration). Subsequent
    // result updates can carry older page_size values after a user change.
    if (prefsSyncedRef.current) return;
    prefsSyncedRef.current = true;

    const analysisParams = results.analysis_params ?? {};
    const preferenceSource =
      results.preferences ??
      ((analysisParams as Record<string, unknown>).preferences as
        | Record<string, unknown>
        | undefined) ??
      {};
    const firstNodeEntry = Object.values(results.data)[0];
    const firstNodePageSize = firstNodeEntry?.pagination.page_size;
    const nextPageSize =
      preferenceSource.page_size ?? analysisParams.page_size ?? firstNodePageSize;

    if (
      typeof nextPageSize === 'number' &&
      Number.isFinite(nextPageSize) &&
      nextPageSize > 0 &&
      nextPageSize !== state.globalPageSize
    ) {
      const id = requestAnimationFrame(() => {
        dispatch({
          type: 'sync-hydrated-page-size',
          pageSize: nextPageSize,
          resetCurrentPage: false,
        });
      });
      return () => {
        cancelAnimationFrame(id);
      };
    }
  }, [results, state.globalPageSize]);

  return {
    nodePagination: state.nodePagination,
    setNodePagination,
    nodeLoading: state.nodeLoading,
    setNodeLoading,
    nodeDetaching: state.nodeDetaching,
    setNodeDetaching,
    nodeMaterializing: state.nodeMaterializing,
    setNodeMaterializing,
    materializeTaskIds: state.materializeTaskIds,
    setMaterializeTaskIds,
    materializeSummaries: state.materializeSummaries,
    setMaterializeSummaries,
    globalPageSize: state.globalPageSize,
    setGlobalPageSize,
    applyGlobalPageSize,
    applyHydratedMaterializeSummaries,
    resetAfterClear,
  };
}
