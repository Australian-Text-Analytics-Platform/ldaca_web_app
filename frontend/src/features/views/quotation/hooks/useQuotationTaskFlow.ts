import type { Dispatch, SetStateAction } from 'react';
import { analysisTaskPreferences, analysisTaskResultQuery } from '@/api';
import type {
  QuotationAnalysisResponse,
  QuotationRequest,
  QuotationResultQuery,
  QuotationDetachRequest,
  QuotationMaterializeRequest,
  AnalysisTaskActionResponse,
} from '@/api';
import { extractAndSetTaskId } from '../../common/extractTaskId';
import type { NodeColumnSelection } from '../../common/nodeSelectionTypes';
import type { NodePaginationState } from '../../common/tasks/types';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import type { QuotationEngineRequestPayload } from './useQuotationEngineSettings';

const DEFAULT_PAGE_SIZE = 50;

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
  hasLoaded: boolean;
  displayedNodes: Pick<WorkspaceNodeMetadata, 'id' | 'name'>[];
  activeSelections: NodeColumnSelection[];
  nodeState: Record<string, NodePaginationState>;
  originalColumnsByNode: Record<string, string[]>;
  buildEngineRequest: () => QuotationEngineRequestPayload | null;
}

interface QuotationActions {
  setIsLoadingQuotations: (value: boolean) => void;
  setHasLoaded: (value: boolean) => void;
  setNodeDetaching: Dispatch<SetStateAction<Record<string, boolean>>>;
  setNodeMaterializing?: Dispatch<SetStateAction<Record<string, boolean>>>;
  setMaterializeTaskIds?: Dispatch<SetStateAction<Record<string, string>>>;
  showErrorDialog: (message: string) => void;
  updateResultState: (nodeId: string, column: string, result: QuotationAnalysisResponse) => void;
  applyContextLengthPreferenceFromResult: (payload: QuotationAnalysisResponse) => void;
  setLocalTaskId: (id: string | null) => void;
  // Reports the run's assigned task id back to the owning tab. No-op when not
  // tab-mounted.
  onTaskIdAssigned?: (taskId: string | null) => void;
}

interface QuotationLock {
  resolveTaskId: () => Promise<string | null>;
  quotationSearch: (
    nodeId: string,
    request: QuotationRequest,
  ) => Promise<QuotationAnalysisResponse | null>;
  detachQuotation: (
    taskId: string,
    request: QuotationDetachRequest,
  ) => Promise<AnalysisTaskActionResponse>;
  materializeQuotation?: (
    taskId: string,
    request: QuotationMaterializeRequest,
  ) => Promise<{ metadata?: { task_id?: string | null } | null } | undefined>;
}

interface Params {
  state: QuotationState;
  actions: QuotationActions;
  lock: QuotationLock;
}

/** Bundles quotation task lifecycle handlers so the feature component stays render-focused. */
/**
 * Used by: QuotationFeature.tsx, useQuotationTaskFlow.test.tsx.
 * Flow: run the initial search, page/sort persisted results, persist context
 * length, and dispatch detach/materialize requests for the locked source node.
 */
