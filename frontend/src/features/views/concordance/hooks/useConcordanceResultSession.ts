import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useQueries } from '@tanstack/react-query';

import { queryAnalysisResult } from '@/api';
import type { ConcordanceAnalysisResponse, ConcordanceResultQuery } from '@/api';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { queryKeys } from '@/lib/queryKeys';
import { projectConcordanceResult } from '../../common/analysisApi';
import { VIZ_PALETTE } from '../../common/vizPalette';
import { buildCombinedSlice, CONCORDANCE_COMBINED_NODE_KEY } from '../concordanceTableDomain';
import {
  buildConcordanceNodeColorMap,
  buildConcordanceSourceColorMap,
  buildMatchedTextColorMap,
  collectConcordanceMatchedTexts,
  resolveConcordanceNodeIdForKey,
} from '../concordanceSourceDomain';
import type { PaginationState } from './useConcordanceTaskFlow';

interface ConcordanceResultSessionState {
  nodePagination: PaginationState;
  nodeDetaching: Record<string, boolean>;
  globalPageSize: number;
}

type ResultSessionAction =
  | { type: 'set-node-pagination'; value: SetStateAction<PaginationState> }
  | { type: 'set-node-detaching'; value: SetStateAction<Record<string, boolean>> }
  | { type: 'set-global-page-size'; value: SetStateAction<number> }
  | { type: 'apply-global-page-size'; pageSize: number }
  | { type: 'hydrate'; result: ConcordanceAnalysisResponse }
  | { type: 'reset' };

const INITIAL_STATE: ConcordanceResultSessionState = {
  nodePagination: {},
  nodeDetaching: {},
  globalPageSize: 20,
};

const resolveStateAction = <T>(current: T, value: SetStateAction<T>): T =>
  typeof value === 'function' ? (value as (previous: T) => T)(current) : value;

const applyPageSize = (pagination: PaginationState, pageSize: number): PaginationState =>
  Object.fromEntries(
    Object.entries(pagination).map(([nodeId, value]) => [
      nodeId,
      { ...value, pageSize, currentPage: 1 },
    ]),
  );

const resultSessionReducer = (
  state: ConcordanceResultSessionState,
  action: ResultSessionAction,
): ConcordanceResultSessionState => {
  switch (action.type) {
    case 'set-node-pagination':
      return { ...state, nodePagination: resolveStateAction(state.nodePagination, action.value) };
    case 'set-node-detaching':
      return { ...state, nodeDetaching: resolveStateAction(state.nodeDetaching, action.value) };
    case 'set-global-page-size':
      return { ...state, globalPageSize: resolveStateAction(state.globalPageSize, action.value) };
    case 'apply-global-page-size':
      return {
        ...state,
        globalPageSize: action.pageSize,
        nodePagination: applyPageSize(state.nodePagination, action.pageSize),
      };
    case 'hydrate': {
      const entries = Object.entries(action.result.data).filter(
        ([nodeId]) => nodeId !== CONCORDANCE_COMBINED_NODE_KEY,
      );
      const firstPageSize = entries[0]?.[1].pagination.page_size ?? state.globalPageSize;
      return {
        ...state,
        globalPageSize: firstPageSize,
        nodePagination: Object.fromEntries(
          entries.map(([nodeId, value]) => [
            nodeId,
            {
              currentPage: value.pagination.page,
              pageSize: value.pagination.page_size,
              sortBy: value.sorting.sort_by ?? undefined,
              descending: value.sorting.descending,
            },
          ]),
        ),
      };
    }
    case 'reset':
      return INITIAL_STATE;
  }
};

interface UseConcordanceResultSessionOptions {
  workspaceId: string | null;
  analysisId: string | null;
  baseResult: ConcordanceAnalysisResponse | null;
  viewMode: 'separated' | 'combined';
  combinedPage: number;
  selectedNodes: WorkspaceNodeMetadata[];
  showDispersion: boolean;
  colourMatches: boolean;
  lowercaseMatches: boolean;
  nodeColorOverrides?: Record<string, string>;
}

