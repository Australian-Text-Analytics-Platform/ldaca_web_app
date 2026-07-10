import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { analysisTaskDispersionBins } from '@/api';
import type { ConcordanceAnalysisResponse, ConcordanceDispersionBinRow } from '@/api';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { useSafeResult } from '../../common/useSafeResult';
import { VIZ_PALETTE } from '../../common/vizPalette';
import type { TaggedBinRow } from '../concordanceDispersionDomain';
import {
  buildConcordanceNodeColorMap,
  buildConcordanceSourceColorMap,
  buildMatchedTextColorMap,
  collectConcordanceMatchedTexts,
  getMaterializedBinsForConcordanceKey,
  isConcordanceBlockMaterialized,
  normalizeConcordanceLabelToNodeMap,
  resolveConcordanceNodeIdForKey,
} from '../concordanceSourceDomain';
import type { PaginationState } from './useConcordanceTaskFlow';

interface ConcordanceMaterializeSummary {
  recordCount: number;
  uniqueDocuments: number;
  totalDocuments: number;
}

interface ConcordanceResultSessionState {
  nodePagination: PaginationState;
  nodeLoading: Record<string, boolean>;
  nodeDetaching: Record<string, boolean>;
  nodeMaterializing: Record<string, boolean>;
  materializeTaskIds: Record<string, string>;
  materializeSummaries: Record<string, ConcordanceMaterializeSummary>;
  materializedPaths: Record<string, string>;
  materializedBins: Record<string, ConcordanceDispersionBinRow[]>;
  globalPageSize: number;
}

type ResultSessionAction =
  | { type: 'set-node-pagination'; value: SetStateAction<PaginationState> }
  | { type: 'set-node-loading'; value: SetStateAction<Record<string, boolean>> }
  | { type: 'set-node-detaching'; value: SetStateAction<Record<string, boolean>> }
  | { type: 'set-node-materializing'; value: SetStateAction<Record<string, boolean>> }
  | { type: 'set-materialize-task-ids'; value: SetStateAction<Record<string, string>> }
  | {
      type: 'set-materialize-summaries';
      value: SetStateAction<Record<string, ConcordanceMaterializeSummary>>;
    }
  | { type: 'set-materialized-paths'; value: SetStateAction<Record<string, string>> }
  | {
      type: 'set-materialized-bins';
      value: SetStateAction<Record<string, ConcordanceDispersionBinRow[]>>;
    }
  | { type: 'set-global-page-size'; value: SetStateAction<number> }
  | { type: 'apply-global-page-size'; pageSize: number }
  | { type: 'sync-hydrated-page-size'; pageSize: number }
  | {
      type: 'hydrate-materialization';
      paths: Record<string, string>;
      summaries: Record<string, Record<string, unknown>> | undefined;
    }
  | { type: 'reset' };

const INITIAL_STATE: ConcordanceResultSessionState = {
  nodePagination: {},
  nodeLoading: {},
  nodeDetaching: {},
  nodeMaterializing: {},
  materializeTaskIds: {},
  materializeSummaries: {},
  materializedPaths: {},
  materializedBins: {},
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

const parseCount = (value: unknown): number => {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
};

const parseMaterializeSummaries = (
  summaries: Record<string, Record<string, unknown>> | undefined,
): Record<string, ConcordanceMaterializeSummary> => {
  if (!summaries) return {};
  return Object.fromEntries(
    Object.entries(summaries).map(([nodeId, summary]) => [
      nodeId,
      {
        recordCount: parseCount(summary.record_count),
        uniqueDocuments: parseCount(summary.unique_documents_with_hits),
        totalDocuments: parseCount(summary.total_source_documents),
      },
    ]),
  );
};

/** Owns every state transition that belongs to one displayed Concordance result. */
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
    case 'set-node-materializing':
      return {
        ...state,
        nodeMaterializing: resolveStateAction(state.nodeMaterializing, action.value),
      };
    case 'set-materialize-task-ids':
      return {
        ...state,
        materializeTaskIds: resolveStateAction(state.materializeTaskIds, action.value),
      };
    case 'set-materialize-summaries':
      return {
        ...state,
        materializeSummaries: resolveStateAction(state.materializeSummaries, action.value),
      };
    case 'set-materialized-paths':
      return {
        ...state,
        materializedPaths: resolveStateAction(state.materializedPaths, action.value),
      };
    case 'set-materialized-bins':
      return {
        ...state,
        materializedBins: resolveStateAction(state.materializedBins, action.value),
      };
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
    case 'hydrate-materialization':
      return {
        ...state,
        materializedPaths: action.paths,
        materializedBins: {},
        materializeSummaries: parseMaterializeSummaries(action.summaries),
      };
    case 'reset':
      return INITIAL_STATE;
  }
};

interface UseConcordanceResultSessionOptions {
  workspaceId: string | null;
  selectedNodes: WorkspaceNodeMetadata[];
  showDispersion: boolean;
  proportionalDispersionBars: boolean;
  colourMatches: boolean;
  lowercaseMatches: boolean;
  nodeColorOverrides?: Record<string, string>;
}

/**
 * Owns one Concordance result from the first query payload through pagination,
 * whole-corpus materialization, dispersion-bin fetching, display derivation,
 * and explicit clear. The feature shell supplies search/input state; no other
 * hook owns result identity or result-scoped caches.
 *
 * Used by: `ConcordanceFeature`, materialization lifecycle hooks, task-flow
 * commands, and the result panel.
 */