export function useQuotationTaskFlow({
  state: {
    currentWorkspaceId,
    hasLoaded,
    displayedNodes,
    activeSelections,
    nodeState,
    originalColumnsByNode,
    buildEngineRequest,
  },
  actions: {
    setIsLoadingQuotations,
    setHasLoaded,
    setNodeDetaching,
    setNodeMaterializing,
    setMaterializeTaskIds,
    showErrorDialog,
    updateResultState,
    applyContextLengthPreferenceFromResult,
    setLocalTaskId,
    onTaskIdAssigned,
  },
  lock: { resolveTaskId, quotationSearch, detachQuotation, materializeQuotation },
}: Params) {
  // Builds deterministic output names for detach operations from display labels.
  /**
   * Called by other request and result handlers in `useQuotationTaskFlow`.
   */
  const buildDetachNodeName = (nodeLabel: string, suffix: string) => {
    const trimmed = nodeLabel.trim();
    const base = trimmed.length > 0 ? trimmed : 'node';
    const normalized = base.replace(/\s+/g, '_');
    return `${normalized}${suffix}`;
  };

  // Resolves a node label from the active locked or live node list for generated output names.
  /**
   * Called by other request and result handlers in `useQuotationTaskFlow`.
   */
  const resolveNodeLabel = (nodeId: string): string => {
    const match = displayedNodes.find((node) => node.id === nodeId);
    if (!match) return nodeId;
    return match.name.length > 0 ? match.name : match.id;
  };

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

  // Persists the user's context-length preference onto the stored quotation task result.
  /**
   * Called by request and task handlers in `useQuotationTaskFlow`.
   */
  const persistContextLengthPreference = async (value: number) => {
    if (!currentWorkspaceId) return;
    const taskId = await resolveTaskId();
    if (!taskId) return;
    await analysisTaskPreferences({
      body: { context_length: value },
      path: { workspace_id: currentWorkspaceId, task_id: taskId },
      throwOnError: true,
    });
  };

  // Runs or refreshes quotation extraction for one node using active paging and engine state.
  /**
   * Called by other request and result handlers in `useQuotationTaskFlow`.
   * Flow: resolve the live node/column/page and engine, submit a quotation
   * search, capture its task id, then apply context and result state.
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

    const st = nodeState[nodeId];
    const page = overrides?.page ?? st?.currentPage ?? 1;
    const pageSize = overrides?.pageSize ?? st?.pageSize;
    const sortBy = overrides?.sortBy ?? st?.sortBy;
    const descending: boolean = overrides?.descending ?? st?.descending ?? false;

    const enginePayload = buildEngineRequest();
    if (!enginePayload) {
      return null;
    }

    const requestPayload: QuotationRequest = {
      column,
      page,
      sort_by: sortBy ?? undefined,
      descending,
      engine:
        enginePayload.type === 'remote'
          ? { type: 'remote', url: enginePayload.url }
          : { type: 'local' },
    };
    if (pageSize !== undefined) {
      requestPayload.page_size = pageSize;
    }

    try {
      const result = await quotationSearch(nodeId, requestPayload);
      if (!result) {
        return null;
      }
      const assignedTaskId = extractAndSetTaskId(result, setLocalTaskId);
      onTaskIdAssigned?.(assignedTaskId);
      applyContextLengthPreferenceFromResult(result);
      updateResultState(nodeId, column, result);
      return requestPayload;
    } catch (error: unknown) {
      console.error('Failed to fetch quotations', error);
      showErrorDialog(getErrorMessage(error));
      return null;
    }
  };

  // Updates an existing stored task result without creating a new quotation task.
  /**
   * Called by request and task handlers in `useQuotationTaskFlow`.
   * Flow: resolve the locked task/source context, query the requested page or
   * sort state, then replace the stored result and mark it loaded.
   */
  const updateStoredQuotationResult = async (overrides: Partial<QuotationResultQuery> = {}) => {
    if (!currentWorkspaceId) return null;
    const context = resolveLockedNodeContext();
    if (!context) return null;

    const { nodeId, column } = context;
    const st = nodeState[nodeId] ?? {
      currentPage: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sortBy: undefined,
      descending: false,
    };

    const payload: QuotationResultQuery = {
      page: overrides.page ?? st.currentPage,
      page_size: overrides.page_size ?? st.pageSize,
      sort_by: overrides.sort_by ?? st.sortBy ?? null,
      descending: overrides.descending ?? st.descending,
    };

    try {
      const taskId = await resolveTaskId();
      if (!taskId) return null;
      const { data } = await analysisTaskResultQuery({
        body: payload,
        path: { workspace_id: currentWorkspaceId, task_id: taskId },
        throwOnError: true,
      });
      const response = data as QuotationAnalysisResponse;
      if (!('columns' in response)) return null;
      applyContextLengthPreferenceFromResult(response);
      updateResultState(nodeId, column, response);
      setHasLoaded(true);
      return response;
    } catch (error: unknown) {
      console.error('Failed to refresh quotation results', error);
      showErrorDialog(getErrorMessage(error));
      return null;
    }
  };

  // Starts the initial quotation search and locks the selected node/column context afterward.
  /**
   * Returned to `QuotationFeature` by `useQuotationTaskFlow`.
   * Flow: run page one for the displayed node and lock result mode only after
   * the initial search succeeds.
   */
  const handleSearchAll = async () => {
    const targetNode = displayedNodes[0];
    const nodeId = targetNode?.id ?? '';
    if (!nodeId) return;

    setIsLoadingQuotations(true);
    try {
      const outcome = await fetchQuotations(nodeId, { page: 1 });
      if (!outcome) return;
      setHasLoaded(true);
    } finally {
      setIsLoadingQuotations(false);
    }
  };

  // Handles page changes by updating the stored task result.
  /**
   * Returned to `QuotationFeature` by `useQuotationTaskFlow`.
   */
  const handlePageChange = async (newPage: number) => {
    const targetNode = displayedNodes[0];
    const nodeId = targetNode?.id ?? '';
    if (!nodeId || !hasLoaded) return;
    await updateStoredQuotationResult({ page: newPage });
  };

  // Handles page-size changes while preserving the stored task as the source of truth in locked mode.
  /**
   * Returned to `QuotationFeature` by `useQuotationTaskFlow`.
   */
  const handlePageSizeChange = async (pageSize: number) => {
    const targetNode = displayedNodes[0];
    const nodeId = targetNode?.id ?? '';
    if (!nodeId || !hasLoaded) return;
    await updateStoredQuotationResult({
      page: 1,
      page_size: pageSize,
    });
  };

  // Applies sortable-column requests either through a fresh search or stored result update.
  /**
   * Returned to `QuotationFeature` by `useQuotationTaskFlow`.
   * Flow: ignore non-sortable columns, toggle sort direction for repeated columns, then fetch fresh unlocked results or update locked stored results.
   */
  const handleSort = async (nodeId: string, column: string) => {
    const sortableColumns = new Set(originalColumnsByNode[nodeId] ?? []);
    if (!sortableColumns.has(column)) return;
    const st = nodeState[nodeId] ?? {
      currentPage: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sortBy: undefined,
      descending: false,
    };
    const isSame = st.sortBy === column;
    const nextDescending: boolean = isSame ? !st.descending : false;
    if (!hasLoaded) {
      await fetchQuotations(nodeId, {
        page: 1,
        sortBy: column,
        descending: nextDescending,
      });
      return;
    }
    await updateStoredQuotationResult({
      page: 1,
      sort_by: column,
      descending: nextDescending,
    });
  };

  // Detaches quotation results into a workspace node, including optional source columns.
  /**
   * Returned to `QuotationFeature` by `useQuotationTaskFlow`.
   * Flow: find the active node column, build local or remote engine payload, send the quotation detach request with optional columns/path, then clear node detaching state.
   */
  const handleDetach = async (
    nodeId: string,
    selectedColumns?: string[],
    materializedPath?: string | null,
  ) => {
    const selection = activeSelections.find((s) => s.nodeId === nodeId);
    if (!selection?.column) return;
    setNodeDetaching((prev) => ({ ...prev, [nodeId]: true }));
    try {
      const explicitSelectedColumns = selectedColumns ?? [];
      if (explicitSelectedColumns.length === 0) {
        showErrorDialog('Select at least one column to add to workspace.');
        return;
      }
      const parentTaskId = await resolveTaskId();
      if (!parentTaskId) {
        showErrorDialog('No quotation task to detach.');
        return;
      }
      const enginePayload = buildEngineRequest();
      if (!enginePayload) {
        return;
      }
      await detachQuotation(parentTaskId, {
        node_id: nodeId,
        column: selection.column,
        new_node_name: buildDetachNodeName(resolveNodeLabel(nodeId), '_quotation'),
        engine:
          enginePayload.type === 'remote'
            ? { type: 'remote', url: enginePayload.url }
            : { type: 'local' },
        selected_columns: explicitSelectedColumns,
        ...(materializedPath ? { materialized_path: materializedPath } : {}),
      });
    } catch (e: unknown) {
      showErrorDialog(getErrorMessage(e));
    } finally {
      setNodeDetaching((prev) => ({ ...prev, [nodeId]: false }));
    }
  };

  // Starts backend materialization for full quotation results before detach use.
  /**
   * Returned to `QuotationFeature` by `useQuotationTaskFlow`.
   * Flow: resolve the parent task and engine, submit materialization for the
   * active node/column, and track the returned child task id for completion.
   */
  const handleMaterialize = async (nodeId: string) => {
    const selection = activeSelections.find((s) => s.nodeId === nodeId);
    if (!selection?.column) return;
    if (!materializeQuotation) return;

    const parentTaskId = await resolveTaskId();
    if (!parentTaskId) {
      showErrorDialog('No quotation task to materialize.');
      return;
    }

    setNodeMaterializing?.((prev) => ({ ...prev, [nodeId]: true }));
    try {
      const enginePayload = buildEngineRequest();
      if (!enginePayload) {
        setNodeMaterializing?.((prev) => {
          if (!prev[nodeId]) return prev;
          const { [nodeId]: _removed, ...next } = prev;
          void _removed;
          return next;
        });
        return;
      }
      const resp = await materializeQuotation(parentTaskId, {
        node_id: nodeId,
        column: selection.column,
        engine:
          enginePayload.type === 'remote'
            ? { type: 'remote', url: enginePayload.url }
            : { type: 'local' },
      });
      const taskId = (resp as { metadata?: { task_id?: string } } | undefined)?.metadata?.task_id;
      if (taskId && setMaterializeTaskIds) {
        setMaterializeTaskIds((prev) => ({ ...prev, [nodeId]: taskId }));
      }
    } catch (e: unknown) {
      showErrorDialog(getErrorMessage(e));
      setNodeMaterializing?.((prev) => {
        if (!prev[nodeId]) return prev;
        const { [nodeId]: _removed, ...next } = prev;
        void _removed;
        return next;
      });
    }
  };

  return {
    resolveLockedNodeContext,
    persistContextLengthPreference,
    fetchQuotations,
    updateStoredQuotationResult,
    handleSearchAll,
    handlePageChange,
    handlePageSizeChange,
    handleSort,
    handleDetach,
    handleMaterialize,
  };
}
