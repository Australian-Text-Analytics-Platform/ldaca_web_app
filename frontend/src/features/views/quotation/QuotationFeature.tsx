import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  quotationDetachOptions,
  quotationTaskRequest,
  quotationTaskResult,
} from '@/api/generated/sdk.gen';
import type {
  QuotationAnalysisResponse,
  QuotationEngineConfigInput,
  QuotationEngineType,
  QuotationMetadata,
} from '@/api/generated/types.gen';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';

import NodeSelectionPanel from '@/features/views/common/components/NodeSelectionPanel';
import { ANALYSIS_LOCKED_MESSAGE } from '@/features/views/common/components/AnalysisLockedNotice';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useUIStore } from '@/stores/uiStore';
import AnalysisTaskBanner from '@/features/views/common/components/AnalysisTaskBanner';
import useNodeColumnInfos from '@/features/workspace/common/hooks/useNodeColumnInfos';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { AnalysisTableScrollArea } from '@/features/views/common/components/AnalysisTableScrollArea';
import { ArrowUpDown, Loader2, Plus } from 'lucide-react';
import { takeMostRecent } from '@/features/workspace/common/utils/selectionUtils';
import {
  getNodeIdentifier,
  getServerEngineConfig,
  hasLockedParameterDiff,
  resetAnalysisSelectionAfterClear,
  restoreAnalysisLockFromRequest,
  useAnalysisLock,
  useAnalysisFeature,
  useNodeColorManagement,
  getAnalysisActionState,
  executeAnalysisRunOrUpdate,
  type NodePaginationState,
  type WorkspaceNodeLike,
} from '../common';

import { AnalysisPagination } from '@/features/views/common/components/AnalysisPagination';
import { useMaterializeLifecycle } from '../common/hooks/useMaterializeLifecycle';
import { useQuotationTaskFlow } from './hooks/useQuotationTaskFlow';
import { QUOTATION_COLUMN_KEYS, QUOTATION_DOCUMENT_COLUMN } from '../common/generatedColumns';
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
import type { DetachDialogNodeOption } from '../common/components/DetachColumnsDialog';
import { MetadataColumnSelector } from '../common/components/MetadataColumnSelector';
import { GroupedResultsPageSizeSummary } from '../common/components/GroupedResultsPageSizeSummary';
import { AnalysisCardLayout } from '../common/components/AnalysisCardLayout';
import { PAGE_SIZE_OPTIONS_DEFAULT } from '../common/constants';
import { useDetachColumnsState } from '../common/hooks/useDetachColumnsState';
import { RowDetailPanel } from '../common/components/RowDetailPanel';
import { useRowDetailDialog } from '../common/components/useRowDetailDialog';
import { renderQuotationDetailText } from './components/quotationDetailText';
import { usePersistNodeDocumentColumn } from '../common/hooks/usePersistNodeDocumentColumn';

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
type QuotationEngineConfig = QuotationEngineConfigInput;
type QuotationHitRow = Record<string, unknown>;
type QuotationGroupedRow = QuotationHitRow[];

type QuotationDisplayRow = QuotationHitRow & {
  __spans: { start: number; end: number; type: string }[];
};

/** Normalize a ``QuotationAnalysisResponse`` into the result-state
 * shape the table view consumes. Hoisted to module scope so the task
 * hydration flow can share it with result-fetch handlers without
 * closing over component state. */
/**
 * Called by: QuotationFeature analysis panel as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
 * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 */
