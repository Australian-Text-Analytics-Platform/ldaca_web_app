import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import {
  type ConcordanceAnalysisRequest,
  type ConcordanceAnalysisResponse,
  type ConcordanceDetachRequest,
  type ConcordanceResultQuery,
  textApi,
} from '../../../../api/text';
import { restoreAnalysisLockFromRequest, extractAndSetTaskId } from '../../common';
import type { NodeColumnSelection, NodePaginationState } from '../../common';

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
  combinedPageSize: number;
  numLeftTokens: number;
  numRightTokens: number;
  regex: boolean;
  caseSensitive: boolean;
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
}

interface ConcordanceLock {
  getAuthHeaders: () => Record<string, string>;
  lockWithSnapshots: (snapshots: Array<{ id: string; name?: string; columns?: string[] }>) => void;
  resolveTaskId: () => Promise<string | null>;
  detachConcordance: (nodeId: string, request: ConcordanceDetachRequest) => Promise<void>;
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
    combinedPageSize,
    numLeftTokens,
    numRightTokens,
    regex,
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
  },
  lock: {
    getAuthHeaders,
    lockWithSnapshots,
    resolveTaskId,
    detachConcordance,
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
      const baseIds = activeNodeIds.slice(0, 2);
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

    const firstNodeId = requestNodeIds[0];
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
      const useStoredResult = forceMode !== undefined || (isLocked && allowWhenLocked);
      let response: ConcordanceAnalysisResponse | null = null;

      if (useStoredResult) {
        const overrides: ConcordanceResultQuery = {
          combined: isCombinedQuery,
          sort_by: (overrideSortBy ?? firstNodePagination.sortBy) || undefined,
          descending: overrideDescending ?? firstNodePagination.descending,
        };

        if (isCombinedQuery) {
          overrides.page = combinedPage;
          overrides.page_size = combinedPageSize;
        } else {
          overrides.page = firstNodePagination.currentPage;
          overrides.page_size = firstNodePagination.pageSize;
        }

        response = await updateStoredResult(overrides as ConcordanceResultQuery);

        if (isCombinedQuery && response && response.combinable === false) {
          setViewMode('separated');
        }
      } else {
        const request: ConcordanceAnalysisRequest = {
          node_ids: requestNodeIds,
          node_columns: nodeColumns,
          search_word: trimmedSearch,
          num_left_tokens: numLeftTokens,
          num_right_tokens: numRightTokens,
          regex,
          case_sensitive: caseSensitive,
        };
        if (isCombinedQuery) {
          request.combined = true;
        }
        const requestedSortBy = overrideSortBy ?? firstNodePagination.sortBy;
        if (requestedSortBy) {
          request.sort_by = requestedSortBy;
        }

        response = await textApi.concordance(request, authHeaders);
        setResults(response);
        extractAndSetTaskId(response, setLocalTaskId);

        try {
          await restoreAnalysisLockFromRequest({
            workspaceId: currentWorkspaceId,
            requestData: { node_ids: requestNodeIds, node_columns: nodeColumns },
            getAuthHeaders,
            lockWithSnapshots,
            maxNodes: 2,
          });
        } catch {
          /* ignore */
        }

        if (response?.combinable === false && viewMode === 'combined') {
          setViewMode('separated');
        }
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

  const persistResultPreferences = async (partial: { pageSize?: number; showMetadata?: boolean }) => {
    if (!currentWorkspaceId) return;

    const preferenceUpdates: Record<string, unknown> = {};
    if (partial.pageSize !== undefined) {
      preferenceUpdates.page_size = partial.pageSize;
    }
    if (partial.showMetadata !== undefined) {
      preferenceUpdates.show_metadata = partial.showMetadata;
    }

    if (Object.keys(preferenceUpdates).length === 0) return;

    try {
      const fetchParams: Record<string, unknown> = { combined: viewMode === 'combined' };
      if (viewMode === 'combined') {
        fetchParams.page = combinedPage;
        fetchParams.page_size = partial.pageSize ?? combinedPageSize;
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

  const handleDetach = async (nodeId: string, column: string, nodeLabel?: string) => {
    if (!currentWorkspaceId || !searchWord.trim()) return;

    setNodeDetaching(prev => ({ ...prev, [nodeId]: true }));
    try {
      const resolvedNodeLabel = (nodeLabel && nodeLabel.trim().length > 0)
        ? nodeLabel
        : nodeId;
      const request = {
        node_id: nodeId,
        column,
        search_word: searchWord.trim(),
        num_left_tokens: numLeftTokens,
        num_right_tokens: numRightTokens,
        regex,
        case_sensitive: caseSensitive,
        new_node_name: buildDetachNodeName(resolvedNodeLabel, '_conc'),
      };
      await detachConcordance(nodeId, request);
    } catch (error) {
      console.error('Error detaching concordance:', error);
      toast.error(`Error detaching concordance: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setNodeDetaching(prev => ({ ...prev, [nodeId]: false }));
    }
  };

  return {
    handleSearch,
    updateStoredResult,
    handleSort,
    handlePageChange,
    persistResultPreferences,
    handleDetach,
  };
}
