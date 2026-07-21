import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';

import type { ConcordanceAnalysisResponse } from '@/api';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { useSafeResult } from '../../common/useSafeResult';
import { VIZ_PALETTE } from '../../common/vizPalette';
import {
  buildConcordanceNodeColorMap,
  buildConcordanceSourceColorMap,
  buildMatchedTextColorMap,
  collectConcordanceMatchedTexts,
  normalizeConcordanceLabelToNodeMap,
  resolveConcordanceNodeIdForKey,
} from '../concordanceSourceDomain';
import type { PaginationState } from './useConcordanceTaskFlow';

interface ConcordanceResultSessionState {
  nodePagination: PaginationState;
  nodeLoading: Record<string, boolean>;
  nodeDetaching: Record<string, boolean>;
  globalPageSize: number;
}

type ResultSessionAction =
  | { type: 'set-node-pagination'; value: SetStateAction<PaginationState> }
  | { type: 'set-node-loading'; value: SetStateAction<Record<string, boolean>> }
  | { type: 'set-node-detaching'; value: SetStateAction<Record<string, boolean>> }
  | { type: 'set-global-page-size'; value: SetStateAction<number> }
  | { type: 'apply-global-page-size'; pageSize: number }
  | { type: 'sync-hydrated-page-size'; pageSize: number }
  | { type: 'reset' };

const INITIAL_STATE: ConcordanceResultSessionState = {
  nodePagination: {},
  nodeLoading: {},
  nodeDetaching: {},
  globalPageSize: 20,
};

const resolveStateAction = <T>(current: T, value: SetStateAction<T>): T =>
  typeof value === 'function' ? (value as (previous: T) => T)(current) : value;

const applyPageSize = (
  pagination: PaginationState,
  pageSize: number,
  resetPage: boolean,
): PaginationState =>
  Object.fromEntries(
    Object.entries(pagination).map(([nodeId, value]) => [
      nodeId,
      { ...value, pageSize, currentPage: resetPage ? 1 : value.currentPage },
    ]),
  );

const resultSessionReducer = (
  state: ConcordanceResultSessionState,
  action: ResultSessionAction,
): ConcordanceResultSessionState => {
  switch (action.type) {
    case 'set-node-pagination':
      return { ...state, nodePagination: resolveStateAction(state.nodePagination, action.value) };
    case 'set-node-loading':
      return { ...state, nodeLoading: resolveStateAction(state.nodeLoading, action.value) };
    case 'set-node-detaching':
      return { ...state, nodeDetaching: resolveStateAction(state.nodeDetaching, action.value) };
    case 'set-global-page-size':
      return { ...state, globalPageSize: resolveStateAction(state.globalPageSize, action.value) };
    case 'apply-global-page-size':
      return {
        ...state,
        globalPageSize: action.pageSize,
        nodePagination: applyPageSize(state.nodePagination, action.pageSize, true),
      };
    case 'sync-hydrated-page-size':
      return {
        ...state,
        globalPageSize: action.pageSize,
        nodePagination: applyPageSize(state.nodePagination, action.pageSize, false),
      };
    case 'reset':
      return INITIAL_STATE;
  }
};

interface UseConcordanceResultSessionOptions {
  selectedNodes: WorkspaceNodeMetadata[];
  showDispersion: boolean;
  colourMatches: boolean;
  lowercaseMatches: boolean;
  nodeColorOverrides?: Record<string, string>;
}

/** Owns one concordance result, pagination state, display colours, and detach progress. */
export function useConcordanceResultSession({
  selectedNodes,
  showDispersion,
  colourMatches,
  lowercaseMatches,
  nodeColorOverrides = {},
}: UseConcordanceResultSessionOptions) {
  const [results, resultRef, setResults] = useSafeResult<ConcordanceAnalysisResponse>();
  const [state, dispatch] = useReducer(resultSessionReducer, INITIAL_STATE);
  const taskId = (() => {
    const metadata = results?.metadata as Record<string, unknown> | undefined;
    return typeof metadata?.task_id === 'string' ? metadata.task_id : '';
  })();
  const taskIdRef = useRef('');
  const pageSizeHydratedForTaskRef = useRef<string | null>(null);

  useEffect(() => {
    if (taskId) taskIdRef.current = taskId;
  }, [taskId]);

  const setNodePagination: Dispatch<SetStateAction<PaginationState>> = useCallback((value) => {
    dispatch({ type: 'set-node-pagination', value });
  }, []);
  const setNodeLoading: Dispatch<SetStateAction<Record<string, boolean>>> = useCallback((value) => {
    dispatch({ type: 'set-node-loading', value });
  }, []);
  const setNodeDetaching: Dispatch<SetStateAction<Record<string, boolean>>> = useCallback(
    (value) => {
      dispatch({ type: 'set-node-detaching', value });
    },
    [],
  );
  const setGlobalPageSize: Dispatch<SetStateAction<number>> = useCallback((value) => {
    dispatch({ type: 'set-global-page-size', value });
  }, []);

  useEffect(() => {
    if (!results) {
      pageSizeHydratedForTaskRef.current = null;
      return;
    }
    const resultIdentity = taskId || taskIdRef.current || 'unscoped-result';
    if (pageSizeHydratedForTaskRef.current === resultIdentity) return;
    pageSizeHydratedForTaskRef.current = resultIdentity;
    const firstNodePageSize = Object.values(results.data)[0]?.pagination.page_size;
    const nextPageSize = results.query.page_size ?? firstNodePageSize;
    if (
      typeof nextPageSize !== 'number' ||
      !Number.isFinite(nextPageSize) ||
      nextPageSize <= 0 ||
      nextPageSize === state.globalPageSize
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      dispatch({ type: 'sync-hydrated-page-size', pageSize: nextPageSize });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [results, state.globalPageSize, taskId]);

  const labelToNodeId = normalizeConcordanceLabelToNodeMap(results?.analysis_params);
  const defaultPalette = VIZ_PALETTE;
  const nodeColors = buildConcordanceNodeColorMap(
    selectedNodes,
    defaultPalette,
    nodeColorOverrides,
  );
  const sourceColorMap = buildConcordanceSourceColorMap(selectedNodes, nodeColors, defaultPalette);
  const resolveNodeIdForKey = (nodeKey: string): string | null =>
    resolveConcordanceNodeIdForKey(nodeKey, selectedNodes, labelToNodeId);
  const allMatchedTexts =
    showDispersion && colourMatches
      ? collectConcordanceMatchedTexts(results?.data, { lowercaseMatches })
      : [];
  const matchedTextColorMap = buildMatchedTextColorMap(allMatchedTexts, defaultPalette);

  const applyGlobalPageSize = (pageSize: number) => {
    dispatch({ type: 'apply-global-page-size', pageSize });
  };
  const reset = () => {
    setResults(null);
    taskIdRef.current = '';
    pageSizeHydratedForTaskRef.current = null;
    dispatch({ type: 'reset' });
  };

  return {
    results,
    resultRef,
    setResults,
    taskId,
    nodePagination: state.nodePagination,
    setNodePagination,
    nodeLoading: state.nodeLoading,
    setNodeLoading,
    nodeDetaching: state.nodeDetaching,
    setNodeDetaching,
    globalPageSize: state.globalPageSize,
    setGlobalPageSize,
    applyGlobalPageSize,
    reset,
    labelToNodeId,
    defaultPalette,
    nodeColors,
    sourceColorMap,
    allMatchedTexts,
    matchedTextColorMap,
    resolveNodeIdForKey,
  };
}
