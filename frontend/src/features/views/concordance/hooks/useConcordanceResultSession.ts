import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useQueries } from '@tanstack/react-query';

import { getConcordanceTableDensity, queryAnalysisResult } from '@/api';
import type {
  ConcordanceAnalysisResponse,
  ConcordanceDensityResult,
  ConcordanceResultQuery,
} from '@/api';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { createNodeDataRequest, queryKeys } from '@/lib/queryKeys';
import { fetchArrowTablePage } from '@/lib/arrow/arrowTable';
import { queryConcordanceDocumentProjectionTable } from '@/api/tableApi';
import { projectConcordanceResult } from '../../common/analysisApi';
import { VIZ_PALETTE } from '../../common/vizPalette';
import { buildCombinedSlice, CONCORDANCE_COMBINED_NODE_KEY } from '../concordanceTableDomain';
import {
  buildConcordanceNodeColorMap,
  buildConcordanceSourceColorMap,
  resolveConcordanceNodeIdForKey,
} from '../concordanceSourceDomain';
import {
  projectConcordanceRunAllReviewPage,
  type ConcordanceReviewRowUnit,
  type ConcordanceRunAllReviewSource,
} from '../concordanceRunAllReview';
import type { DispersionDisplayBinCount } from '../concordanceDispersionDomain';
import type { PaginationState } from './useConcordanceTaskFlow';

interface ConcordanceResultSessionState {
  nodePagination: PaginationState;
  globalPageSize: number;
}

type ResultSessionAction =
  | { type: 'set-node-pagination'; value: SetStateAction<PaginationState> }
  | { type: 'set-global-page-size'; value: SetStateAction<number> }
  | { type: 'apply-global-page-size'; pageSize: number }
  | { type: 'hydrate'; result: ConcordanceAnalysisResponse }
  | { type: 'reset' };