/** Projects immutable per-page Query resources and owns only result-view controls. */
export function useConcordanceResultSession({
  workspaceId,
  analysisId,
  baseResult,
  viewMode,
  combinedPage,
  selectedNodes,
  showDispersion,
  colourMatches,
  lowercaseMatches,
  nodeColorOverrides = {},
}: UseConcordanceResultSessionOptions) {
  const [state, dispatch] = useReducer(resultSessionReducer, INITIAL_STATE);
  const hydratedAnalysisRef = useRef<string | null>(null);

  const setNodePagination: Dispatch<SetStateAction<PaginationState>> = useCallback((value) => {
    dispatch({ type: 'set-node-pagination', value });
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
    if (!analysisId || !baseResult) {
      hydratedAnalysisRef.current = null;
      return;
    }
    if (hydratedAnalysisRef.current === analysisId) return;
    hydratedAnalysisRef.current = analysisId;
    const frame = requestAnimationFrame(() => {
      dispatch({ type: 'hydrate', result: baseResult });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [analysisId, baseResult]);

  const nodeIds = baseResult
    ? Object.keys(baseResult.data).filter((nodeId) => nodeId !== CONCORDANCE_COMBINED_NODE_KEY)
    : [];
  const projections = nodeIds.map((nodeId) => {
    const base = baseResult?.data[nodeId];
    const stateForNode = state.nodePagination[nodeId];
    const query: ConcordanceResultQuery = {
      node_id: nodeId,
      page: viewMode === 'combined' ? combinedPage : (stateForNode?.currentPage ?? 1),
      page_size: stateForNode?.pageSize ?? state.globalPageSize,
      sort_by: viewMode === 'combined' ? null : (stateForNode?.sortBy ?? null),
      descending: viewMode === 'combined' ? false : (stateForNode?.descending ?? false),
    };
    const matchesBase =
      viewMode === 'separated' &&
      base?.pagination.page === query.page &&
      base?.pagination.page_size === query.page_size &&
      (base?.sorting.sort_by ?? null) === (query.sort_by ?? null) &&
      base?.sorting.descending === query.descending;
    return { nodeId, query, enabled: Boolean(workspaceId && analysisId && !matchesBase) };
  });

  const projectionQueries = useQueries({
    queries: projections.map(({ query, enabled }) => ({
      queryKey:
        workspaceId && analysisId
          ? queryKeys.analysisResult(workspaceId, analysisId, {
              kind: 'concordance',
              ...query,
            })
          : ['analysis-session', '__inactive__', 'concordance-projection'],
      enabled,
      queryFn: async (): Promise<ConcordanceAnalysisResponse> => {
        if (!workspaceId || !analysisId) throw new Error('Analysis session is not active');
        const { data } = await queryAnalysisResult({
          body: { kind: 'concordance', ...query },
          path: { workspace_id: workspaceId, analysis_id: analysisId },
          throwOnError: true,
        });
        if (data.kind !== 'concordance') {
          throw new Error('Concordance query returned the wrong Result kind');
        }
        return projectConcordanceResult(data);
      },
    })),
  });

  const projectedData = { ...(baseResult?.data ?? {}) };
  projections.forEach(({ nodeId }, index) => {
    const projection = projectionQueries[index]?.data;
    const slice = projection?.data[nodeId];
    if (slice) projectedData[nodeId] = slice;
  });
  if (viewMode === 'combined' && nodeIds.length >= 2) {
    const left = projectedData[nodeIds[0] ?? ''];
    const right = projectedData[nodeIds[1] ?? ''];
    if (left && right) {
      projectedData[CONCORDANCE_COMBINED_NODE_KEY] = buildCombinedSlice(
        left,
        right,
        combinedPage,
        state.globalPageSize,
      );
    }
  }
  const results = baseResult ? { ...baseResult, data: projectedData } : null;
  const nodeLoading = Object.fromEntries(
    projections.map(({ nodeId }, index) => [nodeId, projectionQueries[index]?.isFetching ?? false]),
  );

  const labelToNodeId = null;
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

  return {
    results,
    nodePagination: state.nodePagination,
    setNodePagination,
    nodeLoading,
    nodeDetaching: state.nodeDetaching,
    setNodeDetaching,
    globalPageSize: state.globalPageSize,
    setGlobalPageSize,
    applyGlobalPageSize: (pageSize: number) => {
      dispatch({ type: 'apply-global-page-size', pageSize });
    },
    reset: () => {
      hydratedAnalysisRef.current = null;
      dispatch({ type: 'reset' });
    },
    combinedLoading: viewMode === 'combined' && projectionQueries.some((query) => query.isFetching),
    labelToNodeId,
    defaultPalette,
    nodeColors,
    sourceColorMap,
    allMatchedTexts,
    matchedTextColorMap,
    resolveNodeIdForKey,
  };
}
