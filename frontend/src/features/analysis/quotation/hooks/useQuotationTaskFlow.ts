import type { Dispatch, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type {
  QuotationAnalysisResponse,
  QuotationRequest,
  QuotationResultQuery,
  QuotationEngineConfig,
  QuotationDetachRequest,
  QuotationMaterializeRequest,
} from '@/lib/backend/text';
import { textApi } from '@/lib/backend/text';
import { getNodeIdentifier, restoreAnalysisLockFromRequest, extractAndSetTaskId } from '../../common';
import type { NodeColumnSelection, NodePaginationState, WorkspaceNodeLike } from '../../common';

const DEFAULT_PAGE_SIZE = 50;

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

function getErrorMessage(error: unknown): string {
  const err = error as Record<string, unknown> | null | undefined;
  const response = err?.response as Record<string, unknown> | undefined;
  const responseData = response?.data as Record<string, unknown> | undefined;
  const body = err?.body as Record<string, unknown> | undefined;
  const errData = err?.data as Record<string, unknown> | undefined;
  const detail =
    responseData?.detail ??
    errData?.detail ??
    body?.detail;
  if (typeof detail === 'string' && detail.trim().length) return detail;
  if (detail && typeof detail === 'object') {
    try {
      return JSON.stringify(detail);
    } catch {
      /* ignore */
    }
  }
  if (typeof (err as Record<string, unknown>)?.message === 'string' && ((err as Record<string, unknown>)?.message as string).trim().length)
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
}

interface QuotationLock {
  getAuthHeaders: () => Record<string, string>;
  lockWithSnapshots: (
    snapshots: Array<{ id: string; name?: string; columns?: string[] }>,
  ) => void;
  resolveTaskId: () => Promise<string | null>;
  quotationSearch: (
    nodeId: string,
    request: QuotationRequest,
  ) => Promise<QuotationAnalysisResponse>;
  detachQuotation: (nodeId: string, request: QuotationDetachRequest) => Promise<void>;
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
  const buildDetachNodeName = (nodeLabel: string, suffix: string) => {
    const trimmed = nodeLabel.trim();
    const base = trimmed.length > 0 ? trimmed : 'node';
    const normalized = base.replace(/\s+/g, '_');
    return `${normalized}${suffix}`;
  };

  const resolveNodeLabel = (nodeId: string): string => {
    const candidates = (isLocked && lockedNodesSnapshot.length ? lockedNodesSnapshot : displayedNodes);
    const match = candidates.find((node, idx) => getNodeIdentifier(node, idx) === nodeId);
    const rawLabel = match?.name || match?.label || match?.id || nodeId;
    return String(rawLabel);
  };
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

  const resolveLockedNodeContext = (): {
    nodeId: string;
    column: string;
  } | null => {
    const sourceNode = (
      isLocked && lockedNodesSnapshot.length
        ? lockedNodesSnapshot[0]
        : displayedNodes[0]
    );
    if (!sourceNode) return null;
    const nodeId = getNodeIdentifier(sourceNode, 0);
    const selection = activeSelections.find((sel) => sel.nodeId === nodeId);
    const column = selection?.column;
    if (!column) return null;
    return { nodeId, column };
  };

  const persistContextLengthPreference = async (value: number) => {
    if (!currentWorkspaceId) return;
    const taskId = await resolveTaskId();
    if (!taskId) return;
    await textApi.postQuotationTaskResult(
      taskId,
      { context_length: value, update_only: true },
      getAuthHeaders(),
    );
  };

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
    const descending: boolean =
      overrides?.descending ?? st?.descending ?? false;

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
      extractAndSetTaskId(result, setLocalTaskId);
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
          engineConfigForRequest.type === 'remote'
            ? (engineConfigForRequest.url ?? '')
            : null,
      };
    } catch (error: unknown) {
      console.error('Failed to fetch quotations', error);
      showErrorDialog(getErrorMessage(error));
      return null;
    }
  };

  const updateStoredQuotationResult = async (
    overrides: Partial<QuotationResultQuery> = {},
  ) => {
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
      const response = await textApi.postQuotationTaskResult(
        taskId,
        payload,
        getAuthHeaders(),
      );
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
        const columnMap = lockedSelections.reduce<
          Record<string, string | undefined>
        >((acc, sel) => {
          acc[sel.nodeId] = sel.column;
          return acc;
        }, {});
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

  const handlePageChange = async (newPage: number) => {
    const targetNode = (
      isLocked && lockedNodesSnapshot.length
        ? lockedNodesSnapshot[0]
        : displayedNodes[0]
    );
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

  const handlePageSizeChange = async (pageSize: number) => {
    const targetNode = (
      isLocked && lockedNodesSnapshot.length
        ? lockedNodesSnapshot[0]
        : displayedNodes[0]
    );
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

  const handleDetach = async (nodeId: string, selectedColumns?: string[], materializedPath?: string | null) => {
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
        ...(selectedColumns && selectedColumns.length > 0 ? { selected_columns: selectedColumns } : {}),
        ...(materializedPath ? { materialized_path: materializedPath } : {}),
      });
    } catch (e: unknown) {
      showErrorDialog(getErrorMessage(e));
    } finally {
      setNodeDetaching((prev) => ({ ...prev, [nodeId]: false }));
    }
  };

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
