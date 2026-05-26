import type { Dispatch, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  type ConcordanceAnalysisRequest,
  type ConcordanceAnalysisResponse,
  type ConcordanceDetachRequest,
  type ConcordanceDispersionDetachRequest,
  type ConcordanceMaterializeRequest,
  type ConcordanceResultQuery,
  textApi,
} from '@/lib/backend/text';
import { formatBinIndicesAsRangeLabel } from '../concordanceViewModels';
import { restoreAnalysisLockFromRequest, extractAndSetTaskId } from '../../common';
import type { NodeColumnSelection, NodePaginationState } from '../../common';
import { takeMostRecent } from '@/utils/selectionUtils';

export type PaginationState = Record<string, NodePaginationState>;

interface ConcordanceState {
  currentWorkspaceId: string | null;
  searchWord: string;
  isLocked: boolean;
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
  /**
   * Phase 4.7: selected concordance engine. ``"regex"`` (default) walks
  * raw text; ``"tokens"`` walks the active node's tokenization
   * column for N-actual-token CJK-aware context.
   */
  searchMode: 'regex' | 'tokens';
  /** Phase 4.4: optional language hint for the backend gate / resolver. */
  language?: string;
}

interface ConcordanceActions {
  setNodePagination: Dispatch<SetStateAction<PaginationState>>;
  setViewMode: (mode: 'separated' | 'combined') => void;
  setCombinedPage: (page: number) => void;
  setIsSearching: (value: boolean) => void;
  setResults: (results: ConcordanceAnalysisResponse | null) => void;
  setLocalTaskId: (id: string | null) => void;
  setNodeLoading: Dispatch<SetStateAction<Record<string, boolean>>>;
  setNodeDetaching: Dispatch<SetStateAction<Record<string, boolean>>>;
  setNodeMaterializing?: Dispatch<SetStateAction<Record<string, boolean>>>;
  setMaterializeTaskIds?: Dispatch<SetStateAction<Record<string, string>>>;
}

interface ConcordanceLock {
  getAuthHeaders: () => Record<string, string>;
  lockWithSnapshots: (snapshots: Array<{ id: string; name?: string; columns?: string[] }>) => void;
  resolveTaskId: () => Promise<string | null>;
  detachConcordance: (nodeId: string, request: ConcordanceDetachRequest) => Promise<void>;
  detachConcordanceDispersion: (
    nodeId: string,
    request: ConcordanceDispersionDetachRequest,
  ) => Promise<{ task_id?: string }>;
  materializeConcordance?: (
    nodeId: string,
    request: ConcordanceMaterializeRequest
  ) => Promise<{ metadata?: { task_id?: string } } | undefined>;
  queryClient: QueryClient;
}

type Params = {
  state: ConcordanceState;
  actions: ConcordanceActions;
  lock: ConcordanceLock;
};

