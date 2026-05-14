import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import NodeSelectionPanel from '@/features/analysis/common/components/NodeSelectionPanel';
import { ANALYSIS_LOCKED_MESSAGE } from '@/features/analysis/common/components/AnalysisLockedNotice';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/stores/uiStore';
import AnalysisTaskBanner from '@/features/analysis/common/components/AnalysisTaskBanner';
import { textApi } from '@/api/text';
import type {
  QuotationAnalysisResponse,
  QuotationEngineConfig,
  QuotationEngineType,
  QuotationGroupedRow,
  QuotationHitRow,
  QuotationMetadata,
} from '@/api/text';
import useNodeColumnInfos from '@/hooks/useNodeColumnInfos';
import { useQuotationEngineDialogStore } from '@/stores/quotationEngineStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { effectiveNodeLanguage, isEnglish } from '@/lib/effectiveNodeLanguage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import HelpIcon from '@/components/help/HelpIcon';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AnalysisTableScrollArea } from '@/features/analysis/common/components/AnalysisTableScrollArea';
import { ArrowUpDown, Loader2, Plus } from 'lucide-react';
import { takeMostRecent } from '@/utils/selectionUtils';
import {
  getNodeIdentifier,
  getServerEngineConfig,
  hasLockedParameterDiff,
  resetAnalysisSelectionAfterClear,
  restoreAnalysisLockFromRequest,
  useAnalysisLock,
  useAnalysisFeature,
  useNodeColorManagement,
  EXTENDED_PALETTE,
  getAnalysisActionState,
  executeAnalysisRunOrUpdate,
  type NodePaginationState,
  type WorkspaceNodeLike,
} from '../common';

import { AnalysisPagination } from '@/features/analysis/common/components/AnalysisPagination';
import { useMaterializeLifecycle } from '../common/hooks/useMaterializeLifecycle';
import { useQuotationTaskFlow } from './hooks/useQuotationTaskFlow';
import { QUOTATION_COLUMN_KEYS, QUOTATION_DOCUMENT_COLUMN } from '../generatedColumns';
import { flattenQuotationGroups } from './quotationViewModels';
import {
  DEFAULT_CONTEXT_LENGTH,
  MAX_CONTEXT_LENGTH,
  clampContextLength,
} from './quotationTextClip';
import { normalizeRemoteUrl } from './quotationRemoteUrl';
import { QuotationDetachDialog } from './components/QuotationDetachDialog';
import {
  QuotationHighlightedCell,
  type QuotationHoverState,
} from './components/QuotationHighlightedCell';
import type { DetachDialogNodeOption } from '../components/DetachColumnsDialog';
import {
  MetadataColumnSelector,
} from '../common/components/MetadataColumnSelector';
import { GroupedResultsPageSizeSummary } from '../common/components/GroupedResultsPageSizeSummary';
import { AnalysisCardLayout } from '../common/components/AnalysisCardLayout';
import { PageSizeSelect } from '../common/components/PageSizeSelect';
import { useDetachColumnsState } from '../common/hooks/useDetachColumnsState';
import { RowDetailPanel } from '../common/components/RowDetailPanel';
import { useRowDetailDialog } from '../common/components/useRowDetailDialog';
import { renderQuotationDetailText } from './components/quotationDetailText';

interface QuotationResultState {
  groupedRows: QuotationGroupedRow[];
  rows: QuotationHitRow[];
  columns: string[];
  metadata: QuotationMetadata;
  pagination: {
    page: number;
    page_size: number;
    total_source_rows: number;
    total_source_pages: number;
    result_count: number;
    has_next: boolean;
    has_prev: boolean;
  };
  sorting: {
    sort_by?: string | null;
    descending: boolean;
  };
  column: string;
}

const DEFAULT_PAGE_SIZE = 50;

type QuotationDisplayRow = QuotationHitRow & {
  __spans: { start: number; end: number; type: string }[];
};

