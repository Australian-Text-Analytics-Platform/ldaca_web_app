import type { Dispatch, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { updateQuotationTaskResult } from '@/api/generated/sdk.gen';
import type {
  QuotationAnalysisResponse,
  QuotationRequestInput,
  QuotationResultQuery,
  QuotationEngineConfigInput,
  QuotationDetachRequest,
  QuotationMaterializeRequest,
  AnalysisTaskActionResponse,
} from '@/api/generated/types.gen';
import {
  getNodeIdentifier,
  restoreAnalysisLockFromRequest,
  extractAndSetTaskId,
} from '../../common';
import type { NodeColumnSelection, NodePaginationState, WorkspaceNodeLike } from '../../common';

const DEFAULT_PAGE_SIZE = 50;
type QuotationRequest = QuotationRequestInput;
type QuotationEngineConfig = QuotationEngineConfigInput;

type EngineRequestPayload = { type: 'local' } | { type: 'remote'; url: string };

type ResolvedEnginePayload =
  | { type: 'local' }
  | {
      type: 'remote';
      rawUrl: string;
      normalizedUrl: string;
      isValid: boolean;
      failureReason: string | null;
    };

/** Extracts the most useful backend error detail for quotation dialogs. */
/**
 * Called by: useQuotationTaskFlow hook as a local helper in this analysis workflow because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
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
  if (
    typeof (err as Record<string, unknown>)?.message === 'string' &&
    ((err as Record<string, unknown>)?.message as string).trim().length
  )
    return (err as Record<string, unknown>).message as string;
  return 'An unexpected error occurred while loading quotations.';
}

interface QuotationState {
  currentWorkspaceId: string | null;
  isLocked: boolean;
  hasLoaded: boolean;
  lockedNodesSnapshot: WorkspaceNodeLike[];
  displayedNodes: WorkspaceNodeLike[];
  activeSelections: NodeColumnSelection[];
  nodeState: Record<string, NodePaginationState>;
  originalColumnsByNode: Record<string, string[]>;
  resolvedEnginePayload: ResolvedEnginePayload;
  engineConfigUrl: string;
}

interface QuotationActions {
  setEngineError: (error: string | null) => void;
  updateRemoteUrl: (url: string) => void;
  setIsLoadingQuotations: (value: boolean) => void;
  setHasLoaded: (value: boolean) => void;
  setNodeDetaching: Dispatch<SetStateAction<Record<string, boolean>>>;
  setNodeMaterializing?: Dispatch<SetStateAction<Record<string, boolean>>>;
  setMaterializeTaskIds?: Dispatch<SetStateAction<Record<string, string>>>;
  showErrorDialog: (message: string) => void;
  baseHandlePageChange: (page: number) => void;
  baseHandlePageSizeChange: (pageSize: number) => void;
  updateResultState: (nodeId: string, column: string, result: QuotationAnalysisResponse) => void;
  applyContextLengthPreferenceFromResult: (payload: QuotationAnalysisResponse) => void;
  setLocalTaskId: (id: string | null) => void;
  // Reports the run's assigned task id back to the owning tab. No-op when not
  // tab-mounted.
  onTaskIdAssigned?: (taskId: string | null) => void;
}

interface QuotationLock {
  getAuthHeaders: () => Record<string, string>;
  lockWithSnapshots: (snapshots: Array<{ id: string; name?: string; columns?: string[] }>) => void;
  resolveTaskId: () => Promise<string | null>;
  quotationSearch: (
    nodeId: string,
    request: QuotationRequest,
  ) => Promise<QuotationAnalysisResponse>;
  detachQuotation: (
    nodeId: string,
    request: QuotationDetachRequest,
  ) => Promise<AnalysisTaskActionResponse>;
  materializeQuotation?: (
    nodeId: string,
    request: QuotationMaterializeRequest,
  ) => Promise<{ metadata?: { task_id?: string | null } | null } | undefined>;
  openEngineDialog: () => void;
  queryClient: QueryClient;
}

type Params = {
  state: QuotationState;
  actions: QuotationActions;
  lock: QuotationLock;
};

/** Bundles quotation task lifecycle handlers so the feature component stays render-focused. */
/**
 * Used by: QuotationFeature.tsx, useQuotationTaskFlow.test.tsx because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
 * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
 */
export function useQuotationTaskFlow({
  state: {
    currentWorkspaceId,
    isLocked,
    hasLoaded,
    lockedNodesSnapshot,
    displayedNodes,
    activeSelections,
    nodeState,
    originalColumnsByNode,
    resolvedEnginePayload,
    engineConfigUrl,
  },
  actions: {
    setEngineError,
    updateRemoteUrl,
    setIsLoadingQuotations,
    setHasLoaded,
    setNodeDetaching,
    setNodeMaterializing,
    setMaterializeTaskIds,
    showErrorDialog,
    baseHandlePageChange,
    baseHandlePageSizeChange,
    updateResultState,
    applyContextLengthPreferenceFromResult,
    setLocalTaskId,
    onTaskIdAssigned,
  },
  lock: {
    getAuthHeaders,
    lockWithSnapshots,
    resolveTaskId,
    quotationSearch,
    detachQuotation,
    materializeQuotation,
    openEngineDialog,
    queryClient,
  },
}: Params) {
  // Builds deterministic output names for detach operations from display labels.
  /**
   * Called by: useQuotationTaskFlow as a local helper in this analysis workflow because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   */
  const buildDetachNodeName = (nodeLabel: string, suffix: string) => {
    const trimmed = nodeLabel.trim();
    const base = trimmed.length > 0 ? trimmed : 'node';
    const normalized = base.replace(/\s+/g, '_');
    return `${normalized}${suffix}`;
  };

  // Resolves a node label from the active locked or live node list for generated output names.
  /**
   * Called by: useQuotationTaskFlow as a local helper in this analysis workflow because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   */
  const resolveNodeLabel = (nodeId: string): string => {
    const candidates =
      isLocked && lockedNodesSnapshot.length ? lockedNodesSnapshot : displayedNodes;
    const match = candidates.find((node, idx) => getNodeIdentifier(node, idx) === nodeId);
    const rawLabel = match?.name || match?.label || match?.id || nodeId;
    return String(rawLabel);
  };
  // Converts the UI engine selection into the backend request shape, validating remote URLs first.
  /**
   * Called by: useQuotationTaskFlow as a local helper in this analysis workflow because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   * Flow: validate remote engine URLs, normalize and persist corrected URLs, clear or set engine errors, then return local or remote engine payloads.
   */
  const buildEngineRequest = (): EngineRequestPayload | null => {
    if (resolvedEnginePayload.type === 'remote') {
      const rawUrl = resolvedEnginePayload.rawUrl;
      if (!rawUrl.length) {
        setEngineError('Provide a quotation service URL.');
        return null;
      }
      if (!resolvedEnginePayload.isValid) {
        if (resolvedEnginePayload.failureReason === 'empty') {
          setEngineError('Provide a quotation service URL.');
        } else if (resolvedEnginePayload.failureReason === 'protocol') {
          setEngineError('Remote engines must use http:// or https:// URLs.');
        } else {
          setEngineError('Enter a valid URL including http:// or https://');
        }
        return null;
      }
      const normalizedUrl = resolvedEnginePayload.normalizedUrl;
      if (engineConfigUrl.trim() !== normalizedUrl) {
        updateRemoteUrl(normalizedUrl);
      }
      setEngineError(null);
      return { type: 'remote', url: normalizedUrl };
    }
    setEngineError(null);
    return { type: 'local' };
  };

  // Locates the locked node and column that should receive stored-result updates.
  /**
   * Called by: useQuotationTaskFlow as a local helper in this analysis workflow because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   */
  const resolveLockedNodeContext = (): {
    nodeId: string;
    column: string;
  } | null => {
    const sourceNode =
      isLocked && lockedNodesSnapshot.length ? lockedNodesSnapshot[0] : displayedNodes[0];
    if (!sourceNode) return null;
    const nodeId = getNodeIdentifier(sourceNode, 0);
    const selection = activeSelections.find((sel) => sel.nodeId === nodeId);
    const column = selection?.column;
    if (!column) return null;
    return { nodeId, column };
  };

  // Persists the user's context-length preference onto the stored quotation task result.
  /**
   * Called by: useQuotationTaskFlow during this analysis workflow because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   */
  const persistContextLengthPreference = async (value: number) => {
    if (!currentWorkspaceId) return;
    const taskId = await resolveTaskId();
    if (!taskId) return;
    await updateQuotationTaskResult({
      body: { context_length: value, update_only: true },
      headers: getAuthHeaders(),
      path: { task_id: taskId },
      throwOnError: true,
    });
  };

  // Runs or refreshes quotation extraction for one node using active paging and engine state.
  /**
   * Called by: useQuotationTaskFlow as a local helper in this analysis workflow because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
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
    const column = overrides?.columnOverride || selection?.column;
    if (!column) return null;

    const st = nodeState[nodeId];
    const page = overrides?.page ?? st?.currentPage ?? 1;
    const pageSize = overrides?.pageSize ?? st?.pageSize;
    const sortBy = overrides?.sortBy ?? st?.sortBy;
    const descending: boolean = overrides?.descending ?? st?.descending ?? false;

    const enginePayload = buildEngineRequest();
    if (!enginePayload) {
      openEngineDialog();
      return null;
    }

    const engineConfigForRequest: QuotationEngineConfig =
      enginePayload.type === 'remote'
        ? { type: 'remote', url: enginePayload.url }
        : { type: 'local' };

    const requestPayload: QuotationRequest = {
      column,
      page,
      sort_by: sortBy ?? undefined,
      descending,
      engine: engineConfigForRequest,
    };
    if (pageSize !== undefined) {
      requestPayload.page_size = pageSize;
    }

    try {
      const result = await quotationSearch(nodeId, requestPayload);
      const assignedTaskId = extractAndSetTaskId(result, setLocalTaskId);
      onTaskIdAssigned?.(assignedTaskId);
      applyContextLengthPreferenceFromResult(result);
      updateResultState(nodeId, column, result);
      return {
        column,
        page: requestPayload.page,
        page_size: requestPayload.page_size,
        sort_by: requestPayload.sort_by ?? null,
        descending: requestPayload.descending,
        engine_type: engineConfigForRequest.type,
        engine_url:
          engineConfigForRequest.type === 'remote' ? (engineConfigForRequest.url ?? '') : null,
      };
    } catch (error: unknown) {
      console.error('Failed to fetch quotations', error);
      showErrorDialog(getErrorMessage(error));
      return null;
    }
  };

  // Updates an existing stored task result without creating a new quotation task.
  /**
   * Called by: useQuotationTaskFlow during this analysis workflow because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
   */
  const updateStoredQuotationResult = async (overrides: Partial<QuotationResultQuery> = {}) => {
    if (!currentWorkspaceId) return null;
    const context = resolveLockedNodeContext();
    if (!context) return null;

    const { nodeId, column } = context;
    const st = nodeState[nodeId] || {
      currentPage: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sortBy: undefined,
      descending: false,
    };

    const payload: QuotationResultQuery = {
      page: overrides.page ?? st.currentPage ?? 1,
      page_size: overrides.page_size ?? st.pageSize ?? DEFAULT_PAGE_SIZE,
      sort_by: overrides.sort_by ?? st.sortBy ?? null,
      descending: overrides.descending ?? st.descending ?? false,
    };

    try {
      const taskId = await resolveTaskId();
      if (!taskId) return null;
      const { data: response } = await updateQuotationTaskResult({
        body: payload,
        headers: getAuthHeaders(),
        path: { task_id: taskId },
        throwOnError: true,
      });
      if (!response || !('columns' in response)) return null;
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
   * Called by: useQuotationTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
   */
  const handleSearchAll = async () => {
    const targetNode = displayedNodes[0];
    const nodeId = targetNode ? getNodeIdentifier(targetNode, 0) : '';
    if (!nodeId) return;

    setIsLoadingQuotations(true);
    try {
      const outcome = await fetchQuotations(nodeId, { page: 1 });
      if (!outcome) return;
      setHasLoaded(true);
      try {
        const lockedSelections = activeSelections.filter(
          (sel) => sel.nodeId === nodeId && sel.column,
        );
        const columnMap = lockedSelections.reduce<Record<string, string | undefined>>(
          (acc, sel) => {
            acc[sel.nodeId] = sel.column;
            return acc;
          },
          {},
        );
        await restoreAnalysisLockFromRequest({
          workspaceId: currentWorkspaceId,
          requestData: {
            node_ids: [nodeId],
            node_columns: columnMap,
          },
          getAuthHeaders,
          lockWithSnapshots,
          queryClient,
          maxNodes: 1,
        });
      } catch {
        /* ignore */
      }
    } finally {
      setIsLoadingQuotations(false);
    }
  };

  // Handles page changes by updating stored locked results when possible, otherwise local state.
  /**
   * Called by: useQuotationTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   */
  const handlePageChange = async (newPage: number) => {
    const targetNode =
      isLocked && lockedNodesSnapshot.length ? lockedNodesSnapshot[0] : displayedNodes[0];
    const nodeId = targetNode ? getNodeIdentifier(targetNode, 0) : '';
    if (!nodeId) {
      baseHandlePageChange(newPage);
      return;
    }
    if (!isLocked || !hasLoaded) {
      baseHandlePageChange(newPage);
      return;
    }
    const updated = await updateStoredQuotationResult({ page: newPage });
    if (!updated) baseHandlePageChange(newPage);
  };

  // Handles page-size changes while preserving the stored task as the source of truth in locked mode.
  /**
   * Called by: useQuotationTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   */
  const handlePageSizeChange = async (pageSize: number) => {
    const targetNode =
      isLocked && lockedNodesSnapshot.length ? lockedNodesSnapshot[0] : displayedNodes[0];
    const nodeId = targetNode ? getNodeIdentifier(targetNode, 0) : '';
    if (!nodeId) {
      baseHandlePageSizeChange(pageSize);
      return;
    }
    if (!isLocked || !hasLoaded) {
      baseHandlePageSizeChange(pageSize);
      return;
    }
    const updated = await updateStoredQuotationResult({
      page: 1,
      page_size: pageSize,
    });
    if (!updated) baseHandlePageSizeChange(pageSize);
  };

  // Applies sortable-column requests either through a fresh search or stored result update.
  /**
   * Called by: useQuotationTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   * Flow: ignore non-sortable columns, toggle sort direction for repeated columns, then fetch fresh unlocked results or update locked stored results.
   */
  const handleSort = async (nodeId: string, column: string) => {
    const sortableColumns = new Set(originalColumnsByNode[nodeId] || []);
    if (!sortableColumns.has(column)) return;
    const st = nodeState[nodeId] || {
      currentPage: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sortBy: undefined,
      descending: false,
    };
    const isSame = st.sortBy === column;
    const nextDescending: boolean = isSame ? !st.descending : false;
    if (!isLocked || !hasLoaded) {
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
   * Called by: useQuotationTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
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
      const enginePayload = buildEngineRequest();
      if (!enginePayload) {
        openEngineDialog();
        return;
      }
      await detachQuotation(nodeId, {
        node_id: nodeId,
        column: selection.column,
        new_node_name: buildDetachNodeName(resolveNodeLabel(nodeId), '_quotation'),
        engine:
          enginePayload.type === 'remote'
            ? { type: 'remote', url: enginePayload.url }
            : { type: 'local' },
        ...(selectedColumns && selectedColumns.length > 0
          ? { selected_columns: selectedColumns }
          : {}),
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
   * Called by: useQuotationTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
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
        openEngineDialog();
        setNodeMaterializing?.((prev) => {
          if (!prev[nodeId]) return prev;
          const { [nodeId]: _removed, ...next } = prev;
          void _removed;
          return next;
        });
        return;
      }
      const resp = await materializeQuotation(nodeId, {
        parent_task_id: parentTaskId,
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
    buildEngineRequest,
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
