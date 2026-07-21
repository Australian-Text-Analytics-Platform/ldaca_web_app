import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import { queryAnalysisResult, submitTabAnalysis } from '@/api';
import {
  type ConcordanceAnalysisRequest,
  type ConcordanceAnalysisResponse,
  type ConcordanceDetachmentAnalysisRequest,
  type ConcordanceDispersionDetachmentAnalysisRequest,
  type ConcordanceResultQuery,
  type Analysis,
} from '@/api';
import { formatBinIndicesAsRangeLabel } from '../concordanceDispersionDomain';
import type { NodeColumnSelection } from '../../common/nodeSelectionTypes';
import { runAnalysisTaskEnvelope } from '../../common/tasks/runAnalysisTaskEnvelope';
import type { NodePaginationState } from '../../common/tasks/types';

export type PaginationState = Record<string, NodePaginationState>;

/** Runnable token-handoff snapshot used by the pending-handoff hook and direct submission path to bypass not-yet-rendered form state. */
export interface ConcordanceHandoffSearchRequest {
  searchWord: string;
  nodeIds: string[];
  nodeColumnSelections: NodeColumnSelection[];
}

interface ConcordanceState {
  currentWorkspaceId: string | null;
  tabId: string;
  searchWord: string;
  activeNodeIds: string[];
  effectiveNodeColumnSelections: NodeColumnSelection[];
  globalPageSize: number;
  nodePagination: PaginationState;
  viewMode: 'separated' | 'combined';
  combinedPage: number;
  numLeftTokens: number;
  numRightTokens: number;
  regex: boolean;
  wholeWord: boolean;
  caseSensitive: boolean;
  /** Selected concordance engine. */
  searchMode: 'regex' | 'tokens';
}

interface ConcordanceActions {
  setNodePagination: Dispatch<SetStateAction<PaginationState>>;
  setIsSearching: (value: boolean) => void;
  setResults: Dispatch<SetStateAction<ConcordanceAnalysisResponse | null>>;
  setLocalTaskId: (id: string | null) => void;
  runningRef: { current: boolean };
  lastFetchedRef: { current: { taskId: string | null; state: string | null } };
  setNodeLoading: Dispatch<SetStateAction<Record<string, boolean>>>;
  setNodeDetaching: Dispatch<SetStateAction<Record<string, boolean>>>;
  /**
   * Notifies AnalysisTabsHost of the task id assigned by a run (or null when
   * none). The host persists it onto the tab record so the tab
   * rehydrates the same task after reload. Optional for non-tabbed callers.
   */
  onTaskIdAssigned: (taskId: string | null) => void;
}

interface ConcordanceLock {
  resolveTaskId: () => Promise<string | null>;
  detachConcordance: (
    taskId: string,
    request: Omit<ConcordanceDetachmentAnalysisRequest, 'kind'>,
  ) => Promise<Analysis>;
  detachConcordanceDispersion: (
    taskId: string,
    request: Omit<ConcordanceDispersionDetachmentAnalysisRequest, 'kind'>,
  ) => Promise<Analysis>;
}

interface Params {
  state: ConcordanceState;
  actions: ConcordanceActions;
  lock: ConcordanceLock;
}

/** Centralizes concordance submit, pagination, sorting, detach, and materialize actions. */
/**
 * Used by: `ConcordanceFeature`; its feature test mocks this hook boundary.
 * Flow: submit concordance requests, refetch stored results after paging/sort
 * changes, persist result preferences, and expose detach/materialize actions.
 */
