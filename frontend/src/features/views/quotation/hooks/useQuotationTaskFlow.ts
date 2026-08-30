import type { Analysis, QuotationAnalysisRequest, QuotationEngineConfig } from '@/api';
import { submitTabAnalysis } from '@/api';
import type { RunAnalysis } from '../../common/hooks/useAnalysisFeature';
import type { NodeDataRequest } from '@/lib/queryKeys';
import type { NodeColumnSelection } from '../../common/nodeSelectionTypes';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

/** Extracts the most useful backend error detail for quotation dialogs. */
/**
 * Called by other request and result handlers in `useQuotationTaskFlow`.
 * Flow: inspect response.data, error.data, and body detail fields, stringify object details when possible, then fall back to message or a quotation-specific default.
 */
function getErrorMessage(error: unknown): string {
  const err = error as Record<string, unknown> | null | undefined;
  const response = err?.response as Record<string, unknown> | undefined;
  const responseData = response?.data as Record<string, unknown> | undefined;
  const body = err?.body as Record<string, unknown> | undefined;
  const errData = err?.data as Record<string, unknown> | undefined;
  const detail = responseData?.detail ?? errData?.detail ?? body?.detail;
  if (typeof detail === 'string' && detail.trim().length) return detail;
  if (detail && typeof detail === 'object') {
    try {
      return JSON.stringify(detail);
    } catch {
      /* ignore */
    }
  }
  const message = err?.message;
  if (typeof message === 'string' && message.trim().length) return message;
  return 'An unexpected error occurred while loading quotations.';
}

interface QuotationState {
  currentWorkspaceId: string | null;
  tabId: string;
  hasLoaded: boolean;
  displayedNodes: Pick<WorkspaceNodeMetadata, 'id' | 'name'>[];
  activeSelections: NodeColumnSelection[];
  previewRequest: NodeDataRequest;
  originalColumnsByNode: Record<string, string[]>;
  buildEngineRequest: () => QuotationEngineConfig | null;
  supersedesAnalysisIds: string[];
}

interface QuotationActions {
  runAnalysis: RunAnalysis;
  showErrorDialog: (message: string) => void;
  setPreviewRequest: (query: NodeDataRequest) => void;
  resetPreviewRequest: () => void;
}

interface Params {
  state: QuotationState;
  actions: QuotationActions;
}

/** Bundles quotation task lifecycle handlers so the feature component stays render-focused. */
/**
 * Used by: QuotationFeature.tsx, useQuotationTaskFlow.test.tsx.
 * Flow: run the initial search, page/sort persisted results, persist context
 * length, and dispatch Preview requests for the locked source node.
 */