function buildQuotationResultState(
  result: QuotationAnalysisResponse,
  column: string,
): QuotationResultState {
  const groupedRows = result.data;
  const rows = groupedRows
    .flatMap((group) => group)
    .map((row) => {
      const spans: { start: number; end: number; type: string }[] = [];
      // Collects backend span offsets into the display row shape used by highlighted cells.
      /**
       * Called by: buildQuotationResultState during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
       */
      const addSpan = (start?: unknown, end?: unknown, type?: string) => {
        if (!type) return;
        const s = Number(start);
        const e = Number(end);
        if (Number.isFinite(s) && Number.isFinite(e) && s < e) {
          spans.push({ start: s, end: e, type });
        }
      };
      addSpan(
        row?.[QUOTATION_COLUMN_KEYS.speakerStartIdx],
        row?.[QUOTATION_COLUMN_KEYS.speakerEndIdx],
        'speaker',
      );
      addSpan(
        row?.[QUOTATION_COLUMN_KEYS.quoteStartIdx],
        row?.[QUOTATION_COLUMN_KEYS.quoteEndIdx],
        'quote',
      );
      addSpan(
        row?.[QUOTATION_COLUMN_KEYS.verbStartIdx],
        row?.[QUOTATION_COLUMN_KEYS.verbEndIdx],
        'verb',
      );
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
}

/** Renders the quotation extraction workflow, including live runs and result materialisation. */
/**
 * Rendered by: QuotationTabbedFeature, which mounts one instance per analysis tab and feeds it tab props.
 * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 *
 * Tab props: ``tabId`` identifies the active tab, ``tabTaskId`` seeds
 * deterministic hydration of that tab's task, and ``onTabTaskChange`` reports
 * task id assignment/clear back to the tab record.
 */
export interface QuotationFeatureProps {
  tabId?: string;
  tabTaskId?: string | null;
  onTabTaskChange?: (taskId: string | null) => void;
}

function QuotationFeature({ tabId, tabTaskId, onTabTaskChange }: QuotationFeatureProps = {}) {
  const {
    selectedNodes,
    handlePageChange: baseHandlePageChange,
    handlePageSizeChange: baseHandlePageSizeChange,
  } = useWorkspaceSelection();
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
    panelSelectedNodes: livePanelSelectedNodes,
    displayNodeCount,
    serverRequest,
  } = useAnalysisLock({
    analysisType: 'quotation_analysis',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    // Tab-scoped locking: bind the lock to this tab's persisted task. Null for a
    // fresh tab that has not run yet (unlocked).
    taskId: tabTaskId ?? null,
    allowedDataTypes: ['string'],
    maxNodes: 1,
    docTypeOnly: true,
  });
  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
  });

  const engineConfig = usePreferencesStore((state) => state.quotationEngine);
  const lastRemoteUrl = usePreferencesStore((state) => state.quotationLastRemoteUrl);
  const setEngineConfigStore = usePreferencesStore((state) => state.setQuotationEngine);
  const updateRemoteUrl = usePreferencesStore((state) => state.updateQuotationRemoteUrl);
  const [engineError, setEngineError] = useState<string | null>(null);
  const engineDialogOpen = useUIStore((state) => state.modals.quotationEngine);
  const setEngineDialogOpen = useUIStore((state) => state.setModalOpen);
  const openModal = useUIStore((state) => state.openModal);
  const closeModal = useUIStore((state) => state.closeModal);
  const openEngineDialog = () => openModal('quotationEngine');
  const closeEngineDialog = () => closeModal('quotationEngine');
  const [selectedMetadataColumns, setSelectedMetadataColumns] = useState<string[]>([]);
  // Metadata visibility derives from the selected columns: any selection
  // shows the corresponding metadata columns in the results table.
  const showMetadata = selectedMetadataColumns.length > 0;
  const [liveHasLoaded, setHasLoaded] = useState(false);
  const [isLoadingQuotations, setIsLoadingQuotations] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [contextLengthInput, setContextLengthInput] = useState(String(DEFAULT_CONTEXT_LENGTH));
  const [contextLength, setContextLength] = useState(DEFAULT_CONTEXT_LENGTH);
  const [contextLengthError, setContextLengthError] = useState<string | null>(null);
  const [isSavingContextLength, setIsSavingContextLength] = useState(false);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorDialogMessage, setErrorDialogMessage] = useState<string>('');
  const {
    detailPayload,
    detailOpen,
    setDetailOpen,
    openDetail: openRowDetail,
  } = useRowDetailDialog();

  const panelSelectedNodes = livePanelSelectedNodes;

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: panelSelectedNodes,
  });

  const activeSelections = useMemo(() => {
    return isLocked ? activeNodeColumnSelections : nodeColumnSelections;
  }, [isLocked, activeNodeColumnSelections, nodeColumnSelections]);

  const displayedNodes = takeMostRecent(panelSelectedNodes, 1);
  const activeNodeIds = displayedNodes
    .map((node, idx) => getNodeIdentifier(node, idx))
    .filter((id): id is string => Boolean(id));
  // ``tabKey`` routes colour changes through this tab's temp layer —
  // see the node-colour strategy doc. ``promoteTempColors`` is called
  // from ``handleRunOrUpdate`` below to commit the preview on Run.
  const {
    nodeColors: liveNodeColors,
    handleColorChange,
    defaultPalette,
    promoteTempColors,
  } = useNodeColorManagement({
    activeNodeIds,
    tabKey: 'quotation',
  });
  const nodeColors: Record<string, string> = liveNodeColors;

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

  const engineReady = resolvedEnginePayload.type === 'local' ? true : resolvedEnginePayload.isValid;

  const engineBadgeLabel =
    resolvedEnginePayload.type === 'remote'
      ? resolvedEnginePayload.isValid
        ? 'Remote Engine'
        : 'Remote Engine • Not configured'
      : 'Local Engine';

  const engineBadgeTitle =
    resolvedEnginePayload.type === 'remote'
      ? resolvedEnginePayload.isValid && resolvedEnginePayload.normalizedUrl.length
        ? `Remote Engine • ${resolvedEnginePayload.normalizedUrl}`
        : 'Remote Engine • Not configured'
      : 'Local Engine';

  const engineDisplayUrl =
    resolvedEnginePayload.type === 'remote'
      ? resolvedEnginePayload.isValid && resolvedEnginePayload.normalizedUrl.length
        ? resolvedEnginePayload.normalizedUrl
        : resolvedEnginePayload.rawUrl
      : '';

  // Opens the shared error dialog with a fallback message for unexpected quotation failures.
  /**
   * Called by: QuotationFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
   */
  const showErrorDialog = (message: string) => {
    setErrorDialogMessage(message || 'An unexpected error occurred.');
    setErrorDialogOpen(true);
  };

  useEffect(() => {
    void Promise.resolve().then(() => setEngineError(null));
  }, [engineConfig.type, engineConfig.url]);

  const quotationResultRef = useRef<QuotationAnalysisResponse | null>(null);

  const {
    resolveTaskId,
    setLocalTaskId,
    banner: quotationWaitingBanner,
    hasActiveTask,
    clearResults,
    stopTask,
    isStopping,
  } = useAnalysisFeature<QuotationAnalysisResponse>({
    analysisType: 'quotation_analysis',
    taskType: 'quotation',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    // Tab-driven deterministic hydration: the tab's persisted task id wins task
    // resolution over transient local state.
    hydrationTaskId: tabTaskId ?? null,
    resultRef: quotationResultRef,
    // Loads the latest quotation result for polling and task resumption.
    // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    fetchResult: async (taskId, headers) => {
      const { data } = await quotationTaskResult({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    // Retrieves the submitted quotation request so hydration can restore engine and selection state.
    // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    fetchRequest: async (taskId, headers) => {
      const { data } = await quotationTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    // Applies freshly fetched results to the active node table after lifecycle polling finishes.
    // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned. Flow: normalize inputs, derive state, then return the analysis result expected by callers.
    onResultFetched: (result, _taskId) => {
      if (!result) return;
      const targetNode =
        isLocked && lockedNodesSnapshot.length
          ? (lockedNodesSnapshot[0] as WorkspaceNodeLike)
          : displayedNodes[0];
      const nodeId = targetNode ? getNodeIdentifier(targetNode, 0) : '';
      const selection = activeSelections.find((s) => s.nodeId === nodeId);
      const column = selection?.column ?? '';
      applyContextLengthPreferenceFromResult(result);
      if (nodeId && column) {
        updateResultState(nodeId, column, result);
      }
      setHasLoaded(true);
    },
    // Rebuilds result state from a cached task payload when the quotation tab hydrates.
    // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    // eslint-disable-next-line @typescript-eslint/require-await
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
    // Restores saved request settings, materialization metadata, and the analysis lock after reload.
    // Called by: useAnalysisFeature hydration because quotation restores must reapply engine settings, selected node/column, materialized path, and context length before rendering results. Flow: unwrap request data, normalize remote engine state, restore selection/materialization, then lock the submitted node.
    onHydratedRequest: async (requestPayload) => {
      const requestData = ((requestPayload as Record<string, unknown>)?.data ??
        requestPayload) as Record<string, unknown> | null;
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
        setMaterializedPaths((prev) => ({ ...prev, [nodeId]: matPath }));
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
    // Clears quotation-specific state after the shared lifecycle deletes the task result.
    // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    onCleared: (_, options) => {
      setIsClearing(false);
      setHasLoaded(false);
      setResultsByNode({});
      setNodeState({});
      setMaterializeSummary(null);
      if (options?.preserveLocalState) {
        return;
      }
      // Detach the cleared task from the owning tab so a reload doesn't rehydrate
      // a task the user explicitly cleared.
      onTabTaskChange?.(null);
      resetAnalysisSelectionAfterClear({ unlockSelection });
    },
  });

  // Applies persisted context-length preferences returned with quotation task results.
  /**
   * Called by: QuotationFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   */
  const applyContextLengthPreferenceFromResult = (
    payload: QuotationAnalysisResponse | Record<string, unknown>,
  ) => {
    const prefs = payload?.preferences as Record<string, unknown> | undefined;
    const prefValue = Number(prefs?.context_length ?? prefs?.contextLength);
    if (!Number.isFinite(prefValue)) {
      return;
    }
    const normalized = clampContextLength(prefValue);
    setContextLength(normalized);
    setContextLengthInput(String(normalized));
  };

  // Validates and optionally persists the context-length input used by quotation text clipping.
  /**
   * Called by: QuotationFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
   */
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

    const shouldPersist = Boolean(
      liveHasLoaded && currentWorkspaceId && normalized !== contextLength,
    );
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

  // Commits context-length edits when focus leaves the input.
  /**
   * Called by: QuotationFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleContextLengthBlur = () => {
    void applyContextLengthInput();
  };

  // Lets Enter commit context-length edits without submitting surrounding controls.
  /**
   * Called by: QuotationFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleContextLengthKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void applyContextLengthInput();
    }
  };

  const hasIncompleteSelections =
    !displayedNodes.length ||
    displayedNodes.some((node, idx) => {
      const nodeId = getNodeIdentifier(node, idx);
      const selection = activeSelections.find((sel) => sel.nodeId === nodeId);
      return !selection || !selection.column;
    });

  const canRunQuotation =
    Boolean(currentWorkspaceId) &&
    displayedNodes.length > 0 &&
    !hasIncompleteSelections &&
    engineReady;

  // Per-node pagination and sorting state
  const [liveNodeState, setNodeState] = useState<Record<string, NodePaginationState>>({});
  const [nodeDetaching, setNodeDetaching] = useState<Record<string, boolean>>({});
  const [nodeMaterializing, setNodeMaterializing] = useState<Record<string, boolean>>({});
  const [materializeTaskIds, setMaterializeTaskIds] = useState<Record<string, string>>({});
  const [liveMaterializedPaths, setMaterializedPaths] = useState<Record<string, string>>({});
  const [liveMaterializeSummary, setMaterializeSummary] = useState<{
    recordCount: number;
    uniqueDocuments: number;
    totalDocuments: number;
  } | null>(null);
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
  const [liveResultsByNode, setResultsByNode] = useState<Record<string, QuotationResultState>>({});

  const nodeState = liveNodeState;
  const hasLoaded = liveHasLoaded;
  const materializedPaths = liveMaterializedPaths;
  const materializeSummary = liveMaterializeSummary;
  const resultsByNode = liveResultsByNode;

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
    // Extracts comparable server-side engine parameters from the stored task request.
    // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    getServerParams: (request) => {
      const { type: serverEngineType, url: serverEngineUrl } = getServerEngineConfig(
        request,
        (url) => normalizeRemoteUrl(url).normalized,
      );

      return {
        engine_type: serverEngineType,
        engine_url: serverEngineType === 'remote' ? serverEngineUrl || null : null,
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
  }, [
    isLocked,
    selectedNodes,
    nodeColumnSelections,
    recomputeAutoColumns,
    setNodeColumnSelections,
  ]);

  // Updates the selected text column and persists it as the document column preference.
  /**
   * Called by: QuotationFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleColumnChange = (nodeId: string, column: string) => {
    if (isLocked) return;
    setNodeColumnSelection(nodeId, column);
    void persistDocumentColumn(nodeId, column);
  };

  const [hoverState, setHoverState] = useState<QuotationHoverState | null>(null);

  // Stores normalized quotation results and matching pagination/sort state for one node.
  /**
   * Called by: QuotationFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   */
  const updateResultState = (
    nodeId: string,
    column: string,
    result: QuotationAnalysisResponse,
  ): QuotationResultState => {
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
    // Saves a validated engine configuration from the dialog before closing it.
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
      // Persist the run's assigned task id onto the active tab so reload
      // rehydrates the same task.
      onTaskIdAssigned: (taskId) => {
        if (tabId) onTabTaskChange?.(taskId);
      },
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
  const handleQuotationMaterializeSuccess = useCallback(
    async (nodeId: string, _taskId: string) => {
      void _taskId;
      try {
        const headers = getAuthHeaders();
        const parentTaskId = await resolveTaskId();
        if (parentTaskId) {
          const { data: req } = await quotationTaskRequest({
            headers,
            path: { task_id: parentTaskId },
            throwOnError: true,
          });
          const reqObj = (req as Record<string, unknown>) ?? {};
          const path =
            typeof reqObj.materialized_path === 'string'
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
        void handlePageSizeChange(20);
      } catch (error) {
        console.warn('Failed to reset quotation page size after materialize', error);
      }
    },
    [getAuthHeaders, resolveTaskId, handlePageSizeChange],
  );

  useMaterializeLifecycle({
    taskType: 'quotation_materialize',
    materializeTaskIds,
    setNodeMaterializing,
    setMaterializeTaskIds,
    onTerminalSuccess: handleQuotationMaterializeSuccess,
  });

  // Saves a validated engine configuration from the dialog before closing it.
  /**
   * Called by: QuotationFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleEngineDialogSave = () => {
    const payload = buildEngineRequest();
    if (!payload) {
      return;
    }
    closeEngineDialog();
  };

  // Loads available detach-column options before showing the quotation detach dialog.
  /**
   * Called by: QuotationFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
   */
  const openDetachDialog = async (nodeId: string) => {
    const selection = activeSelections.find((item) => item.nodeId === nodeId);
    if (!selection?.column) return;

    try {
      const { data: response } = await quotationDetachOptions({
        headers: getAuthHeaders(),
        path: { node_id: nodeId },
        query: { column: selection.column },
        throwOnError: true,
      });
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
      const message =
        error instanceof Error ? error.message : 'Failed to load quotation detach options';
      showErrorDialog(message);
    }
  };

  // Confirms the pending detach operation with the user's selected source columns.
  /**
   * Called by: QuotationFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleDetachConfirm = async () => {
    if (!pendingDetachNodeId) return;
    const selectedColumns = selectedDetachColumns[pendingDetachNodeId] || [];
    await handleDetach(
      pendingDetachNodeId,
      selectedColumns,
      materializedPaths[pendingDetachNodeId] ?? null,
    );
    setDetachDialogOpen(false);
    setPendingDetachNodeId(null);
    setDetachNodeOptions([]);
    setSelectedDetachColumns({});
  };

  // Runs a fresh quotation analysis or updates a locked task depending on parameter changes.
  /**
   * Called by: QuotationFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleRunOrUpdate = async () => {
    // Promote pending per-tab temp colours to assigned — Run is the
    // commit trigger per the node-colour strategy doc.
    promoteTempColors(activeNodeIds);
    await executeAnalysisRunOrUpdate({
      hasLockedParameterChanges: hasParamsChanged,
      clearResults,
      runFreshAnalysis: handleSearchAll,
    });
  };

  /**
   * Called by: QuotationFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
   */
  const effHandlePageChange = (newPage: number) => {
    void handlePageChange(newPage);
  };

  // Applies page-size changes to live task results.
  /**
   * Called by: QuotationFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
   */
  const effHandlePageSizeChange = (newSize: number) => {
    void handlePageSizeChange(newSize);
  };

  // Applies column sorting to live task results.
  /**
   * Called by: QuotationFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
   * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
   */
  const effHandleSort = (nodeId: string, columnName: string) => {
    void handleSort(nodeId, columnName);
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

    const baseColumns = resultState.metadata.metadata_columns.filter(
      (column) => !column.startsWith('__'),
    );
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
      <Dialog
        open={engineDialogOpen}
        onOpenChange={(open) => setEngineDialogOpen('quotationEngine', open)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Quotation Engine</DialogTitle>
            <DialogDescription>
              Select which engine to use when extracting quotations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="quotation-engine-type" className="text-sm font-medium">
                Engine Source
              </label>
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
                <label htmlFor="quotation-engine-url" className="text-sm font-medium">
                  Service URL
                </label>
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
                  <p className="text-xs text-muted-foreground">
                    Include protocol and point to the remote quotation extractor base URL.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                The local extractor runs inside this workspace; no extra configuration required.
              </p>
            )}
          </div>
          <DialogFooter className="sm:justify-end">
            <Button variant="outline" onClick={closeEngineDialog}>
              Cancel
            </Button>
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
            // Routes the Run button through live quotation execution.
            // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
            onRun: () => {
              void handleRunOrUpdate();
            },
            // Stops the active quotation task from the shared layout action.
            // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
            onStop: () => {
              void stopTask();
            },
            // Clears live quotation state and backend results from the shared layout action.
            // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
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
              return undefined;
            })(),
            clearDisabled: actionState.clearDisabled || isClearing,
            isRunning: isLoadingQuotations,
            isStopping,
            isClearing,
            hasResult: hasLoaded,
            runLabel: actionState.runLabel,
            clearHelp: {
              targetKey: 'analysis.quotation.clear-results',
              label: 'Clear results',
            },
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
                      <HelpIcon
                        targetKey="analysis.quotation.context-length"
                        label="Quotation context length"
                      />
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
                <span
                  className={`text-xs ${contextLengthError ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {contextLengthError ??
                    `Enter a whole number between 0 and ${MAX_CONTEXT_LENGTH}.`}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-8">
              {displayedNodes.map((node, idx) => {
                const nodeId = getNodeIdentifier(node, idx);
                const selection = activeSelections.find((s) => s.nodeId === nodeId);
                const textCol = selection?.column || '';

                const resultState = resultsByNode[nodeId];
                const rowsWithQuotes = (resultState?.rows ?? []).filter(
                  (row) => row?.[QUOTATION_COLUMN_KEYS.quote],
                );
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
                        Text column:{' '}
                        {textCol || 'Select a text column to view highlighted quotations.'}
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
                                // Every column is sortable through the backend materialised path.
                                const sortable = true;
                                const active = resultState?.sorting?.sort_by === c;
                                return (
                                  <TableHead
                                    key={c}
                                    className={`h-10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/90 select-none whitespace-nowrap ${sortable ? 'cursor-pointer' : 'cursor-default opacity-75'}`}
                                    onClick={sortable ? () => effHandleSort(nodeId, c) : undefined}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span>{c}</span>
                                      {sortable && (
                                        <ArrowUpDown
                                          className={`h-3 w-3 ${active ? 'text-foreground' : 'opacity-60'}`}
                                        />
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
                                <TableCell
                                  className="h-24 text-center text-muted-foreground"
                                  colSpan={cols.length || 1}
                                >
                                  No quotations found on this page. Source rows without quotations
                                  are omitted.
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
                                    const fullText =
                                      rawFullText == null ? undefined : String(rawFullText);
                                    const quotationGeneratedCols =
                                      Object.values(QUOTATION_COLUMN_KEYS);
                                    openRowDetail({
                                      record,
                                      textColumn: textCol,
                                      fullText,
                                      excludeMetadataColumns: [
                                        ...quotationGeneratedCols,
                                        '__spans',
                                      ],
                                    });
                                  }}
                                >
                                  {cols.map((c: string, cellIdx: number) => {
                                    const val =
                                      c === QUOTATION_DOCUMENT_COLUMN ? row?.[textCol] : row?.[c];
                                    const cellKey = `${nodeId}:${rowIdx}:${cellIdx}`;
                                    const shouldHighlight =
                                      Boolean(textCol) && c === QUOTATION_DOCUMENT_COLUMN;
                                    const content = shouldHighlight ? (
                                      <QuotationHighlightedCell
                                        text={typeof val === 'string' ? val : String(val ?? '')}
                                        row={row}
                                        cellKey={cellKey}
                                        contextLength={contextLength}
                                        hoverState={hoverState}
                                        onHoverChange={setHoverState}
                                      />
                                    ) : val !== undefined && val !== null ? (
                                      String(val)
                                    ) : (
                                      ''
                                    );
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
                      hasPrev={
                        resultState?.pagination?.has_prev ??
                        (resultState?.pagination?.page ?? 1) > 1
                      }
                      totalPages={resultState?.pagination?.total_source_pages}
                      onPageChange={(newPage) => effHandlePageChange(newPage)}
                      onPageSizeChange={effHandlePageSizeChange}
                      pageSizeLabel="Documents per batch"
                      pageSizeOptions={[...PAGE_SIZE_OPTIONS_DEFAULT]}
                      pageSizeSummary={
                        materializedPaths[nodeId] ? (
                          materializeSummary ? (
                            <GroupedResultsPageSizeSummary
                              groups={[]}
                              totalInstances={materializeSummary.recordCount}
                              totalDocuments={materializeSummary.uniqueDocuments}
                              totalProcessed={materializeSummary.totalDocuments}
                            />
                          ) : (
                            // Materialise summary not yet hydrated (e.g. the
                            // task-request fetch is mid-flight after Process All).
                            // Fall back to the pagination total — it's the same
                            // total hit count the summary's ``recordCount`` would
                            // report, so the line is correct, just missing the
                            // document breakdown until the summary lands.
                            <>
                              (Found{' '}
                              {(resultState?.pagination?.total_source_rows ?? 0).toLocaleString()}{' '}
                              {(resultState?.pagination?.total_source_rows ?? 0) === 1
                                ? 'quotation'
                                : 'quotations'}{' '}
                              across the materialised corpus.)
                            </>
                          )
                        ) : (
                          <GroupedResultsPageSizeSummary
                            groups={resultState?.groupedRows ?? []}
                            totalProcessed={resultState?.pagination?.page_size}
                          />
                        )
                      }
                    >
                      <DisabledReasonTooltip reason={undefined}>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleMaterialize(nodeId)}
                          disabled={
                            Boolean(nodeMaterializing[nodeId]) ||
                            Boolean(materializedPaths[nodeId]) ||
                            Boolean(nodeDetaching[nodeId])
                          }
                          className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
                          title={
                            'Cache all occurrence rows to disk so subsequent pagination and Add-to-Workspace reuse them'
                          }
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
                      </DisabledReasonTooltip>
                      <DisabledReasonTooltip reason={undefined}>
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
                      </DisabledReasonTooltip>
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
        customization={
          detailPayload
            ? {
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
                // Reuses the quotation detail renderer to show highlighted source text in the row panel.
                // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
                renderDocumentText: (text, record) => renderQuotationDetailText(text, record),
              }
            : undefined
        }
      />
    </>
  );
}

export default QuotationFeature;
