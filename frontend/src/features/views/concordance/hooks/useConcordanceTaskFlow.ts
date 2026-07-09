import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import { analysisTaskResultQuery, runConcordance } from '@/api';
import {
  type ConcordanceAnalysisRequest,
  type ConcordanceAnalysisResponse,
  type ConcordanceDetachRequest,
  type ConcordanceDispersionDetachRequest,
  type ConcordanceMaterializeRequest,
  type ConcordanceResultQuery,
  type AnalysisTaskActionResponse,
} from '@/api';
import { formatBinIndicesAsRangeLabel } from '../concordanceViewModels';
import { extractAndSetTaskId } from '../../common';
import type { NodeColumnSelection, NodePaginationState } from '../../common';

export type PaginationState = Record<string, NodePaginationState>;

interface ConcordanceState {
  currentWorkspaceId: string | null;
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
  setViewMode: (mode: 'separated' | 'combined') => void;
  setCombinedPage: (page: number) => void;
  setIsSearching: (value: boolean) => void;
  setResults: Dispatch<SetStateAction<ConcordanceAnalysisResponse | null>>;
  setLocalTaskId: (id: string | null) => void;
  setNodeLoading: Dispatch<SetStateAction<Record<string, boolean>>>;
  setNodeDetaching: Dispatch<SetStateAction<Record<string, boolean>>>;
  setNodeMaterializing?: Dispatch<SetStateAction<Record<string, boolean>>>;
  setMaterializeTaskIds?: Dispatch<SetStateAction<Record<string, string>>>;
  /**
   * Notifies the owner (analysis tab wrapper) of the task id assigned by a run
   * (or null when none). The wrapper persists it onto the tab record so the tab
   * rehydrates the same task after reload. Optional for non-tabbed callers.
   */
  onTaskIdAssigned?: (taskId: string | null) => void;
}

interface ConcordanceLock {
  getAuthHeaders: () => Record<string, string>;
  resolveTaskId: () => Promise<string | null>;
  detachConcordance: (
    taskId: string,
    request: ConcordanceDetachRequest,
  ) => Promise<AnalysisTaskActionResponse>;
  detachConcordanceDispersion: (
    taskId: string,
    request: ConcordanceDispersionDetachRequest,
  ) => Promise<{ task_id?: string }>;
  materializeConcordance?: (
    taskId: string,
    request: ConcordanceMaterializeRequest,
  ) => Promise<{ metadata?: { task_id?: string | null } | null } | undefined>;
}

interface Params {
  state: ConcordanceState;
  actions: ConcordanceActions;
  lock: ConcordanceLock;
}

/** Centralizes concordance submit, pagination, sorting, detach, and materialize actions. */
/**
 * Used by: ConcordanceFeature.tsx, concordanceViewModels.ts, ConcordanceFeature.test.tsx, and related files because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
 * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
 */