const QuotationFeature: React.FC = () => {
  const { selectedNodes, handlePageChange: baseHandlePageChange, handlePageSizeChange: baseHandlePageSizeChange } = useWorkspaceSelection();
  const { currentWorkspaceId } = useWorkspaceData();
  const { quotationSearch, detachQuotation, materializeQuotation } = useWorkspaceActions();
  const { getAuthHeaders } = useAuth();
  const queryClient = useQueryClient();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'quotation';
  const {
    isLocked,
    lockWithSnapshots,
    unlockSelection,
    lockedNodesSnapshot,
    nodeColumnSelections,
    setNodeColumnSelection,
    setNodeColumnSelections,
    recomputeAutoColumns,
    activeNodeColumnSelections,
    panelSelectedNodes,
    displayNodeCount,
    serverRequest,
  } = useAnalysisLock({
    analysisType: 'quotation_analysis',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    allowedDataTypes: ['string'],
    maxNodes: 1,
    docTypeOnly: true,
  });

  const engineConfig = usePreferencesStore((state) => state.quotationEngine);
  const lastRemoteUrl = usePreferencesStore((state) => state.quotationLastRemoteUrl);
  const setEngineConfigStore = usePreferencesStore((state) => state.setQuotationEngine);
  const updateRemoteUrl = usePreferencesStore((state) => state.updateQuotationRemoteUrl);
  const defaultLanguage = usePreferencesStore((state) => state.defaultLanguage);
  const [engineError, setEngineError] = useState<string | null>(null);
  const engineDialogOpen = useQuotationEngineDialogStore((state) => state.isOpen);
  const setEngineDialogOpen = useQuotationEngineDialogStore((state) => state.setOpen);
  const openEngineDialog = useQuotationEngineDialogStore((state) => state.open);
  const closeEngineDialog = useQuotationEngineDialogStore((state) => state.close);
  const [selectedMetadataColumns, setSelectedMetadataColumns] = useState<string[]>([]);
  // Metadata visibility derives from the selected columns: any selection
  // shows the corresponding metadata columns in the results table.
  const showMetadata = selectedMetadataColumns.length > 0;
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoadingQuotations, setIsLoadingQuotations] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [contextLengthInput, setContextLengthInput] = useState(String(DEFAULT_CONTEXT_LENGTH));
  const [contextLength, setContextLength] = useState(DEFAULT_CONTEXT_LENGTH);
  const [contextLengthError, setContextLengthError] = useState<string | null>(null);
  const [isSavingContextLength, setIsSavingContextLength] = useState(false);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorDialogMessage, setErrorDialogMessage] = useState<string>('');
  const { detailPayload, detailOpen, setDetailOpen, openDetail: openRowDetail } = useRowDetailDialog();

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: panelSelectedNodes,
  });

  const activeSelections = isLocked ? activeNodeColumnSelections : nodeColumnSelections;

  const displayedNodes = takeMostRecent(panelSelectedNodes, 1);
  const activeNodeIds = displayedNodes
    .map((node, idx) => getNodeIdentifier(node, idx))
    .filter((id): id is string => Boolean(id));
  // Same color-management hook the other analysis tabs use — gives every
  // selected node a stable picked-colour for the name display in
  // NodeSelectionPanel (and downstream charts, if/when added).
  const { nodeColors, handleColorChange, defaultPalette } = useNodeColorManagement({
    activeNodeIds,
    palette: EXTENDED_PALETTE,
  });

  // Phase 4.5 / decision 4: quotation rules are English-only. Mirror the
  // backend gate at the UI so the Run button surfaces a clear "why is
  // this disabled" tooltip rather than letting the user submit a request
  // that's going to come back as HTTP 400. Resolves language from the
  // active node's derived metadata (Phase 2.4 v2) first, then the
  // per-user default preference, then "en".
  const nodeLanguage = effectiveNodeLanguage({
    node: displayedNodes[0] ?? null,
    defaultLanguage,
  });
  const quotationLanguageUnsupported = !isEnglish(nodeLanguage);
  const quotationLanguageDisabledReason = quotationLanguageUnsupported
    ? `Quotation extractor is English-only (this node resolves to ${nodeLanguage}). The vendored rules don't generalise to other languages.`
    : null;

  const originalColumnsByNode = (() => {
    const map: Record<string, string[]> = {};
    displayedNodes.forEach((node, idx) => {
      const nodeId = getNodeIdentifier(node, idx);
      if (!nodeId) return;
      map[nodeId] = getColumnInfos(node).map((info) => info.name);
    });
    return map;
  })();

  const resolvedEnginePayload = (() => {
    if (engineConfig.type === 'remote') {
      const rawUrl = (engineConfig.url ?? '').trim();
      const { normalized, valid, reason } = normalizeRemoteUrl(rawUrl);
      return {
        type: 'remote' as const,
        rawUrl,
        normalizedUrl: normalized,
        isValid: valid,
        failureReason: reason,
      };
    }
    return { type: 'local' as const };
  })();

  const engineReady = resolvedEnginePayload.type === 'local'
    ? true
    : resolvedEnginePayload.isValid;

  const engineBadgeLabel = resolvedEnginePayload.type === 'remote'
    ? resolvedEnginePayload.isValid
      ? 'Remote Engine'
      : 'Remote Engine • Not configured'
    : 'Local Engine';

  const engineBadgeTitle = resolvedEnginePayload.type === 'remote'
    ? resolvedEnginePayload.isValid && resolvedEnginePayload.normalizedUrl.length
      ? `Remote Engine • ${resolvedEnginePayload.normalizedUrl}`
      : 'Remote Engine • Not configured'
    : 'Local Engine';

  const engineDisplayUrl = resolvedEnginePayload.type === 'remote'
    ? resolvedEnginePayload.isValid && resolvedEnginePayload.normalizedUrl.length
      ? resolvedEnginePayload.normalizedUrl
      : resolvedEnginePayload.rawUrl
    : '';

  const showErrorDialog = (message: string) => {
    setErrorDialogMessage(message || 'An unexpected error occurred.');
    setErrorDialogOpen(true);
  };

  useEffect(() => {
    setEngineError(null);
  }, [engineConfig.type, engineConfig.url]);

  const quotationResultRef = useRef<QuotationAnalysisResponse | null>(null);

  const {
    resolveTaskId,
    setLocalTaskId,
    banner: quotationWaitingBanner,
    hasActiveTask,
    clearResults,
  } = useAnalysisFeature<QuotationAnalysisResponse>({
    analysisType: 'quotation_analysis',
    taskType: 'quotation',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    resultRef: quotationResultRef,
    fetchResult: async (taskId, headers) =>
      textApi.getQuotationTaskResult(taskId, headers),
    fetchRequest: async (taskId, headers) =>
      textApi.getQuotationTaskRequest(taskId, headers),
    onResultFetched: (result, _taskId) => {
      if (!result) return;
      const targetNode =
        (isLocked && lockedNodesSnapshot.length ? lockedNodesSnapshot[0] as WorkspaceNodeLike : displayedNodes[0]);
      const nodeId = targetNode ? getNodeIdentifier(targetNode, 0) : '';
      const selection = activeSelections.find((s) => s.nodeId === nodeId);
      const column = selection?.column ?? '';
      applyContextLengthPreferenceFromResult(result);
      if (nodeId && column) {
        updateResultState(nodeId, column, result);
      }
      setHasLoaded(true);
    },
    onHydratedResult: async (resultPayload) => {
      const res = resultPayload;
      if (!res) return;
      const selection = nodeColumnSelections[0];
      const nodeId = selection?.nodeId ?? '';
      const column = selection?.column ?? '';
      if (!nodeId) return;
      applyContextLengthPreferenceFromResult(res);
      updateResultState(nodeId, column, res);
      setHasLoaded(true);
    },
    onHydratedRequest: async (requestPayload) => {
      const requestData = ((requestPayload as Record<string, unknown>)?.data ?? requestPayload) as Record<string, unknown> | null;
      if (!requestData) return;
      const nodeId = String(requestData?.node_id || requestData?.nodeId || '');
      const column = String(requestData?.column || '');
      const reqEngine = (requestData?.engine ?? null) as QuotationEngineConfig | null;
      if (!nodeId) return;
      if (reqEngine?.type === 'remote') {
        const trimmed = (reqEngine.url ?? '').trim();
        if (trimmed.length) {
          const { normalized, valid } = normalizeRemoteUrl(trimmed);
          const appliedUrl = valid ? normalized : trimmed;
          updateRemoteUrl(appliedUrl);
          setEngineConfigStore({ type: 'remote', url: appliedUrl });
        }
      } else if (reqEngine?.type === 'local') {
        setEngineConfigStore({ type: 'local' });
      }
      setNodeColumnSelections([{ nodeId, column }], { replace: true });
      setSelectedMetadataColumns([]);
      const matPath = requestData.materialized_path;
      if (typeof matPath === 'string' && matPath) {
        setMaterializedPaths(prev => ({ ...prev, [nodeId]: matPath }));
      }
      const matSummary = requestData.materialize_summary as Record<string, unknown> | undefined;
      if (matSummary) {
        setMaterializeSummary({
          recordCount: Number(matSummary.record_count) || 0,
          uniqueDocuments: Number(matSummary.unique_documents_with_hits) || 0,
          totalDocuments: Number(matSummary.total_source_documents) || 0,
        });
      }
      try {
        await restoreAnalysisLockFromRequest({
          workspaceId: currentWorkspaceId,
          requestData: {
            node_ids: [nodeId],
            node_columns: column ? { [nodeId]: column } : {},
          },
          getAuthHeaders,
          lockWithSnapshots,
          queryClient,
          maxNodes: 1,
        });
      } catch {
        /* ignore */
      }
    },
    onCleared: () => {
      setIsClearing(false);
      setHasLoaded(false);
      setResultsByNode({});
      setNodeState({});
      setMaterializeSummary(null);
      resetAnalysisSelectionAfterClear({ unlockSelection });
    },
  });

  const applyContextLengthPreferenceFromResult = (payload: QuotationAnalysisResponse | Record<string, unknown>) => {
    const prefs = payload?.preferences as Record<string, unknown> | undefined;
    const prefValue = Number(prefs?.context_length ?? prefs?.contextLength);
    if (!Number.isFinite(prefValue)) {
      return;
    }
    const normalized = clampContextLength(prefValue);
    setContextLength(normalized);
    setContextLengthInput(String(normalized));
  };

  const applyContextLengthInput = async () => {
    const trimmed = contextLengthInput.trim();
    if (!trimmed.length) {
      setContextLengthError('Enter a non-negative number.');
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setContextLengthError('Enter a non-negative number.');
      return;
    }
    const normalized = clampContextLength(parsed);
    setContextLength(normalized);
    setContextLengthInput(String(normalized));
    setContextLengthError(null);

    const shouldPersist = Boolean(hasLoaded && currentWorkspaceId && normalized !== contextLength);
    if (!shouldPersist) {
      return;
    }

    try {
      setIsSavingContextLength(true);
      await persistContextLengthPreference(normalized);
    } catch (error) {
      console.error('Failed to save context length preference', error);
      setContextLengthError('Failed to save preference. Please try again.');
    } finally {
      setIsSavingContextLength(false);
    }
  };

  const handleContextLengthBlur = () => {
    void applyContextLengthInput();
  };

  const handleContextLengthKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void applyContextLengthInput();
    }
  };

  const hasIncompleteSelections = !displayedNodes.length || displayedNodes.some((node, idx) => {
    const nodeId = getNodeIdentifier(node, idx);
    const selection = activeSelections.find((sel) => sel.nodeId === nodeId);
    return !selection || !selection.column;
  });

  const canRunQuotation =
    Boolean(currentWorkspaceId)
    && displayedNodes.length > 0
    && !hasIncompleteSelections
    && engineReady
    && !quotationLanguageUnsupported;

  // Per-node pagination and sorting state
  const [nodeState, setNodeState] = useState<Record<string, NodePaginationState>>({});
  // Deprecated per-node loading indicator; rely on DataView-like UX
  const [nodeDetaching, setNodeDetaching] = useState<Record<string, boolean>>({});
  const [nodeMaterializing, setNodeMaterializing] = useState<Record<string, boolean>>({});
  const [materializeTaskIds, setMaterializeTaskIds] = useState<Record<string, string>>({});
  const [materializedPaths, setMaterializedPaths] = useState<Record<string, string>>({});
  const [materializeSummary, setMaterializeSummary] = useState<{ recordCount: number; uniqueDocuments: number; totalDocuments: number } | null>(null);
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [pendingDetachNodeId, setPendingDetachNodeId] = useState<string | null>(null);
  const [detachNodeOptions, setDetachNodeOptions] = useState<DetachDialogNodeOption[]>([]);
  const {
    selectedDetachColumns,
    setSelectedDetachColumns,
    toggleDetachColumn,
    selectAllDetachColumns,
    deselectAllDetachColumns,
  } = useDetachColumnsState(detachNodeOptions);
  const [resultsByNode, setResultsByNode] = useState<Record<string, QuotationResultState>>({});

  const hasParamsChanged = hasLockedParameterDiff({
    isLocked,
    serverRequest: (serverRequest as Record<string, unknown> | null) ?? null,
    currentParams: {
      engine_type: resolvedEnginePayload.type,
      engine_url:
        resolvedEnginePayload.type === 'remote' && resolvedEnginePayload.isValid
          ? resolvedEnginePayload.normalizedUrl
          : null,
    },
    getServerParams: (request) => {
      const { type: serverEngineType, url: serverEngineUrl } = getServerEngineConfig(
        request,
        (url) => normalizeRemoteUrl(url).normalized
      );

      return {
        engine_type: serverEngineType,
        engine_url: serverEngineType === 'remote' ? (serverEngineUrl || null) : null,
      };
    },
  });

  const actionState = getAnalysisActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    hasSelection: displayedNodes.length > 0,
    isLocked,
    hasResults: hasLoaded,
    isBusy: isLoadingQuotations,
    hasActiveTask,
    allowRunWhenLocked: hasParamsChanged,
  });

  useEffect(() => {
    if (isLocked) return;
    if (!selectedNodes.length) {
      if (nodeColumnSelections.length) {
        setNodeColumnSelections([], { replace: true, persist: false });
      }
      return;
    }
    if (nodeColumnSelections.length === 0) {
      recomputeAutoColumns();
    }
  }, [isLocked, selectedNodes, nodeColumnSelections, recomputeAutoColumns, setNodeColumnSelections]);

  const handleColumnChange = (nodeId: string, column: string) => {
    if (isLocked) return;
    setNodeColumnSelection(nodeId, column);
  };

  const [hoverState, setHoverState] = useState<QuotationHoverState | null>(null);

  const buildQuotationResultState = (result: QuotationAnalysisResponse, column: string): QuotationResultState => {
    const groupedRows = result.data;
    const rows = flattenQuotationGroups(groupedRows).map((row) => {
      const spans: { start: number; end: number; type: string }[] = [];
      const addSpan = (start?: unknown, end?: unknown, type?: string) => {
        if (!type) return;
        const s = Number(start);
        const e = Number(end);
        if (Number.isFinite(s) && Number.isFinite(e) && s < e) {
          spans.push({ start: s, end: e, type });
        }
      };
      addSpan(row?.[QUOTATION_COLUMN_KEYS.speakerStartIdx], row?.[QUOTATION_COLUMN_KEYS.speakerEndIdx], 'speaker');
      addSpan(row?.[QUOTATION_COLUMN_KEYS.quoteStartIdx], row?.[QUOTATION_COLUMN_KEYS.quoteEndIdx], 'quote');
      addSpan(row?.[QUOTATION_COLUMN_KEYS.verbStartIdx], row?.[QUOTATION_COLUMN_KEYS.verbEndIdx], 'verb');
      return { ...row, __spans: spans };
    }) as QuotationDisplayRow[];

    const metadata = result.metadata;
    const columns = metadata.all_columns.slice();
    const pagination = result.pagination;
    const sorting = result.sorting;

    return {
      groupedRows,
      rows,
      columns,
      metadata,
      pagination,
      sorting,
      column,
    };
  };

  const updateResultState = (nodeId: string, column: string, result: QuotationAnalysisResponse): QuotationResultState => {
    const normalized = buildQuotationResultState(result, column);
    setResultsByNode((prev) => ({ ...prev, [nodeId]: normalized }));
    setNodeState((prev) => ({
      ...prev,
      [nodeId]: {
        currentPage: normalized.pagination.page,
        pageSize: normalized.pagination.page_size,
        sortBy: normalized.sorting.sort_by ?? undefined,
        descending: normalized.sorting.descending,
      },
    }));
    return normalized;
  };

  const {
    buildEngineRequest,
    persistContextLengthPreference,
    handleSearchAll,
    handlePageChange,
    handlePageSizeChange,
    handleSort,
    handleDetach,
    handleMaterialize,
  } = useQuotationTaskFlow({
    state: {
      currentWorkspaceId,
      isLocked,
      hasLoaded,
      lockedNodesSnapshot: lockedNodesSnapshot as WorkspaceNodeLike[],
      displayedNodes,
      activeSelections,
      nodeState,
      originalColumnsByNode,
      resolvedEnginePayload,
      engineConfigUrl: engineConfig.url ?? '',
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
  });

  // Watch quotation_materialize task status: on success, refresh the parent
  // request to learn materialized_path, reset page_size to the default 20,
  // and refetch the current page (which now slices from the cached parquet
  // with occurrence-row semantics).
  const handleQuotationMaterializeSuccess = useCallback(async (nodeId: string, _taskId: string) => {
    void _taskId;
    try {
      const headers = getAuthHeaders();
      const parentTaskId = await resolveTaskId();
      if (parentTaskId) {
        const req = await textApi.getQuotationTaskRequest(parentTaskId, headers);
        const reqObj = (req as Record<string, unknown>) ?? {};
        const path = typeof reqObj.materialized_path === 'string'
          ? (reqObj.materialized_path as string)
          : null;
        if (path) {
          setMaterializedPaths((prev) => ({ ...prev, [nodeId]: path }));
        }
        const summary = reqObj.materialize_summary as Record<string, unknown> | undefined;
        if (summary) {
          setMaterializeSummary({
            recordCount: Number(summary.record_count) || 0,
            uniqueDocuments: Number(summary.unique_documents_with_hits) || 0,
            totalDocuments: Number(summary.total_source_documents) || 0,
          });
        }
      }
    } catch (error) {
      console.warn('Failed to refresh quotation task request after materialize', error);
    }

    try {
      handlePageSizeChange(20);
    } catch (error) {
      console.warn('Failed to reset quotation page size after materialize', error);
    }
  }, [getAuthHeaders, resolveTaskId, handlePageSizeChange]);

  useMaterializeLifecycle({
    taskType: 'quotation_materialize',
    materializeTaskIds,
    setNodeMaterializing,
    setMaterializeTaskIds,
    onTerminalSuccess: handleQuotationMaterializeSuccess,
  });

  const handleEngineDialogSave = () => {
    const payload = buildEngineRequest();
    if (!payload) {
      return;
    }
    closeEngineDialog();
  };

  const openDetachDialog = async (nodeId: string) => {
    const selection = activeSelections.find((item) => item.nodeId === nodeId);
    if (!selection?.column) return;

    try {
      const response = await textApi.getQuotationDetachOptions(
        nodeId,
        selection.column,
        getAuthHeaders(),
      );
      const nodes = response.data?.nodes ?? [];
      const initialSelections: Record<string, string[]> = {};
      nodes.forEach((node) => {
        initialSelections[node.node_id] = [];
      });
      setPendingDetachNodeId(nodeId);
      setDetachNodeOptions(nodes);
      setSelectedDetachColumns(initialSelections);
      setDetachDialogOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load quotation detach options';
      showErrorDialog(message);
    }
  };

  const handleDetachConfirm = async () => {
    if (!pendingDetachNodeId) return;
    const selectedColumns = selectedDetachColumns[pendingDetachNodeId] || [];
    await handleDetach(pendingDetachNodeId, selectedColumns, materializedPaths[pendingDetachNodeId] ?? null);
    setDetachDialogOpen(false);
    setPendingDetachNodeId(null);
    setDetachNodeOptions([]);
    setSelectedDetachColumns({});
  };

  const handleRunOrUpdate = async () => {
    await executeAnalysisRunOrUpdate({
      hasLockedParameterChanges: hasParamsChanged,
      clearResults,
      runFreshAnalysis: handleSearchAll,
    });
  };

  const quotationMetadataColumns = (() => {
    const nodeId = displayedNodes[0] ? getNodeIdentifier(displayedNodes[0], 0) : '';
    if (!nodeId) {
      return [] as string[];
    }

    const resultState = resultsByNode[nodeId];
    if (!resultState) {
      return [] as string[];
    }

    const baseColumns = resultState.metadata.metadata_columns.filter((column) => !column.startsWith('__'));
    const generatedMetadataColumns = [
      QUOTATION_COLUMN_KEYS.quote,
      QUOTATION_COLUMN_KEYS.speaker,
      QUOTATION_COLUMN_KEYS.speakerStartIdx,
      QUOTATION_COLUMN_KEYS.speakerEndIdx,
      QUOTATION_COLUMN_KEYS.quoteStartIdx,
      QUOTATION_COLUMN_KEYS.quoteEndIdx,
      QUOTATION_COLUMN_KEYS.verb,
      QUOTATION_COLUMN_KEYS.verbStartIdx,
      QUOTATION_COLUMN_KEYS.verbEndIdx,
      QUOTATION_COLUMN_KEYS.quoteType,
      QUOTATION_COLUMN_KEYS.quoteTokenCount,
      QUOTATION_COLUMN_KEYS.isFloatingQuote,
      QUOTATION_COLUMN_KEYS.quoteRowIdx,
    ].filter((column) => resultState.metadata.quotation_columns.includes(column));

    return Array.from(new Set([...baseColumns, ...generatedMetadataColumns]));
  })();
  // No auto-selection: only honour columns the user has explicitly picked,
  // filtered against the columns currently available from the result.
  const resolvedMetadataColumns = selectedMetadataColumns.filter((column) =>
    quotationMetadataColumns.includes(column),
  );

  return (
    <>
      <Dialog open={engineDialogOpen} onOpenChange={setEngineDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Quotation Engine</DialogTitle>
            <DialogDescription>Select which engine to use when extracting quotations.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="quotation-engine-type" className="text-sm font-medium">Engine Source</label>
              <Select
                value={engineConfig.type}
                onValueChange={(value) => {
                  const next = value as QuotationEngineType;
                  if (next === 'remote') {
                    const url = lastRemoteUrl || engineConfig.url || '';
                    setEngineConfigStore({ type: 'remote', url });
                  } else {
                    setEngineConfigStore({ type: 'local' });
                  }
                }}
              >
                <SelectTrigger id="quotation-engine-type">
                  <SelectValue placeholder="Choose engine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local (built-in)</SelectItem>
                  <SelectItem value="remote">Remote service</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {engineConfig.type === 'remote' ? (
              <div className="space-y-2">
                <label htmlFor="quotation-engine-url" className="text-sm font-medium">Service URL</label>
                <Input
                  id="quotation-engine-url"
                  value={engineConfig.url ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    updateRemoteUrl(value);
                    if (engineConfig.type !== 'remote') {
                      setEngineConfigStore({ type: 'remote', url: value });
                    }
                  }}
                  placeholder="https://example.com/api/v1/quotation"
                  autoComplete="off"
                />
                {engineError ? (
                  <p className="text-sm text-destructive">{engineError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Include protocol and point to the remote quotation extractor base URL.</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">The local extractor runs inside this workspace; no extra configuration required.</p>
            )}
          </div>
          <DialogFooter className="sm:justify-end">
            <Button variant="outline" onClick={closeEngineDialog}>Cancel</Button>
            <Button
              onClick={handleEngineDialogSave}
              disabled={engineConfig.type === 'remote' && !(engineConfig.url ?? '').trim().length}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="space-y-4">
        <AnalysisCardLayout
          title="Quotation Extraction"
          info={{
            targetKey: 'quotation.overview',
            label: 'About Quotation Extraction',
            tooltip: 'Learn what quotation extraction is and how it can help you.',
          }}
          help={{
            targetKey: 'analysis.quotation.parameters',
            label: 'Quotation parameters',
            tooltip: 'Select a data block, choose a text column, and configure quotation settings.',
          }}
          headerActions={
            <div className="flex flex-col items-start gap-1 md:items-end md:text-right">
              <Badge
                variant="outline"
                className="max-w-full break-all text-xs"
                title={engineBadgeTitle}
              >
                {engineBadgeLabel}
              </Badge>
              {engineDisplayUrl.length ? (
                <span
                  className="text-xs text-muted-foreground break-all max-w-xs md:max-w-sm"
                  title={engineDisplayUrl}
                >
                  {engineDisplayUrl}
                </span>
              ) : null}
            </div>
          }
          actions={{
            onRun: () => {
              void handleRunOrUpdate();
            },
            onClear: async () => {
              if (!currentWorkspaceId) return;
              setIsClearing(true);
              await clearResults();
              setIsClearing(false);
            },
            runDisabled: actionState.runDisabled || !canRunQuotation,
            runDisabledReason: (() => {
              if (isLoadingQuotations) return undefined;
              if (actionState.runDisabledReason) return actionState.runDisabledReason;
              if (hasIncompleteSelections) return 'Select a column for each data block';
              if (!engineReady) return 'Configure the remote engine before running';
              if (quotationLanguageDisabledReason) return quotationLanguageDisabledReason;
              return undefined;
            })(),
            clearDisabled: actionState.clearDisabled || isClearing,
            isRunning: isLoadingQuotations,
            isClearing,
            hasResult: hasLoaded,
            runLabel: actionState.runLabel,
            clearHelp: {
              targetKey: 'analysis.quotation.clear-results',
              label: 'Clear results',
            },
            extraContent: (
              <PageSizeSelect
                value={
                  nodeState[displayedNodes[0] ? getNodeIdentifier(displayedNodes[0], 0) : '']?.pageSize
                  ?? DEFAULT_PAGE_SIZE
                }
                onChange={handlePageSizeChange}
              />
            ),
          }}
        >
          <NodeSelectionPanel
            selectedNodes={displayedNodes}
            nodeColumnSelections={activeSelections}
            onColumnChange={handleColumnChange}
            nodeColors={nodeColors}
            onColorChange={handleColorChange}
            getNodeColumns={getColumnInfos}
            defaultPalette={defaultPalette}
            maxCompare={1}
            className="border border-dashed border-muted-foreground/40 rounded-lg bg-muted/30 p-4"
            showShape
            showColorPicker
            disabled={!!isLocked}
            locked={!!isLocked}
            originalCount={displayNodeCount}
            allowedDataTypes={['string']}
            lockedMessage={ANALYSIS_LOCKED_MESSAGE}
          />
        </AnalysisCardLayout>
        {quotationWaitingBanner && (
          <AnalysisTaskBanner
            analysisName="Quotation"
            status={quotationWaitingBanner.status}
            taskId={quotationWaitingBanner.taskId}
            message={quotationWaitingBanner.message}
            className="mt-4"
          />
        )}

        {hasLoaded && displayedNodes.length > 0 && (
          <Card>
            <CardHeader className="space-y-4">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  Search Results
                  <HelpIcon
                    targetKey="analysis.quotation.results"
                    label="Quotation results"
                    tooltip="Review extracted quotations, toggle metadata, and adjust context length."
                  />
                </CardTitle>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-4">
                  <MetadataColumnSelector
                    availableColumns={quotationMetadataColumns}
                    selectedColumns={resolvedMetadataColumns}
                    onSelectedColumnsChange={setSelectedMetadataColumns}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="quotation-context-length"
                        className="text-sm font-medium text-foreground"
                      >
                        Context length (words per side)
                      </label>
                      <HelpIcon targetKey="analysis.quotation.context-length" label="Quotation context length" />
                    </div>
                    <Input
                      id="quotation-context-length"
                      aria-label="Context length in words"
                      type="number"
                      min={0}
                      max={MAX_CONTEXT_LENGTH}
                      step={1}
                      value={contextLengthInput}
                      onChange={(event) => {
                        setContextLengthInput(event.target.value);
                        if (contextLengthError) setContextLengthError(null);
                      }}
                      onBlur={handleContextLengthBlur}
                      onKeyDown={handleContextLengthKeyDown}
                      className="h-9 w-24 text-right"
                      inputMode="numeric"
                      disabled={isSavingContextLength}
                    />
                    {isSavingContextLength && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Saving…</span>
                      </div>
                    )}
                  </div>
                </div>
                <span className={`text-xs ${contextLengthError ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {contextLengthError ?? `Enter a whole number between 0 and ${MAX_CONTEXT_LENGTH}.`}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-8">
              {displayedNodes.map((node, idx) => {
                const nodeId = getNodeIdentifier(node, idx);
                const selection = activeSelections.find((s) => s.nodeId === nodeId);
                const textCol = selection?.column || '';

                const resultState = resultsByNode[nodeId];
                const rowsWithQuotes = (resultState?.rows ?? []).filter((row) => row?.[QUOTATION_COLUMN_KEYS.quote]);
                const visibleMetadataColumns = showMetadata ? resolvedMetadataColumns : [];

                const cols = (() => {
                  const ordered: string[] = [QUOTATION_DOCUMENT_COLUMN];
                  if (showMetadata) {
                    ordered.push(...visibleMetadataColumns);
                  }
                  return Array.from(new Set(ordered));
                })();

                return (
                  <section key={nodeId} className="space-y-4">
                    <div className="border-b border-border/60 pb-4">
                      <p className="text-sm text-muted-foreground">
                        Text column: {textCol || 'Select a text column to view highlighted quotations.'}
                      </p>
                    </div>

                    <div className="rounded-lg border border-border bg-card">
                      <AnalysisTableScrollArea
                        maxHeightClass="max-h-[70vh]"
                        contentClassName="min-w-max h-full"
                      >
                          <Table className="min-w-full text-sm" disableContainer>
                            <TableHeader className="bg-muted sticky top-0 z-10">
                              <TableRow className="border-b border-border/60">
                                {cols.map((c: string) => {
                                  const sortable = Boolean(resultState?.metadata.metadata_columns.includes(c));
                                  const active = resultState?.sorting?.sort_by === c;
                                  return (
                                    <TableHead
                                      key={c}
                                      className={`h-10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/90 select-none whitespace-nowrap ${sortable ? 'cursor-pointer' : 'cursor-default opacity-75'}`}
                                      onClick={sortable ? () => handleSort(nodeId, c) : undefined}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span>{c}</span>
                                        {sortable && (
                                          <ArrowUpDown className={`h-3 w-3 ${active ? 'text-foreground' : 'opacity-60'}`} />
                                        )}
                                      </div>
                                    </TableHead>
                                  );
                                })}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {rowsWithQuotes.length === 0 ? (
                                <TableRow>
                                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={cols.length || 1}>
                                    No quotations found on this page. Source rows without quotations are omitted.
                                  </TableCell>
                                </TableRow>
                              ) : (
                                rowsWithQuotes.map((row, rowIdx: number) => (
                                  <TableRow
                                    key={rowIdx}
                                    className="border-b border-border/60 last:border-b-0 hover:bg-muted/40 cursor-pointer"
                                    onClick={() => {
                                      const record = { ...row };
                                      const rawFullText = record[textCol];
                                      const fullText = rawFullText == null ? undefined : String(rawFullText);
                                      const quotationGeneratedCols = Object.values(QUOTATION_COLUMN_KEYS);
                                      openRowDetail({
                                        record,
                                        textColumn: textCol,
                                        fullText,
                                        excludeMetadataColumns: [...quotationGeneratedCols, '__spans'],
                                      });
                                    }}
                                  >
                                    {cols.map((c: string, cellIdx: number) => {
                                      const val = c === QUOTATION_DOCUMENT_COLUMN ? row?.[textCol] : row?.[c];
                                      const cellKey = `${nodeId}:${rowIdx}:${cellIdx}`;
                                      const shouldHighlight = Boolean(textCol) && c === QUOTATION_DOCUMENT_COLUMN;
                                      const content = shouldHighlight
                                        ? (
                                          <QuotationHighlightedCell
                                            text={typeof val === 'string' ? val : String(val ?? '')}
                                            row={row}
                                            cellKey={cellKey}
                                            contextLength={contextLength}
                                            hoverState={hoverState}
                                            onHoverChange={setHoverState}
                                          />
                                        )
                                        : val !== undefined && val !== null
                                        ? String(val)
                                        : '';
                                      return (
                                        <TableCell
                                          key={cellIdx}
                                          className="px-4 py-3 align-top text-sm leading-relaxed"
                                        >
                                          {content}
                                        </TableCell>
                                      );
                                    })}
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                      </AnalysisTableScrollArea>
                    </div>

                    <AnalysisPagination
                      page={resultState?.pagination?.page ?? 1}
                      pageSize={resultState?.pagination?.page_size ?? DEFAULT_PAGE_SIZE}
                      hasNext={resultState?.pagination?.has_next ?? false}
                      hasPrev={resultState?.pagination?.has_prev ?? ((resultState?.pagination?.page ?? 1) > 1)}
                      totalPages={resultState?.pagination?.total_source_pages}
                      onPageChange={(newPage) => handlePageChange(newPage)}
                      pageSizeSummary={materializedPaths[nodeId] && materializeSummary
                        ? <GroupedResultsPageSizeSummary groups={[]} totalInstances={materializeSummary.recordCount} totalDocuments={materializeSummary.uniqueDocuments} totalProcessed={materializeSummary.totalDocuments} />
                        : <GroupedResultsPageSizeSummary groups={resultState?.groupedRows ?? []} totalProcessed={resultState?.pagination?.page_size} />
                      }
                    >
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void handleMaterialize(nodeId)}
                        disabled={
                          Boolean(nodeMaterializing[nodeId])
                          || Boolean(materializedPaths[nodeId])
                          || Boolean(nodeDetaching[nodeId])
                        }
                        className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
                        title="Cache all occurrence rows to disk so subsequent pagination and Add-to-Workspace reuse them"
                      >
                        {nodeMaterializing[nodeId] ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Processing…
                          </>
                        ) : materializedPaths[nodeId] ? (
                          <>Processed</>
                        ) : (
                          <>Process All</>
                        )}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void openDetachDialog(nodeId)}
                        disabled={Boolean(nodeDetaching[nodeId])}
                        className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
                      >
                        {nodeDetaching[nodeId] ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Adding to Workspace…
                          </>
                        ) : (
                          <>
                            <Plus className="mr-2 h-4 w-4" />
                            Add to Workspace
                          </>
                        )}
                      </Button>
                    </AnalysisPagination>
                  </section>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={errorDialogOpen} onOpenChange={setErrorDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quotation Error</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap wrap-break-word">
              {errorDialogMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setErrorDialogOpen(false)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <QuotationDetachDialog
        open={detachDialogOpen}
        onOpenChange={setDetachDialogOpen}
        isDetaching={Boolean(pendingDetachNodeId && nodeDetaching[pendingDetachNodeId])}
        detachNodeOptions={detachNodeOptions}
        selectedDetachColumns={selectedDetachColumns}
        toggleDetachColumn={toggleDetachColumn}
        selectAllDetachColumns={selectAllDetachColumns}
        deselectAllDetachColumns={deselectAllDetachColumns}
        handleDetachConfirm={handleDetachConfirm}
      />

      <RowDetailPanel
        open={detailOpen}
        onOpenChange={setDetailOpen}
        payload={detailPayload}
        customization={detailPayload ? {
          label: 'Quotation',
          summaryFields: [
            {
              label: 'Quote Type',
              value: String(detailPayload.record[QUOTATION_COLUMN_KEYS.quoteType] ?? ''),
            },
            {
              label: 'Speaker',
              value: String(detailPayload.record[QUOTATION_COLUMN_KEYS.speaker] ?? ''),
            },
            {
              label: 'Verb',
              value: String(detailPayload.record[QUOTATION_COLUMN_KEYS.verb] ?? ''),
            },
            {
              label: 'Quote',
              value: String(detailPayload.record[QUOTATION_COLUMN_KEYS.quote] ?? ''),
            },
          ],
          renderDocumentText: (text, record) => renderQuotationDetailText(text, record),
        } : undefined}
      />
    </>
  );
};

export default QuotationFeature;