export function useQuotationTaskFlow({
  state: {
    currentWorkspaceId,
    tabId,
    hasLoaded,
    displayedNodes,
    activeSelections,
    previewRequest,
    originalColumnsByNode,
    buildEngineRequest,
    supersedesAnalysisIds,
  },
  actions: { runAnalysis, showErrorDialog, setPreviewRequest, resetPreviewRequest },
}: Params) {
  // Locates the locked node and column that should receive stored-result updates.
  /**
   * Called by other request and result handlers in `useQuotationTaskFlow`.
   */
  const resolveLockedNodeContext = (): {
    nodeId: string;
    column: string;
  } | null => {
    const sourceNode = displayedNodes[0];
    if (!sourceNode) return null;
    const nodeId = sourceNode.id;
    const selection = activeSelections.find((sel) => sel.nodeId === nodeId);
    const column = selection?.column;
    if (!column) return null;
    return { nodeId, column };
  };

  // Runs or refreshes quotation extraction for one node using active paging and engine state.
  /**
   * Called by other request and result handlers in `useQuotationTaskFlow`.
   * Flow: resolve the live node/column/page and engine, submit a quotation
   * search, capture its Analysis identity, then apply context and result state.
   */
  const fetchQuotations = async (
    nodeId: string,
    overrides?: {
      page?: number;
      pageSize?: number;
      sortBy?: string;
      descending?: boolean;
      columnOverride?: string;
    },
  ) => {
    if (!currentWorkspaceId) return null;
    const selection = activeSelections.find((s) => s.nodeId === nodeId);
    // an empty column override should fall through to the active selection's column
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const column = overrides?.columnOverride || selection?.column;
    if (!column) return null;

    const enginePayload = buildEngineRequest();
    if (!enginePayload) {
      return null;
    }

    const requestPayload: QuotationAnalysisRequest = {
      node_id: nodeId,
      column,
      engine:
        enginePayload.type === 'remote'
          ? { type: 'remote', engine_id: enginePayload.engine_id }
          : { type: 'local' },
    };

    const analysis = await runAnalysis<Analysis>({
      action: 'preview',
      resetBeforeRun: () => {
        resetPreviewRequest();
      },
      submit: async () => {
        const { data } = await submitTabAnalysis({
          body: {
            execution_scope: 'preview',
            request: { kind: 'quotation', ...requestPayload },
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
        console.error('Failed to fetch quotations', error);
        showErrorDialog(getErrorMessage(error));
      },
    });
    return analysis ? requestPayload : null;
  };

  // Updates the immutable Result projection query without creating a new Analysis.
  /**
   * Called by request and task handlers in `useQuotationTaskFlow`.
   * Flow: resolve the locked task/source context, query the requested page or
   * sort state, then replace the Query-owned projection parameters.
   */
  const updateStoredQuotationResult = (overrides: Partial<NodeDataRequest> = {}) => {
    if (!currentWorkspaceId) return null;
    const context = resolveLockedNodeContext();
    if (!context) return null;

    const payload: NodeDataRequest = {
      page: overrides.page ?? previewRequest.page,
      page_size: overrides.page_size ?? previewRequest.page_size,
      sort_by: overrides.sort_by ?? previewRequest.sort_by,
      descending: overrides.descending ?? previewRequest.descending,
    };

    setPreviewRequest(payload);
    return payload;
  };

  // Starts the initial quotation search; terminal result hydration locks the result context.
  /**
   * Returned to `QuotationFeature` by `useQuotationTaskFlow`.
   * Flow: submit page one for the displayed node while leaving result state
   * empty until the background Analysis produces a successful Result.
   */
  const handleSearchAll = async () => {
    const targetNode = displayedNodes[0];
    const nodeId = targetNode?.id ?? '';
    if (!nodeId) return;

    await fetchQuotations(nodeId, { page: 1 });
  };

  // Handles page changes by updating the Result projection query.
  /**
   * Returned to `QuotationFeature` by `useQuotationTaskFlow`.
   */
  const handlePageChange = (newPage: number) => {
    const targetNode = displayedNodes[0];
    const nodeId = targetNode?.id ?? '';
    if (!nodeId || !hasLoaded) return;
    updateStoredQuotationResult({ page: newPage });
  };

  // Handles page-size changes while preserving the completed Analysis as the source of truth.
  /**
   * Returned to `QuotationFeature` by `useQuotationTaskFlow`.
   */
  const handlePageSizeChange = (pageSize: number) => {
    const targetNode = displayedNodes[0];
    const nodeId = targetNode?.id ?? '';
    if (!nodeId || !hasLoaded) return;
    updateStoredQuotationResult({
      page: 1,
      page_size: pageSize,
    });
  };

  // Applies sortable-column requests either through a fresh search or Result projection update.
  /**
   * Returned to `QuotationFeature` by `useQuotationTaskFlow`.
   * Flow: ignore non-sortable columns, toggle sort direction for repeated columns, then submit fresh unlocked work or update the locked Result projection.
   */
  const handleSort = (nodeId: string, column: string) => {
    const sortableColumns = new Set(originalColumnsByNode[nodeId] ?? []);
    const sourceColumn = activeSelections.find((selection) => selection.nodeId === nodeId)?.column;
    if (column !== sourceColumn && !sortableColumns.has(column)) return;
    const isSame = previewRequest.sort_by === column;
    const nextDescending: boolean = isSame ? !previewRequest.descending : false;
    if (!hasLoaded) return;
    updateStoredQuotationResult({
      page: 1,
      sort_by: column,
      descending: nextDescending,
    });
  };

  return {
    resolveLockedNodeContext,
    fetchQuotations,
    updateStoredQuotationResult,
    handleSearchAll,
    handlePageChange,
    handlePageSizeChange,
    handleSort,
  };
}