export function useConcordanceResultSession({
  workspaceId,
  selectedNodes,
  showDispersion,
  proportionalDispersionBars,
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
  const setNodeMaterializing: Dispatch<SetStateAction<Record<string, boolean>>> = useCallback(
    (value) => {
      dispatch({ type: 'set-node-materializing', value });
    },
    [],
  );
  const setMaterializeTaskIds: Dispatch<SetStateAction<Record<string, string>>> = useCallback(
    (value) => {
      dispatch({ type: 'set-materialize-task-ids', value });
    },
    [],
  );
  const setMaterializeSummaries: Dispatch<
    SetStateAction<Record<string, ConcordanceMaterializeSummary>>
  > = useCallback((value) => {
    dispatch({ type: 'set-materialize-summaries', value });
  }, []);
  const setMaterializedPaths: Dispatch<SetStateAction<Record<string, string>>> = useCallback(
    (value) => {
      dispatch({ type: 'set-materialized-paths', value });
    },
    [],
  );
  const setMaterializedBins: Dispatch<
    SetStateAction<Record<string, ConcordanceDispersionBinRow[]>>
  > = useCallback((value) => {
    dispatch({ type: 'set-materialized-bins', value });
  }, []);
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

    const analysisParams = results.analysis_params ?? {};
    const preferenceSource =
      results.preferences ??
      ((analysisParams as Record<string, unknown>).preferences as
        | Record<string, unknown>
        | undefined) ??
      {};
    const firstNodePageSize = Object.values(results.data)[0]?.pagination.page_size;
    const nextPageSize =
      preferenceSource.page_size ?? analysisParams.page_size ?? firstNodePageSize;
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
  const isBlockMaterialised = (nodeKey: string): boolean =>
    isConcordanceBlockMaterialized(nodeKey, {
      selectedNodes,
      labelToNodeId,
      materializedPaths: state.materializedPaths,
    });
  const getMaterializedBinsForKey = (nodeKey: string): TaggedBinRow[] | undefined =>
    getMaterializedBinsForConcordanceKey(nodeKey, {
      selectedNodes,
      labelToNodeId,
      materializedPaths: state.materializedPaths,
      materializedBins: state.materializedBins,
    });

  useEffect(() => {
    if (!showDispersion || proportionalDispersionBars) return;
    const effectiveTaskId = taskId || taskIdRef.current;
    if (!workspaceId || !effectiveTaskId) return;

    const selectedIds = new Set(selectedNodes.map((node) => node.id));
    const missing = Object.keys(state.materializedPaths).filter(
      (nodeId) => selectedIds.has(nodeId) && !(nodeId in state.materializedBins),
    );
    if (missing.length === 0) return;

    const controller = new AbortController();
    void Promise.all(
      missing.map(async (nodeId) => {
        try {
          const { data } = await analysisTaskDispersionBins({
            path: { workspace_id: workspaceId, task_id: effectiveTaskId },
            query: { node_id: nodeId },
            signal: controller.signal,
            throwOnError: true,
          });
          return [nodeId, data.rows] as const;
        } catch (error) {
          if (controller.signal.aborted) return null;
          console.error('Failed to fetch concordance dispersion bins', nodeId, error);
          return null;
        }
      }),
    ).then((entries) => {
      if (controller.signal.aborted) return;
      const successful = entries.filter(
        (entry): entry is readonly [string, ConcordanceDispersionBinRow[]] => entry !== null,
      );
      if (successful.length === 0) return;
      setMaterializedBins((previous) => ({ ...previous, ...Object.fromEntries(successful) }));
    });
    return () => {
      controller.abort();
    };
  }, [
    showDispersion,
    proportionalDispersionBars,
    taskId,
    workspaceId,
    selectedNodes,
    state.materializedPaths,
    state.materializedBins,
    setMaterializedBins,
  ]);

  const allMatchedTexts =
    showDispersion && colourMatches
      ? collectConcordanceMatchedTexts(results?.data, {
          getMaterializedBinsForKey,
          lowercaseMatches,
        })
      : [];
  const matchedTextColorMap = buildMatchedTextColorMap(allMatchedTexts, defaultPalette);

  const applyGlobalPageSize = (pageSize: number) => {
    dispatch({ type: 'apply-global-page-size', pageSize });
  };
  const hydrateMaterialization = (
    paths: Record<string, string>,
    summaries: Record<string, Record<string, unknown>> | undefined,
  ) => {
    dispatch({ type: 'hydrate-materialization', paths, summaries });
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
    nodeMaterializing: state.nodeMaterializing,
    setNodeMaterializing,
    materializeTaskIds: state.materializeTaskIds,
    setMaterializeTaskIds,
    materializeSummaries: state.materializeSummaries,
    setMaterializeSummaries,
    materializedPaths: state.materializedPaths,
    setMaterializedPaths,
    materializedBins: state.materializedBins,
    setMaterializedBins,
    globalPageSize: state.globalPageSize,
    setGlobalPageSize,
    applyGlobalPageSize,
    hydrateMaterialization,
    reset,
    labelToNodeId,
    defaultPalette,
    nodeColors,
    sourceColorMap,
    allMatchedTexts,
    matchedTextColorMap,
    resolveNodeIdForKey,
    isBlockMaterialised,
    getMaterializedBinsForKey,
  };
}
