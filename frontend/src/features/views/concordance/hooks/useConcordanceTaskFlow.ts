import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import { submitTabAnalysis } from '@/api';
import { type ConcordanceAnalysisRequest, type Analysis } from '@/api';
import type { RunAnalysis } from '../../common/hooks/useAnalysisFeature';
import type { NodeColumnSelection } from '../../common/nodeSelectionTypes';
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
  ignorePunctuation: boolean;
  /** Selected concordance engine. */
  searchMode: 'regex' | 'tokens';
  tokenizerModelsByNode: Record<string, string>;
  supersedesAnalysisIds: string[];
}

interface ConcordanceActions {
  setNodePagination: Dispatch<SetStateAction<PaginationState>>;
  runAnalysis: RunAnalysis;
  prepareBeforeRun?: () => Promise<void>;
}

interface Params {
  state: ConcordanceState;
  actions: ConcordanceActions;
}

/** Centralizes Concordance Preview submission, pagination, and sorting. */
/**
 * Used by: `ConcordanceFeature`; its feature test mocks this hook boundary.
 * Flow: submit concordance requests, update local page controls, and expose
 * Run All is submitted separately by the feature. TanStack Query owns every result page.
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
    tokenizerModelsByNode,
    supersedesAnalysisIds,
    caseSensitive,
    ignorePunctuation,
  },
  actions: { setNodePagination, runAnalysis, prepareBeforeRun },
}: Params) {
  /** Starts a fresh concordance analysis or targeted update while preserving the analysis lock. */
  /**
   * Returned to `ConcordanceFeature` by `useConcordanceTaskFlow`.
   * Flow: validate search text and node columns, reset relevant pagination,
   * submit the Analysis, publish its identity, and publish result/error state.
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
    const nodeTokenizerModels = Object.fromEntries(
      requestNodeIds.flatMap((nodeId) => {
        const model = (tokenizerModelsByNode[nodeId] ?? '').trim();
        return model ? [[nodeId, model]] : [];
      }),
    );
    if (
      searchMode === 'tokens' &&
      Object.keys(nodeTokenizerModels).length !== requestNodeIds.length
    ) {
      toast.error('Select a tokenizer model for each selected data block.');
      return;
    }

    const request: ConcordanceAnalysisRequest = {
      node_ids: requestNodeIds,
      node_columns: nodeColumns,
      search_word: trimmedSearch,
      num_left_tokens: numLeftTokens,
      num_right_tokens: numRightTokens,
      regex,
      whole_word: wholeWord,
      case_sensitive: caseSensitive,
      ignore_punctuation: ignorePunctuation,
      search_mode: searchMode,
      node_tokenizer_models: nodeTokenizerModels,
    };
    await runAnalysis<Analysis>({
      action: 'preview',
      prepare: prepareBeforeRun,
      submit: async () => {
        const { data } = await submitTabAnalysis({
          body: {
            execution_scope: 'preview',
            request: { kind: 'concordance', ...request },
            ...(supersedesAnalysisIds.length
              ? { supersedes_analysis_ids: supersedesAnalysisIds }
              : {}),
          },
          path: { workspace_id: currentWorkspaceId, tab_id: tabId },
          throwOnError: true,
        });
        return data;
      },
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

  return {
    handleSearch,
    handleSort,
    handlePageChange,
    persistResultPreferences,
  };
}