const INITIAL_STATE: ConcordanceResultSessionState = {
  nodePagination: {},
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
  nodeColorOverrides?: Record<string, string>;
  reviewSources?: ConcordanceRunAllReviewSource[];
  selectedBinIndices: Record<string, Set<number>>;
  excludedMatchedTexts: Record<string, Set<string>>;
  binCount: DispersionDisplayBinCount;
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
  nodeColorOverrides = {},
  reviewSources = [],
  selectedBinIndices,
  excludedMatchedTexts,
  binCount,
}: UseConcordanceResultSessionOptions) {
  const [state, dispatch] = useReducer(resultSessionReducer, INITIAL_STATE);
  const hydratedAnalysisRef = useRef<string | null>(null);
  const reviewIdentity = reviewSources
    .map((review) => `${review.analysisId}:${review.source.table.table_id}`)
    .join('|');

  const setNodePagination: Dispatch<SetStateAction<PaginationState>> = useCallback((value) => {
    dispatch({ type: 'set-node-pagination', value });
  }, []);
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

  useEffect(() => {
    if (!reviewIdentity) return;
    const identity = `review:${reviewIdentity}`;
    if (hydratedAnalysisRef.current === identity) return;
    hydratedAnalysisRef.current = identity;
    const frame = requestAnimationFrame(() => {
      dispatch({ type: 'reset' });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [reviewIdentity]);

  const isReview = reviewSources.length > 0;
  const reviewRowUnit: ConcordanceReviewRowUnit =
    isReview && showDispersion ? 'documents' : 'matches';
  const reviewFilterIdentity = JSON.stringify({
    viewMode,
    binCount,
    selectedBins: Object.fromEntries(
      Object.entries(selectedBinIndices).map(([key, values]) => [
        key,
        Array.from(values).sort((left, right) => left - right),
      ]),
    ),
    excludedTerms: Object.fromEntries(
      Object.entries(excludedMatchedTexts).map(([key, values]) => [key, Array.from(values).sort()]),
    ),
  });
  useEffect(() => {
    if (!isReview) return;
    dispatch({
      type: 'set-node-pagination',
      value: (current) =>
        Object.fromEntries(
          Object.entries(current).map(([nodeId, value]) => [nodeId, { ...value, currentPage: 1 }]),
        ),
    });
  }, [isReview, reviewFilterIdentity, reviewRowUnit]);
  const effectiveBaseResult = isReview ? null : baseResult;
  const nodeIds = isReview
    ? reviewSources.map((review) => review.source.node_id)
    : effectiveBaseResult
      ? Object.keys(effectiveBaseResult.data).filter(
          (nodeId) => nodeId !== CONCORDANCE_COMBINED_NODE_KEY,
        )
      : [];
  const projections = nodeIds.map((nodeId) => {
    const base = effectiveBaseResult?.data[nodeId];
    const stateForNode = state.nodePagination[nodeId];
    const pageSize = stateForNode?.pageSize ?? state.globalPageSize;
    const query: ConcordanceResultQuery = {
      node_id: nodeId,
      page: viewMode === 'combined' ? combinedPage : (stateForNode?.currentPage ?? 1),
      page_size: pageSize,
      sort_by:
        viewMode === 'combined' || stateForNode?.sortBy === ''
          ? null
          : (stateForNode?.sortBy ?? null),
      descending: viewMode === 'combined' ? false : (stateForNode?.descending ?? false),
    };
    const matchesBase =
      viewMode === 'separated' &&
      base?.pagination.page === query.page &&
      base?.pagination.page_size === query.page_size &&
      (base?.sorting.sort_by ?? null) === (query.sort_by ?? null) &&
      base?.sorting.descending === query.descending;
    const reviewSource = reviewSources.find((review) => review.source.node_id === nodeId) ?? null;
    const filterKey = viewMode === 'combined' ? CONCORDANCE_COMBINED_NODE_KEY : nodeId;
    const excludedTerms = Array.from(excludedMatchedTexts[filterKey] ?? []).sort();
    const selectedBins = Array.from(selectedBinIndices[filterKey] ?? []).sort(
      (left, right) => left - right,
    );
    const documentFilter = {
      excluded_matched_texts: excludedTerms,
      bin_count: selectedBins.length > 0 ? binCount : null,
      selected_bins: selectedBins.length > 0 ? selectedBins : null,
    } as const;
    const pageRequest = createNodeDataRequest({
      page: query.page ?? 1,
      page_size: pageSize,
      sort_by: query.sort_by ?? null,
      descending: query.descending ?? false,
    });
    return {
      nodeId,
      query,
      pageRequest,
      documentFilter,
      reviewSource,
      enabled: isReview
        ? Boolean(workspaceId && reviewSource)
        : Boolean(workspaceId && analysisId && !matchesBase),
    };
  });

  const projectionQueries = useQueries({
    queries: projections.map(({ query, pageRequest, documentFilter, reviewSource, enabled }) => {
      const projection = { kind: 'concordance', ...query } as const;
      // pageRequest already contains the effective global-or-node page size.
      // eslint-disable-next-line @tanstack/query/exhaustive-deps
      return {
        queryKey:
          workspaceId && reviewSource
            ? [
                ...queryKeys.analysisTableProjectionPage(
                  workspaceId,
                  reviewSource.analysisId,
                  reviewSource.source.table.table_id,
                  reviewRowUnit,
                  pageRequest,
                ),
                reviewRowUnit === 'documents' ? documentFilter : null,
              ]
            : workspaceId && analysisId
              ? queryKeys.analysisResult(workspaceId, analysisId, projection)
              : queryKeys.inactiveAnalysisResult(projection),
        enabled,
        queryFn: async (): Promise<ConcordanceAnalysisResponse> => {
          if (workspaceId && reviewSource) {
            const pageNumber = query.page ?? 1;
            const pageSize = query.page_size ?? state.globalPageSize;
            const page =
              reviewRowUnit === 'documents'
                ? await queryConcordanceDocumentProjectionTable({
                    path: {
                      workspace_id: workspaceId,
                      analysis_id: reviewSource.analysisId,
                      table_id: reviewSource.source.table.table_id,
                    },
                    body: {
                      page: pageNumber,
                      page_size: pageSize,
                      sort_by: query.sort_by ?? null,
                      descending: query.descending ?? false,
                      ...documentFilter,
                    },
                  })
                : await fetchArrowTablePage(reviewSource.source.table.matches.rows_url, {
                    page: pageNumber,
                    pageSize,
                    sortBy: query.sort_by ?? null,
                    descending: query.descending ?? false,
                  });
            const result = projectConcordanceRunAllReviewPage(
              reviewSource,
              page,
              pageNumber,
              pageSize,
              query.sort_by ?? null,
              query.descending ?? false,
              reviewRowUnit,
            );
            return {
              kind: 'concordance',
              ready: true,
              sources: null,
              query: null,
              data: { [reviewSource.source.node_id]: result },
              combinable: false,
              metadata: result.metadata,
            };
          }
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
      };
    }),
  });
  const densityQueries = useQueries({
    queries: reviewSources.map((review) => ({
      queryKey: workspaceId
        ? queryKeys.concordanceDensity(workspaceId, review.analysisId, review.source.table.table_id)
        : queryKeys.inactiveAnalysisResult({ density: review.source.table.table_id }),
      enabled: Boolean(workspaceId && isReview && showDispersion),
      staleTime: Number.POSITIVE_INFINITY,
      queryFn: async (): Promise<ConcordanceDensityResult> => {
        if (!workspaceId) throw new Error('Workspace is unavailable');
        const { data } = await getConcordanceTableDensity({
          path: {
            workspace_id: workspaceId,
            analysis_id: review.analysisId,
            table_id: review.source.table.table_id,
          },
          throwOnError: true,
        });
        return data;
      },
    })),
  });
  const reviewDensityByNode: Record<string, ConcordanceDensityResult> = Object.fromEntries(
    reviewSources.flatMap((review, index) => {
      const density = densityQueries[index]?.data;
      return density ? [[review.source.node_id, density] as const] : [];
    }),
  );

  const projectedData = { ...(effectiveBaseResult?.data ?? {}) };
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
  const firstProjection = projectionQueries.find((query) => query.data)?.data;
  const reviewError = isReview
    ? (projectionQueries.find((query) => query.error)?.error ?? null)
    : null;
  const results = isReview
    ? firstProjection
      ? {
          ...firstProjection,
          data: projectedData,
          combinable: reviewSources.length === 2,
        }
      : null
    : effectiveBaseResult
      ? { ...effectiveBaseResult, data: projectedData }
      : null;
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
  return {
    isReview,
    reviewError,
    results,
    nodePagination: state.nodePagination,
    setNodePagination,
    nodeLoading,
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
    reviewDensityByNode,
    resolveNodeIdForKey,
    handleReviewSort: (columnKey: string, paginationKey: string) => {
      if (!isReview) return;
      dispatch({
        type: 'set-node-pagination',
        value: (current) => {
          const previous = current[paginationKey] ?? {
            currentPage: 1,
            pageSize: state.globalPageSize,
            sortBy: undefined,
            descending: false,
          };
          const sameColumn = previous.sortBy === columnKey;
          return {
            ...current,
            [paginationKey]: {
              ...previous,
              currentPage: 1,
              sortBy: columnKey,
              descending: sameColumn ? !previous.descending : false,
            },
          };
        },
      });
    },
    handleReviewPageChange: (newPage: number, paginationKey: string) => {
      if (!isReview) return;
      dispatch({
        type: 'set-node-pagination',
        value: (current) => ({
          ...current,
          [paginationKey]: {
            ...(current[paginationKey] ?? {
              pageSize: state.globalPageSize,
              sortBy: undefined,
              descending: false,
            }),
            currentPage: newPage,
          },
        }),
      });
    },
  };
}