export function useConcordanceTaskFlow({
  state: {
    currentWorkspaceId,
    tabId,
    searchWord,
    activeNodeIds,
    effectiveNodeColumnSelections,
    globalPageSize,
    nodePagination,
    viewMode,
    combinedPage,
    numLeftTokens,
    numRightTokens,
    regex,
    wholeWord,
    searchMode,
    caseSensitive,
  },
  actions: {
    setNodePagination,
    setIsSearching,
    setResults,
    setLocalTaskId,
    runningRef,
    lastFetchedRef,
    setNodeLoading,
    setNodeDetaching,
    onTaskIdAssigned,
  },
  lock: { resolveTaskId, detachConcordance, detachConcordanceDispersion },
}: Params) {
  /** Builds stable derived node names for workspace outputs created by concordance actions. */
  /**
   * Called by per-hit and dispersion detach request builders.
   */
  const buildDetachNodeName = (nodeLabel: string, suffix: string) => {
    const trimmed = nodeLabel.trim();
    const base = trimmed.length > 0 ? trimmed : 'node';
    const normalized = base.replace(/\s+/g, '_');
    return `${normalized}${suffix}`;
  };

  /** Refetches the stored concordance task result after preference or page changes. */
  /**
   * Called by sort/page/preference handlers and returned for view-mode swaps.
   *
   * When ``mergeNodeData`` is set, the response is treated as a partial,
   * single-node update (separated view per-node page/sort): only the returned
   * node slices overwrite their entries in the existing results, so the sibling
   * table keeps its independently-paged data. Otherwise the whole result object
   * is replaced (fresh search, global page-size change, combined view).
   */
  const updateStoredResult = async (
    body: ConcordanceResultQuery,
    options?: { mergeNodeData?: boolean },
  ): Promise<ConcordanceAnalysisResponse | null> => {
    if (!currentWorkspaceId) return null;

    const taskId = await resolveTaskId();
    if (!taskId) return null;
    const { data } = await queryAnalysisResult({
      body: { kind: 'concordance', ...body },
      path: { workspace_id: currentWorkspaceId, analysis_id: taskId },
      throwOnError: true,
    });
    const response = data as ConcordanceAnalysisResponse | null;
    if (response) {
      if (options?.mergeNodeData) {
        setResults((prev) =>
          prev?.data
            ? {
                ...response,
                data: { ...prev.data, ...response.data },
              }
            : response,
        );
      } else {
        setResults(response);
      }
    }
    return response;
  };

  /** Starts a fresh concordance analysis or targeted update while preserving the analysis lock. */
  /**
   * Returned to `ConcordanceFeature` by `useConcordanceTaskFlow`.
   * Flow: validate search text and node columns, reset relevant pagination,
   * run the analysis, record the assigned task id, and publish result/error state.
   */
  const handleSearch = async (handoffRequest?: ConcordanceHandoffSearchRequest) => {
    if (!currentWorkspaceId) return;

    const trimmedSearch = (handoffRequest?.searchWord ?? searchWord).trim();
    if (!trimmedSearch) {
      toast.error('Please enter a search word.');
      return;
    }

    const requestNodeIds = (handoffRequest?.nodeIds ?? activeNodeIds).slice(0, 2);

    if (requestNodeIds.length === 0) return;

    const effectiveSelections = (
      handoffRequest?.nodeColumnSelections ?? effectiveNodeColumnSelections
    ).filter((sel) => requestNodeIds.includes(sel.nodeId));

    const incompleteSelections = effectiveSelections.filter((sel) => !sel.column);
    if (incompleteSelections.length > 0) {
      toast.error('Please select a text column for all selected data blocks.');
      return;
    }

    const updatedPagination = { ...nodePagination };
    requestNodeIds.forEach((nodeId) => {
      updatedPagination[nodeId] ??= {
        currentPage: 1,
        pageSize: globalPageSize,
        sortBy: '',
        descending: false,
      };
      updatedPagination[nodeId].currentPage = 1;
    });
    setNodePagination(updatedPagination);

    const nodeColumns: Record<string, string> = {};
    effectiveSelections.forEach((sel) => {
      nodeColumns[sel.nodeId] = sel.column;
    });

    const request: ConcordanceAnalysisRequest = {
      node_ids: requestNodeIds,
      node_columns: nodeColumns,
      search_word: trimmedSearch,
      num_left_tokens: numLeftTokens,
      num_right_tokens: numRightTokens,
      regex,
      whole_word: wholeWord,
      case_sensitive: caseSensitive,
      search_mode: searchMode,
    };
    await runAnalysisTaskEnvelope<Analysis>({
      lastFetchedRef,
      runningRef,
      setIsRunning: setIsSearching,
      setLocalTaskId,
      onTaskIdAssigned,
      resetBeforeRun: () => {
        setResults(null);
      },
      submit: async () => {
        const { data } = await submitTabAnalysis({
          body: { kind: 'concordance', ...request },
          path: { workspace_id: currentWorkspaceId, tab_id: tabId },
          throwOnError: true,
        });
        return data;
      },
      onSuccess: () => undefined,
      onError: (error) => {
        console.error('Error performing concordance search:', error);
      },
    });
  };

  /** Used by ConcordanceFeature to run a token-frequency handoff from its immutable input snapshot. */
  const handleHandoffSearch = (request: ConcordanceHandoffSearchRequest) => handleSearch(request);

  /** Applies a column sort for a node block and refetches that result page. */
  /**
   * Returned to `ConcordanceFeature` by `useConcordanceTaskFlow`.
   * Flow: toggle the selected column's direction, reset that node to page one,
   * and merge its refetched slice without disturbing sibling node pages.
   */
  const handleSort = (columnName: string, nodeKey: string, requestNodeId?: string) => {
    const currentNodePagination = nodePagination[nodeKey] ?? {
      currentPage: 1,
      pageSize: globalPageSize,
      sortBy: '',
      descending: false,
    };

    const isSameColumn = currentNodePagination.sortBy === columnName;
    const newDescending = isSameColumn ? !currentNodePagination.descending : false;

    setNodePagination((prev) => ({
      ...prev,
      [nodeKey]: {
        ...currentNodePagination,
        currentPage: 1,
        sortBy: columnName,
        descending: newDescending,
      },
    }));

    const pageSize = currentNodePagination.pageSize;
    if (!currentWorkspaceId) return;
    const targetNodeId = requestNodeId ?? nodeKey;
    void (async () => {
      setNodeLoading((prev) => ({ ...prev, [nodeKey]: true }));
      try {
        const overrides: ConcordanceResultQuery = {
          node_id: targetNodeId,
          sort_by: columnName,
          descending: newDescending,
          page: 1,
          page_size: pageSize,
        };
        await updateStoredResult(overrides, { mergeNodeData: true });
      } finally {
        setNodeLoading((prev) => ({ ...prev, [nodeKey]: false }));
      }
    })();
  };

  /** Moves a node block to a new source page and refreshes the persisted result. */
  /**
   * Returned to `ConcordanceFeature` by `useConcordanceTaskFlow`.
   * Flow: read current node pagination, update the target page locally, then refetch stored results with page/sort overrides while toggling node loading.
   */
  const handlePageChange = (newPage: number, nodeKey: string, requestNodeId?: string) => {
    const currentNodePagination = nodePagination[nodeKey] ?? {
      currentPage: 1,
      pageSize: globalPageSize,
      sortBy: '',
      descending: false,
    };

    setNodePagination((prev) => ({
      ...prev,
      [nodeKey]: {
        ...currentNodePagination,
        currentPage: newPage,
      },
    }));

    if (!currentWorkspaceId) return;
    const targetNodeId = requestNodeId ?? nodeKey;
    void (async () => {
      setNodeLoading((prev) => ({ ...prev, [nodeKey]: true }));
      try {
        const overrides: ConcordanceResultQuery = {
          node_id: targetNodeId,
          page: newPage,
          page_size: currentNodePagination.pageSize,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty-string sortBy means "no sort" and must collapse to undefined
          sort_by: currentNodePagination.sortBy || undefined,
          descending: currentNodePagination.descending,
        };
        await updateStoredResult(overrides, { mergeNodeData: true });
      } finally {
        setNodeLoading((prev) => ({ ...prev, [nodeKey]: false }));
      }
    })();
  };

  /** Persists result display preferences so refetches keep the current user-facing shape. */
  /**
   * Called by request and task handlers in `useConcordanceTaskFlow`.
   * Flow: build page-size preference updates, merge view-mode fetch params, call updateStoredResult, then surface failures to the caller.
   */
  const persistResultPreferences = async (partial: { pageSize?: number }) => {
    if (!currentWorkspaceId) return;

    const preferenceUpdates: Record<string, unknown> = {};
    if (partial.pageSize !== undefined) {
      preferenceUpdates.page_size = partial.pageSize;
    }

    if (Object.keys(preferenceUpdates).length === 0) return;

    try {
      // Combined view is synthesized client-side, so this only persists the
      // per-node page-size preference. In combined mode the swap hook's
      // page/page-size effect rebuilds the __COMBINED__ block afterwards.
      const fetchParams: Record<string, unknown> = {
        page: viewMode === 'combined' ? combinedPage : 1,
        page_size: partial.pageSize ?? globalPageSize,
      };

      const mergedBody = {
        ...preferenceUpdates,
        ...fetchParams,
        update_only: false,
      } as ConcordanceResultQuery;

      return await updateStoredResult(mergedBody);
    } catch (error) {
      console.error('Failed to persist concordance preferences', error);
      throw error;
    }
  };

  /** Requests a per-hit concordance workspace node for the selected source block. */
  /**
   * Returned to `ConcordanceFeature` by `useConcordanceTaskFlow`.
   * Flow: require workspace and search text, build a concordance detach request with context/window/search options and explicit columns/path, then clear node detaching state.
   */
  const handleDetach = async (
    nodeId: string,
    _column: string,
    nodeLabel?: string,
    selectedColumns?: string[],
  ) => {
    if (!currentWorkspaceId || !searchWord.trim()) return;

    setNodeDetaching((prev) => ({ ...prev, [nodeId]: true }));
    try {
      const explicitSelectedColumns = selectedColumns ?? [];
      if (explicitSelectedColumns.length === 0) {
        toast.error('Select at least one column to add to workspace.');
        return;
      }
      const parentTaskId = await resolveTaskId();
      if (!parentTaskId) {
        toast.error('No concordance task to detach.');
        return;
      }
      const resolvedNodeLabel = nodeLabel && nodeLabel.trim().length > 0 ? nodeLabel : nodeId;
      const request: Omit<ConcordanceDetachmentAnalysisRequest, 'kind'> = {
        node_id: nodeId,
        name: buildDetachNodeName(resolvedNodeLabel, '_conc'),
        selected_columns: explicitSelectedColumns,
      };
      await detachConcordance(parentTaskId, request);
    } catch (error) {
      console.error('Error detaching concordance:', error);
      toast.error(
        `Error detaching concordance: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      setNodeDetaching((prev) => ({ ...prev, [nodeId]: false }));
    }
  };

  /** Requests a per-document aggregated workspace node from the dispersion view. */
  /**
   * Returned to `ConcordanceFeature` by `useConcordanceTaskFlow`.
   * Flow: validate selected columns, resolve the parent task, translate active
   * bin/legend filters into the detach request, and start the aggregate task.
   */
  const handleDispersionDetach = async (
    nodeId: string,
    _column: string,
    options: {
      nodeLabel?: string;
      selectedBins?: ReadonlySet<number> | null;
      binCount: number;
      selectedColumns?: string[];
      /**
       * Legend-filter projection. Pass the visible-on-legend matched-text
       * set (as displayed, i.e. already lowercased when
       * `matchCaseInsensitive` is true) to restrict the aggregation. Pass
       * `null`/omit for "all matches".
       */
      selectedMatchedTexts?: string[] | null;
      matchCaseInsensitive?: boolean;
    },
  ) => {
    if (!currentWorkspaceId || !searchWord.trim()) return;
    setNodeDetaching((prev) => ({ ...prev, [nodeId]: true }));
    try {
      const explicitSelectedColumns = options.selectedColumns ?? [];
      if (explicitSelectedColumns.length === 0) {
        toast.error('Select at least one column to add to workspace.');
        return;
      }
      const resolvedLabel =
        options.nodeLabel && options.nodeLabel.trim().length > 0 ? options.nodeLabel : nodeId;
      const selectedBinsArr =
        options.selectedBins && options.selectedBins.size > 0
          ? Array.from(options.selectedBins).sort((a, b) => a - b)
          : null;
      const rangeLabel = selectedBinsArr
        ? formatBinIndicesAsRangeLabel(selectedBinsArr, options.binCount)
        : '';
      // Naming convention (per design): `_conc_aggregated` differentiates from
      // the per-hit `_conc` detach, and the range suffix carries the bin
      // filter context for future reference (the workspace can otherwise lose
      // track of which dispersion-detach was scoped to which bins).
      const suffix = rangeLabel ? `_conc_aggregated_${rangeLabel}` : '_conc_aggregated';
      const parentTaskId = await resolveTaskId();
      if (!parentTaskId) {
        toast.error('No concordance task to detach.');
        return;
      }
      const request: Omit<ConcordanceDispersionDetachmentAnalysisRequest, 'kind'> = {
        node_id: nodeId,
        name: buildDetachNodeName(resolvedLabel, suffix),
        selected_columns: explicitSelectedColumns,
        ...(selectedBinsArr
          ? { selected_bins: selectedBinsArr, total_bins: options.binCount }
          : {}),
        ...(options.selectedMatchedTexts != null
          ? {
              selected_matched_texts: options.selectedMatchedTexts,
              match_case_insensitive: !!options.matchCaseInsensitive,
            }
          : {}),
      };
      await detachConcordanceDispersion(parentTaskId, request);
      toast.success('Aggregated detach started.');
    } catch (error) {
      console.error('Error detaching aggregated concordance:', error);
      toast.error(
        `Error detaching aggregated concordance: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      setNodeDetaching((prev) => ({ ...prev, [nodeId]: false }));
    }
  };

  return {
    handleSearch,
    handleHandoffSearch,
    updateStoredResult,
    handleSort,
    handlePageChange,
    persistResultPreferences,
    handleDetach,
    handleDispersionDetach,
  };
}