export function useConcordanceTaskFlow({
  state: {
    currentWorkspaceId,
    searchWord,
    isLocked,
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
    language,
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
  },
  lock: {
    getAuthHeaders,
    lockWithSnapshots,
    resolveTaskId,
    detachConcordance,
    detachConcordanceDispersion,
    materializeConcordance,
    queryClient,
  },
}: Params) {

  const buildDetachNodeName = (nodeLabel: string, suffix: string) => {
    const trimmed = nodeLabel.trim();
    const base = trimmed.length > 0 ? trimmed : 'node';
    const normalized = base.replace(/\s+/g, '_');
    return `${normalized}${suffix}`;
  };

  const updateStoredResult = async (
    body: ConcordanceResultQuery
  ): Promise<ConcordanceAnalysisResponse | null> => {
    if (!currentWorkspaceId) return null;

    const headers = getAuthHeaders();
    const taskId = await resolveTaskId();
    if (!taskId) return null;
    const response = await textApi.postConcordanceTaskResult(taskId, body, headers) as ConcordanceAnalysisResponse;
    if (response) {
      setResults(response);
    }
    return response;
  };

  const handleSearch = async (
    resetPage = true,
    targetNodeId?: string,
    forceMode?: 'separated' | 'combined',
    overrideSortBy?: string,
    overrideDescending?: boolean,
    allowWhenLocked = false,
  ) => {
    if (!currentWorkspaceId) return;
    if (isLocked && !allowWhenLocked) return;

    const trimmedSearch = searchWord.trim();
    if (!trimmedSearch) {
      toast.error('Please enter a search word.');
      return;
    }

    const requestNodeIds = (() => {
      const baseIds = takeMostRecent(activeNodeIds, 2);
      if (targetNodeId && !baseIds.includes(targetNodeId)) {
        return [...baseIds, targetNodeId];
      }
      return baseIds;
    })();

    if (requestNodeIds.length === 0) return;

    const effectiveSelections = effectiveNodeColumnSelections.filter((sel) =>
      requestNodeIds.includes(sel.nodeId)
    );

    const incompleteSelections = effectiveSelections.filter((sel) => !sel.column);
    if (incompleteSelections.length > 0) {
      toast.error('Please select a text column for all selected data blocks.');
      return;
    }

    const updatedPagination = { ...nodePagination };
    requestNodeIds.forEach((nodeId) => {
      if (!updatedPagination[nodeId]) {
        updatedPagination[nodeId] = {
          currentPage: 1,
          pageSize: globalPageSize,
          sortBy: '',
          descending: false,
        };
      }
      if (resetPage && (!targetNodeId || targetNodeId === nodeId)) {
        updatedPagination[nodeId].currentPage = 1;
      }
    });
    setNodePagination(updatedPagination);

    const shouldForceSeparated = resetPage && !allowWhenLocked && !forceMode;
    const effectiveMode = shouldForceSeparated ? 'separated' : (forceMode || viewMode);
    if (shouldForceSeparated && viewMode !== 'separated') {
      setViewMode('separated');
    }
    if (shouldForceSeparated && combinedPage !== 1) {
      setCombinedPage(1);
    }

    const firstNodeId = requestNodeIds[0]!;
    const firstNodePagination = updatedPagination[firstNodeId];
    if (!firstNodePagination) return;

    const nodeColumns: Record<string, string> = {};
    effectiveSelections.forEach((sel) => {
      nodeColumns[sel.nodeId] = sel.column;
    });

    setIsSearching(true);
    try {
      const authHeaders = getAuthHeaders();
      const isCombinedQuery = effectiveMode === 'combined';
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
      if (language) {
        request.language = language;
      }
      if (isCombinedQuery) {
        request.combined = true;
      }
      const requestedSortBy = overrideSortBy ?? firstNodePagination.sortBy;
      if (requestedSortBy) {
        request.sort_by = requestedSortBy;
      }

      const response = await textApi.concordance(request, authHeaders);
      setResults(response);
      extractAndSetTaskId(response, setLocalTaskId);

      try {
        await restoreAnalysisLockFromRequest({
          workspaceId: currentWorkspaceId,
          requestData: { node_ids: requestNodeIds, node_columns: nodeColumns },
          getAuthHeaders,
          lockWithSnapshots,
          queryClient,
          maxNodes: 2,
        });
      } catch {
        /* ignore */
      }

      if (response?.combinable === false && viewMode === 'combined') {
        setViewMode('separated');
      }
    } catch (error) {
      console.error('Error performing concordance search:', error);
      setResults({
        state: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        data: {},
      } as ConcordanceAnalysisResponse);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSort = (columnName: string, nodeKey: string, requestNodeId?: string) => {
    const currentNodePagination = nodePagination[nodeKey] || {
      currentPage: 1,
      pageSize: globalPageSize,
      sortBy: '',
      descending: false,
    };

    const isSameColumn = currentNodePagination.sortBy === columnName;
    const newDescending = isSameColumn ? !currentNodePagination.descending : false;

    setNodePagination(prev => ({
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
      setNodeLoading(prev => ({ ...prev, [nodeKey]: true }));
      try {
        const overrides: ConcordanceResultQuery = {
          node_id: targetNodeId,
          sort_by: columnName,
          descending: newDescending,
          page: 1,
          page_size: pageSize,
        };
        await updateStoredResult(overrides);
      } finally {
        setNodeLoading(prev => ({ ...prev, [nodeKey]: false }));
      }
    })();
  };

  const handlePageChange = (newPage: number, nodeKey: string, requestNodeId?: string) => {
    const currentNodePagination = nodePagination[nodeKey] || {
      currentPage: 1,
      pageSize: globalPageSize,
      sortBy: '',
      descending: false,
    };

    setNodePagination(prev => ({
      ...prev,
      [nodeKey]: {
        ...currentNodePagination,
        currentPage: newPage,
      },
    }));

    if (!currentWorkspaceId) return;
    const targetNodeId = requestNodeId ?? nodeKey;
    void (async () => {
      setNodeLoading(prev => ({ ...prev, [nodeKey]: true }));
      try {
        const overrides: ConcordanceResultQuery = {
          node_id: targetNodeId,
          page: newPage,
          page_size: currentNodePagination.pageSize,
          sort_by: currentNodePagination.sortBy || undefined,
          descending: currentNodePagination.descending,
        };
        await updateStoredResult(overrides);
      } finally {
        setNodeLoading(prev => ({ ...prev, [nodeKey]: false }));
      }
    })();
  };

  const persistResultPreferences = async (partial: { pageSize?: number }) => {
    if (!currentWorkspaceId) return;

    const preferenceUpdates: Record<string, unknown> = {};
    if (partial.pageSize !== undefined) {
      preferenceUpdates.page_size = partial.pageSize;
    }

    if (Object.keys(preferenceUpdates).length === 0) return;

    try {
      const fetchParams: Record<string, unknown> = { combined: viewMode === 'combined' };
      if (viewMode === 'combined') {
        fetchParams.page = combinedPage;
        fetchParams.page_size = partial.pageSize ?? globalPageSize;
      } else {
        fetchParams.page = 1;
        fetchParams.page_size = partial.pageSize ?? globalPageSize;
      }

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

  const handleDetach = async (nodeId: string, column: string, nodeLabel?: string, selectedColumns?: string[], materializedPath?: string | null) => {
    if (!currentWorkspaceId || !searchWord.trim()) return;

    setNodeDetaching(prev => ({ ...prev, [nodeId]: true }));
    try {
      const resolvedNodeLabel = (nodeLabel && nodeLabel.trim().length > 0)
        ? nodeLabel
        : nodeId;
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
        ...(selectedColumns && selectedColumns.length > 0 ? { selected_columns: selectedColumns } : {}),
        ...(materializedPath ? { materialized_path: materializedPath } : {}),
      };
      await detachConcordance(nodeId, request);
    } catch (error) {
      console.error('Error detaching concordance:', error);
      toast.error(`Error detaching concordance: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setNodeDetaching(prev => ({ ...prev, [nodeId]: false }));
    }
  };

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
    setNodeDetaching(prev => ({ ...prev, [nodeId]: true }));
    try {
      const resolvedLabel = (options.nodeLabel && options.nodeLabel.trim().length > 0)
        ? options.nodeLabel
        : nodeId;
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
      // Resolve parent_task_id so the worker can publish the
      // `analysis_materialized` event for the slow path's side-effect.
      // Best-effort: if the lock has no task id yet, we skip it and
      // accept that the user might need to materialise again later.
      let parentTaskId: string | null = null;
      try {
        parentTaskId = await resolveTaskId();
      } catch (resolveErr) {
        console.warn('Failed to resolve concordance task id for dispersion detach:', resolveErr);
      }
      const request: ConcordanceDispersionDetachRequest = {
        column,
        search_word: searchWord.trim(),
        num_left_tokens: numLeftTokens,
        num_right_tokens: numRightTokens,
        regex,
        whole_word: wholeWord,
        case_sensitive: caseSensitive,
        new_node_name: buildDetachNodeName(resolvedLabel, suffix),
        ...(options.selectedColumns && options.selectedColumns.length > 0
          ? { selected_columns: options.selectedColumns }
          : {}),
        ...(parentTaskId ? { parent_task_id: parentTaskId } : {}),
        ...(options.materializedPath ? { materialized_path: options.materializedPath } : {}),
        ...(selectedBinsArr ? { selected_bins: selectedBinsArr, total_bins: options.binCount } : {}),
        ...(options.selectedMatchedTexts != null
          ? {
              selected_matched_texts: options.selectedMatchedTexts,
              match_case_insensitive: !!options.matchCaseInsensitive,
            }
          : {}),
      };
      await detachConcordanceDispersion(nodeId, request);
      toast.success('Aggregated detach started.');
    } catch (error) {
      console.error('Error detaching aggregated concordance:', error);
      toast.error(
        `Error detaching aggregated concordance: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      setNodeDetaching(prev => ({ ...prev, [nodeId]: false }));
    }
  };

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

    setNodeMaterializing?.(prev => ({ ...prev, [nodeId]: true }));
    try {
      const request: ConcordanceMaterializeRequest = {
        parent_task_id: parentTaskId,
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
      if (language) {
        request.language = language;
      }
      const resp = await materializeConcordance(nodeId, request);
      const taskId = (resp as { metadata?: { task_id?: string } } | undefined)?.metadata?.task_id;
      if (taskId && setMaterializeTaskIds) {
        setMaterializeTaskIds(prev => ({ ...prev, [nodeId]: taskId }));
      }
      toast.success('Materialize started.');
    } catch (error) {
      console.error('Error materializing concordance:', error);
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(`Error materializing concordance: ${msg}`);
      setNodeMaterializing?.(prev => ({ ...prev, [nodeId]: false }));
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
