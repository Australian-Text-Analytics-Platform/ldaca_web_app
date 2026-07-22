import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import { submitTabAnalysis } from '@/api';
import {
  type ConcordanceAnalysisRequest,
  type ConcordanceDetachmentAnalysisRequest,
  type ConcordanceDispersionDetachmentAnalysisRequest,
  type Analysis,
} from '@/api';
import { formatBinIndicesAsRangeLabel } from '../concordanceDispersionDomain';
import type { NodeColumnSelection } from '../../common/nodeSelectionTypes';
import { runAnalysisTaskEnvelope } from '../../common/tasks/runAnalysisTaskEnvelope';
import type { NodePaginationState } from '../../common/tasks/types';

export type PaginationState = Record<string, NodePaginationState>;

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
  setLocalTaskId: (id: string | null) => void;
  runningRef: { current: boolean };
  lastFetchedRef: { current: { taskId: string | null; state: string | null } };
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
 * Flow: submit concordance requests, update local page controls, and expose
 * child-analysis detach commands. TanStack Query owns every result page.
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
    setLocalTaskId,
    runningRef,
    lastFetchedRef,
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

  /** Starts a fresh concordance analysis or targeted update while preserving the analysis lock. */
  /**
   * Returned to `ConcordanceFeature` by `useConcordanceTaskFlow`.
   * Flow: validate search text and node columns, reset relevant pagination,
   * run the analysis, record the assigned task id, and publish result/error state.
   */
  const handleSearch = async () => {
    if (!currentWorkspaceId) return;

    const trimmedSearch = searchWord.trim();
    if (!trimmedSearch) {
      toast.error('Please enter a search word.');
      return;
    }

    const requestNodeIds = activeNodeIds.slice(0, 2);

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
      resetBeforeRun: () => undefined,
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

  /** Applies a column sort for a node block; the keyed Query fetches the page. */
  /**
   * Returned to `ConcordanceFeature` by `useConcordanceTaskFlow`.
   * Flow: toggle the selected column's direction and reset that node to page one.
   */
  const handleSort = (columnName: string, nodeKey: string, _requestNodeId?: string) => {
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
  };

  /** Moves a node block to a new source page; the keyed Query fetches it. */
  /**
   * Returned to `ConcordanceFeature` by `useConcordanceTaskFlow`.
   * Flow: read current node pagination and update the target page locally.
   */
  const handlePageChange = (newPage: number, nodeKey: string, _requestNodeId?: string) => {
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
  };

  /** Applies a page-size preference to all local result projections. */
  /**
   * Called when the shared page-size control changes. Result presentation
   * controls are device-local and are not written into the immutable Analysis.
   */
  const persistResultPreferences = (partial: { pageSize?: number }) => {
    if (!currentWorkspaceId || partial.pageSize === undefined) return;
    const pageSize = partial.pageSize;
    setNodePagination((previous) =>
      Object.fromEntries(
        Object.entries(previous).map(([nodeId, value]) => [
          nodeId,
          {
            ...value,
            currentPage: viewMode === 'combined' ? combinedPage : 1,
            pageSize,
          },
        ]),
      ),
    );
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
    handleSort,
    handlePageChange,
    persistResultPreferences,
    handleDetach,
    handleDispersionDetach,
  };
}