export function useConcordanceTaskFlow({
  state: {
    currentWorkspaceId,
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
    setViewMode,
    setCombinedPage,
    setIsSearching,
    setResults,
    setLocalTaskId,
    setNodeLoading,
    setNodeDetaching,
    setNodeMaterializing,
    setMaterializeTaskIds,
    onTaskIdAssigned,
  },
  lock: {
    getAuthHeaders,
    resolveTaskId,
    detachConcordance,
    detachConcordanceDispersion,
    materializeConcordance,
  },
}: Params) {
  /** Builds stable derived node names for workspace outputs created by concordance actions. */
  /**
   * Called by: useConcordanceTaskFlow as a local helper in this analysis workflow because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   */
  const buildDetachNodeName = (nodeLabel: string, suffix: string) => {
    const trimmed = nodeLabel.trim();
    const base = trimmed.length > 0 ? trimmed : 'node';
    const normalized = base.replace(/\s+/g, '_');
    return `${normalized}${suffix}`;
  };

  /** Refetches the stored concordance task result after preference or page changes. */
  /**
   * Called by: useConcordanceTaskFlow during this analysis workflow because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
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

    const headers = getAuthHeaders();
    const taskId = await resolveTaskId();
    if (!taskId) return null;
    const { data } = await analysisTaskResultQuery({
      body,
      headers,
      path: { workspace_id: currentWorkspaceId, task_id: taskId },
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
   * Called by: useConcordanceTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
   */
  const handleSearch = async (
    resetPage = true,
    targetNodeId?: string,
    forceMode?: 'separated' | 'combined',
    overrideSortBy?: string,
    _overrideDescending?: boolean,
    allowWhenLocked = false,
  ) => {
    if (!currentWorkspaceId) return;

    const trimmedSearch = searchWord.trim();
    if (!trimmedSearch) {
      toast.error('Please enter a search word.');
      return;
    }

    const requestNodeIds = (() => {
      const baseIds = activeNodeIds.slice(0, 2);
      if (targetNodeId && !baseIds.includes(targetNodeId)) {
        return [...baseIds, targetNodeId];
      }
      return baseIds;
    })();

    if (requestNodeIds.length === 0) return;

    const effectiveSelections = effectiveNodeColumnSelections.filter((sel) =>
      requestNodeIds.includes(sel.nodeId),
    );

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
      if (resetPage && (!targetNodeId || targetNodeId === nodeId)) {
        updatedPagination[nodeId].currentPage = 1;
      }
    });
    setNodePagination(updatedPagination);

    const shouldForceSeparated = resetPage && !allowWhenLocked && !forceMode;
    if (shouldForceSeparated && viewMode !== 'separated') {
      setViewMode('separated');
    }
    if (shouldForceSeparated && combinedPage !== 1) {
      setCombinedPage(1);
    }

    const firstNodeId = requestNodeIds[0];
    if (firstNodeId === undefined) return;
    const firstNodePagination = updatedPagination[firstNodeId];
    if (!firstNodePagination) return;

    const nodeColumns: Record<string, string> = {};
    effectiveSelections.forEach((sel) => {
      nodeColumns[sel.nodeId] = sel.column;
    });

    setIsSearching(true);
    try {
      const authHeaders = getAuthHeaders();
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
      const requestedSortBy = overrideSortBy ?? firstNodePagination.sortBy;
      if (requestedSortBy) {
        request.sort_by = requestedSortBy;
      }

      const { data: response } = await runConcordance({
        body: request,
        headers: authHeaders,
        path: { workspace_id: currentWorkspaceId },
        throwOnError: true,
      });
      setResults(response);
      const assignedTaskId = extractAndSetTaskId(response, setLocalTaskId);
      onTaskIdAssigned?.(assignedTaskId);

      if (response.combinable === false && viewMode === 'combined') {
        setViewMode('separated');
      }
    } catch (error) {
      console.error('Error performing concordance search:', error);
      setResults({
        state: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        data: {},
      });
    } finally {
      setIsSearching(false);
    }
  };

  /** Applies a column sort for a node block and refetches that result page. */
  /**
   * Called by: useConcordanceTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
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
   * Called by: useConcordanceTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
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
   * Called by: useConcordanceTaskFlow during this analysis workflow because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
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
   * Called by: useConcordanceTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   * Flow: require workspace and search text, build a concordance detach request with context/window/search options and explicit columns/path, then clear node detaching state.
   */
  const handleDetach = async (
    nodeId: string,
    column: string,
    nodeLabel?: string,
    selectedColumns?: string[],
    materializedPath?: string | null,
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
      const request: ConcordanceDetachRequest = {
        node_id: nodeId,
        column,
        search_word: searchWord.trim(),
        num_left_tokens: numLeftTokens,
        num_right_tokens: numRightTokens,
        regex,
        whole_word: wholeWord,
        case_sensitive: caseSensitive,
        new_node_name: buildDetachNodeName(resolvedNodeLabel, '_conc'),
        selected_columns: explicitSelectedColumns,
        ...(materializedPath ? { materialized_path: materializedPath } : {}),
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
   * Called by: useConcordanceTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
   */
  const handleDispersionDetach = async (
    nodeId: string,
    column: string,
    options: {
      nodeLabel?: string;
      materializedPath?: string | null;
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
      const request: ConcordanceDispersionDetachRequest = {
        node_id: nodeId,
        column,
        search_word: searchWord.trim(),
        num_left_tokens: numLeftTokens,
        num_right_tokens: numRightTokens,
        regex,
        whole_word: wholeWord,
        case_sensitive: caseSensitive,
        new_node_name: buildDetachNodeName(resolvedLabel, suffix),
        selected_columns: explicitSelectedColumns,
        ...(options.materializedPath ? { materialized_path: options.materializedPath } : {}),
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

  /** Starts the backend materialization task that caches all concordance hits for a node. */
  /**
   * Called by: useConcordanceTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
   */
  const handleMaterialize = async (nodeId: string, column: string) => {
    if (!currentWorkspaceId || !searchWord.trim()) {
      toast.error('Run a concordance search first.');
      return;
    }
    if (!materializeConcordance) return;

    const parentTaskId = await resolveTaskId();
    if (!parentTaskId) {
      toast.error('No concordance task to materialize.');
      return;
    }

    setNodeMaterializing?.((prev) => ({ ...prev, [nodeId]: true }));
    try {
      const request: ConcordanceMaterializeRequest = {
        node_id: nodeId,
        column,
        search_word: searchWord.trim(),
        num_left_tokens: numLeftTokens,
        num_right_tokens: numRightTokens,
        regex,
        whole_word: wholeWord,
        case_sensitive: caseSensitive,
        // Must match the live search engine — otherwise materialise runs
        // the regex flow over raw text and silently drops tokens-mode hits.
        search_mode: searchMode,
      };
      const resp = await materializeConcordance(parentTaskId, request);
      const taskId = (resp as { metadata?: { task_id?: string } } | undefined)?.metadata?.task_id;
      if (taskId && setMaterializeTaskIds) {
        setMaterializeTaskIds((prev) => ({ ...prev, [nodeId]: taskId }));
      }
      toast.success('Materialize started.');
    } catch (error) {
      console.error('Error materializing concordance:', error);
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(`Error materializing concordance: ${msg}`);
      setNodeMaterializing?.((prev) => ({ ...prev, [nodeId]: false }));
    }
  };

  return {
    handleSearch,
    updateStoredResult,
    handleSort,
    handlePageChange,
    persistResultPreferences,
    handleDetach,
    handleDispersionDetach,
    handleMaterialize,
  };
}
