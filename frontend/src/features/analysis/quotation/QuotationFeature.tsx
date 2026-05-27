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
import {
  SNAPSHOT_DISABLED_REASON,
  snapshotSourceNodes,
  useSnapshotBackedAnalysisState,
} from '@/features/snapshot-view';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { useQuotationSnapshotCapture } from './hooks/useQuotationSnapshotCapture';
import { useQuotationSnapshotLoad } from './hooks/useQuotationSnapshotLoad';
import type { QuotationSnapshotPayload } from './hooks/useQuotationSnapshotLoad';
import { QuotationSnapshotBanner } from './components/QuotationSnapshotBanner';

import NodeSelectionPanel from '@/features/analysis/common/components/NodeSelectionPanel';
import { ANALYSIS_LOCKED_MESSAGE } from '@/features/analysis/common/components/AnalysisLockedNotice';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/stores/uiStore';
import AnalysisTaskBanner from '@/features/analysis/common/components/AnalysisTaskBanner';
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
  getAnalysisActionState,
  executeAnalysisRunOrUpdate,
  type NodePaginationState,
  type WorkspaceNodeLike,
} from '../common';

import { AnalysisPagination } from '@/features/analysis/common/components/AnalysisPagination';
import { useMaterializeLifecycle } from '../common/hooks/useMaterializeLifecycle';
import { useQuotationTaskFlow } from './hooks/useQuotationTaskFlow';
import { QUOTATION_COLUMN_KEYS, QUOTATION_DOCUMENT_COLUMN } from '../generatedColumns';
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
type QuotationEngineConfig = QuotationEngineConfigInput;
type QuotationHitRow = Record<string, unknown>;
type QuotationGroupedRow = QuotationHitRow[];

type QuotationDisplayRow = QuotationHitRow & {
  __spans: { start: number; end: number; type: string }[];
};

/** Normalize a ``QuotationAnalysisResponse`` into the result-state
 * shape the table view consumes. Hoisted to module scope because the
 * snapshot-mode dispatch (a ``useMemo`` declared near the top of the
 * component) needs to call this before the component's own helper
 * declarations would be in scope. No closure deps — just shape
 * massaging plus the ``QUOTATION_COLUMN_KEYS`` constants. */
function buildQuotationResultState(
  result: QuotationAnalysisResponse,
  column: string,
): QuotationResultState {
  const groupedRows = result.data;
  const rows = groupedRows.flatMap((group) => group).map((row) => {
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
}

const QuotationFeature: React.FC = () => {
  const { selectedNodes, handlePageChange: baseHandlePageChange, handlePageSizeChange: baseHandlePageSizeChange } = useWorkspaceSelection();
  const { currentWorkspaceId, currentWorkspace } = useWorkspaceData();
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
  const [liveHasLoaded, setHasLoaded] = useState(false);
  const [isLoadingQuotations, setIsLoadingQuotations] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [contextLengthInput, setContextLengthInput] = useState(String(DEFAULT_CONTEXT_LENGTH));
  const [contextLength, setContextLength] = useState(DEFAULT_CONTEXT_LENGTH);
  const [contextLengthError, setContextLengthError] = useState<string | null>(null);
  const [isSavingContextLength, setIsSavingContextLength] = useState(false);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorDialogMessage, setErrorDialogMessage] = useState<string>('');
  const { detailPayload, detailOpen, setDetailOpen, openDetail: openRowDetail } = useRowDetailDialog();

  // Snapshot view state hooks. Hoisted here so the effective-value
  // dispatch can shadow ``panelSelectedNodes`` / ``displayedNodes`` /
  // result state in one place; the rest of the component reads the
  // shadowed names and picks up snapshot data when in snapshot mode.
  const { loadedSnapshot, inSnapshotMode } =
    useSnapshotBackedAnalysisState<QuotationSnapshotPayload>('quotation');

  // ``panelSelectedNodes`` in snapshot mode is reconstructed from the
  // captured manifest (the live workspace may not even contain those
  // nodes any more). Live state is preserved untouched so Exit restores
  // exactly what the user had on screen before they hit Open.
  const panelSelectedNodes = useMemo<WorkspaceNodeLike[]>(() => {
    if (!inSnapshotMode || !loadedSnapshot) return livePanelSelectedNodes;
    return snapshotSourceNodes(loadedSnapshot.manifest.source);
  }, [inSnapshotMode, loadedSnapshot, livePanelSelectedNodes]);

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: panelSelectedNodes,
  });

  // ``activeSelections`` dispatches to the captured node_columns when
  // in snapshot mode so the NodeSelectionPanel renders the captured
  // column even if the live workspace doesn't have it.
  const activeSelections = useMemo(() => {
    if (inSnapshotMode && loadedSnapshot?.payload.settings) {
      const settings = loadedSnapshot.payload.settings;
      const nodeId = settings.node_id;
      const column = settings.column;
      if (nodeId && column) {
        return [{ nodeId, column }];
      }
    }
    return isLocked ? activeNodeColumnSelections : nodeColumnSelections;
  }, [inSnapshotMode, loadedSnapshot, isLocked, activeNodeColumnSelections, nodeColumnSelections]);

  const displayedNodes = takeMostRecent(panelSelectedNodes, 1);
  const activeNodeIds = displayedNodes
    .map((node, idx) => getNodeIdentifier(node, idx))
    .filter((id): id is string => Boolean(id));
  // ``tabKey`` routes colour changes through this tab's temp layer —
  // see the node-colour strategy doc. ``promoteTempColors`` is called
  // from ``handleRunOrUpdate`` below to commit the preview on Run.
  const { nodeColors: liveNodeColors, handleColorChange, defaultPalette, promoteTempColors } =
    useNodeColorManagement({
      activeNodeIds,
      tabKey: 'quotation',
  });
  // In snapshot mode the live colour store has no entries for the
  // captured node IDs. Shadow with the frozen ``manifest.node_colors``
  // so the parameter-panel swatch and downstream lookups read the
  // captured colour.
  const nodeColors: Record<string, string> =
    inSnapshotMode && loadedSnapshot ? loadedSnapshot.manifest.node_colors : liveNodeColors;

  // Phase 4.5 / decision 4: quotation rules are English-only. Mirror the
  // backend gate at the UI so the Run button surfaces a clear "why is
  // this disabled" tooltip rather than letting the user submit a request
  // that's going to come back as HTTP 400. Resolves language from the
  // active node's tokenization metadata first, then the
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
    Promise.resolve().then(() => setEngineError(null));
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
    resultRef: quotationResultRef,
    fetchResult: async (taskId, headers) => {
      const { data } = await quotationTaskResult({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    fetchRequest: async (taskId, headers) => {
      const { data } = await quotationTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
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

    // In snapshot mode there is no live task to persist to — the
    // context length still updates locally so the display rebuilds,
    // but we skip the server roundtrip.
    const shouldPersist = Boolean(
      !inSnapshotMode && liveHasLoaded && currentWorkspaceId && normalized !== contextLength,
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
  const [liveNodeState, setNodeState] = useState<Record<string, NodePaginationState>>({});
  // Snapshot-mode local pagination/sort state — separate from live so
  // that toggling page/sort in a snapshot doesn't pollute the live
  // session. Keyed by node id (same as ``liveNodeState``).
  const [snapshotNodeState, setSnapshotNodeState] = useState<Record<string, NodePaginationState>>({});
  // Deprecated per-node loading indicator; rely on DataView-like UX
  const [nodeDetaching, setNodeDetaching] = useState<Record<string, boolean>>({});
  const [nodeMaterializing, setNodeMaterializing] = useState<Record<string, boolean>>({});
  const [materializeTaskIds, setMaterializeTaskIds] = useState<Record<string, string>>({});
  const [liveMaterializedPaths, setMaterializedPaths] = useState<Record<string, string>>({});
  const [liveMaterializeSummary, setMaterializeSummary] = useState<{ recordCount: number; uniqueDocuments: number; totalDocuments: number } | null>(null);
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

  // Effective-value dispatch. In snapshot mode the captured result
  // drives ``resultsByNode`` for the single captured node, with
  // client-side pagination + sort applied below in ``pagedResultsByNode``.
  // ``materializedPaths`` is hard-coded "present" for the captured node
  // (we hard-require materialise before save). ``nodeState`` reads the
  // dedicated snapshot pagination/sort state. Live state stays untouched
  // so Exit returns the user to where they were.
  const nodeState = inSnapshotMode ? snapshotNodeState : liveNodeState;
  const hasLoaded = inSnapshotMode ? true : liveHasLoaded;
  const materializedPaths = useMemo<Record<string, string>>(() => {
    if (!inSnapshotMode || !loadedSnapshot) return liveMaterializedPaths;
    const out: Record<string, string> = {};
    for (const id of loadedSnapshot.manifest.source.node_ids) {
      out[id] = `snapshot:${id}`;
    }
    return out;
  }, [inSnapshotMode, loadedSnapshot, liveMaterializedPaths]);

  // Effective materialise summary — live state in normal mode, the
  // captured ``settings.materialize_summary`` block in snapshot mode.
  // Snake-cased fields from settings.json get re-cased here so the
  // JSX downstream uses the same camelCase property names regardless
  // of source.
  const materializeSummary = useMemo(() => {
    if (!inSnapshotMode) return liveMaterializeSummary;
    const captured = loadedSnapshot?.payload.settings?.materialize_summary;
    if (!captured) return null;
    return {
      recordCount: captured.record_count,
      uniqueDocuments: captured.unique_documents_with_hits,
      totalDocuments: captured.total_source_documents,
    };
  }, [inSnapshotMode, loadedSnapshot, liveMaterializeSummary]);

  // Build the snapshot-mode QuotationResultState from the captured
  // response, applying client-side pagination + sort the same way
  // the concordance snapshot loader does. The shape produced here is
  // what the live JSX reads via ``resultsByNode[nodeId]``.
  const resultsByNode = useMemo<Record<string, QuotationResultState>>(() => {
    if (!inSnapshotMode || !loadedSnapshot) return liveResultsByNode;
    const settings = loadedSnapshot.payload.settings;
    const nodeId = settings?.node_id ?? loadedSnapshot.manifest.source.node_ids[0];
    const column = settings?.column ?? '';
    if (!nodeId) return liveResultsByNode;

    const captured = loadedSnapshot.payload.result;
    const allGroups = captured.data ?? [];

    // Flatten → optional sort by user-clicked column → slice. Matches
    // the backend materialised path's "sort hits then slice" semantic
    // so the snapshot view paginates by *hits*, not by source-row
    // groups, exactly like live mode does after Process All.
    const allHits: Record<string, unknown>[] = [];
    for (const group of allGroups) {
      for (const hit of group) allHits.push(hit);
    }

    const np = snapshotNodeState[nodeId];
    const pageSize = np?.pageSize ?? DEFAULT_PAGE_SIZE;
    const currentPage = np?.currentPage ?? 1;
    const sortBy = np?.sortBy ?? '';
    const descending = np?.descending ?? false;

    let workingHits = allHits;
    if (sortBy && allHits.length > 1) {
      const dir = descending ? -1 : 1;
      workingHits = [...allHits].sort((a, b) => {
        const av = a[sortBy];
        const bv = b[sortBy];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') {
          return dir * (av - bv);
        }
        return dir * String(av).localeCompare(String(bv));
      });
    }

    const totalHits = workingHits.length;
    const totalPages = Math.max(1, Math.ceil(totalHits / pageSize));
    const startIdx = (currentPage - 1) * pageSize;
    const pagedHits = workingHits.slice(startIdx, startIdx + pageSize);
    // Emit each hit as a singleton group — the table renderer flattens
    // groups while building rows, so single-hit groups
    // produce the same rendered output as the original document-grouped
    // shape (and the proportional dispersion view doesn't apply here).
    const pagedGroups = pagedHits.map((h) => [h] as typeof allGroups[number]);

    const slicedResponse: QuotationAnalysisResponse = {
      ...captured,
      data: pagedGroups,
      pagination: {
        page: currentPage,
        page_size: pageSize,
        total_source_rows: totalHits,
        total_source_pages: totalPages,
        result_count: pagedHits.length,
        has_next: currentPage < totalPages,
        has_prev: currentPage > 1,
      },
      sorting: { sort_by: sortBy || null, descending },
    };

    return {
      [nodeId]: buildQuotationResultState(slicedResponse, column),
    };
  }, [inSnapshotMode, loadedSnapshot, snapshotNodeState, liveResultsByNode]);

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
        const { data: req } = await quotationTaskRequest({
          headers,
          path: { task_id: parentTaskId },
          throwOnError: true,
        });
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
    // Promote pending per-tab temp colours to assigned — Run is the
    // commit trigger per the node-colour strategy doc.
    promoteTempColors(activeNodeIds);
    await executeAnalysisRunOrUpdate({
      hasLockedParameterChanges: hasParamsChanged,
      clearResults,
      runFreshAnalysis: handleSearchAll,
    });
  };

  // ----- Snapshot capture + load wiring -----
  const getQuotationNodeRowCount = useCallback((node: WorkspaceNodeLike) => {
    const shape = node.shape as unknown;
    if (Array.isArray(shape) && typeof shape[0] === 'number') return shape[0];
    return 0;
  }, []);

  const handleOpenSnapshot = useQuotationSnapshotLoad();

  // Pull a stable task id for the capture hook (latches the most-recent
  // non-empty value so the brief refresh window after Process All
  // doesn't drop the capture's reference). Mirrors the concordance
  // ``captureTaskId`` pattern.
  const [liveQuotationTaskId, setLiveQuotationTaskId] = useState('');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const id = await resolveTaskId();
      if (id && !cancelled) setLiveQuotationTaskId(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [resolveTaskId, hasLoaded]);

  // Build the typed ``QuotationRequest`` from live form state for the
  // capture-side ``settings.json`` payload.
  const captureRequest = (() => {
    if (inSnapshotMode) return null;
    const node = livePanelSelectedNodes[0];
    const nodeId = node ? getNodeIdentifier(node, 0) : '';
    const selection = activeSelections.find((s) => s.nodeId === nodeId);
    const column = selection?.column ?? '';
    if (!nodeId || !column) return null;
    return {
      node_id: nodeId,
      column,
      engine:
        resolvedEnginePayload.type === 'remote' && resolvedEnginePayload.isValid
          ? { type: 'remote' as const, url: resolvedEnginePayload.normalizedUrl }
          : { type: 'local' as const },
      language: nodeLanguage,
    };
  })();

  // Pick the live node for the capture hook to read row count from.
  const liveCaptureNode: WorkspaceNodeLike | null =
    livePanelSelectedNodes[0] ?? null;
  const liveCaptureNodeId = liveCaptureNode
    ? getNodeIdentifier(liveCaptureNode, 0)
    : '';
  const liveMaterialized = liveCaptureNodeId
    ? Boolean(liveMaterializedPaths[liveCaptureNodeId])
    : false;

  const handleSaveSnapshot = useQuotationSnapshotCapture({
    workspaceId: currentWorkspaceId ?? null,
    workspaceName: currentWorkspace?.name ?? currentWorkspaceId ?? '(workspace)',
    taskId: liveQuotationTaskId,
    request: captureRequest,
    materializeSummary: liveMaterializeSummary,
    selectedNode: liveCaptureNode,
    getNodeRowCount: getQuotationNodeRowCount,
    getAuthHeaders,
    materialized: liveMaterialized,
  });

  // Synchronous Save-button disable reason — matches the
  // DisabledReasonTooltip pattern used by Run.
  const saveSnapshotDisabledReason = (() => {
    if (inSnapshotMode) {
      return 'Exit snapshot view first to capture a new snapshot from live results.';
    }
    if (!liveCaptureNode) {
      return 'Select a data block first.';
    }
    const rowCount = getQuotationNodeRowCount(liveCaptureNode);
    if (rowCount > 2_000) {
      return `Demo snapshots cap each selected data block at 2,000 rows; selected block has ${rowCount.toLocaleString()}.`;
    }
    if (!liveQuotationTaskId) {
      return 'Run the quotation extractor (and let it finish) before saving a snapshot.';
    }
    if (!liveHasLoaded) {
      return 'Wait for the quotation extractor to finish before saving a snapshot.';
    }
    if (!liveMaterialized) {
      return 'Click Process All to materialise the result before saving — keeps the snapshot compact.';
    }
    return undefined;
  })();

  // Snapshot-mode wrappers for page / sort: bump the dedicated
  // ``snapshotNodeState`` slot so ``resultsByNode`` re-slices on the
  // next render. No backend roundtrip.
  const effHandlePageChange = (newPage: number) => {
    if (!inSnapshotMode) {
      handlePageChange(newPage);
      return;
    }
    const nodeId =
      loadedSnapshot?.payload.settings?.node_id ??
      loadedSnapshot?.manifest.source.node_ids[0] ??
      '';
    if (!nodeId) return;
    setSnapshotNodeState((prev) => ({
      ...prev,
      [nodeId]: {
        currentPage: newPage,
        pageSize: prev[nodeId]?.pageSize ?? DEFAULT_PAGE_SIZE,
        sortBy: prev[nodeId]?.sortBy,
        descending: prev[nodeId]?.descending ?? false,
      },
    }));
  };

  const effHandlePageSizeChange = (newSize: number) => {
    if (!inSnapshotMode) {
      handlePageSizeChange(newSize);
      return;
    }
    const nodeId =
      loadedSnapshot?.payload.settings?.node_id ??
      loadedSnapshot?.manifest.source.node_ids[0] ??
      '';
    if (!nodeId) return;
    setSnapshotNodeState((prev) => ({
      ...prev,
      [nodeId]: {
        currentPage: 1,
        pageSize: newSize,
        sortBy: prev[nodeId]?.sortBy,
        descending: prev[nodeId]?.descending ?? false,
      },
    }));
  };

  const effHandleSort = (nodeId: string, columnName: string) => {
    if (!inSnapshotMode) {
      handleSort(nodeId, columnName);
      return;
    }
    setSnapshotNodeState((prev) => {
      const current = prev[nodeId] ?? {
        currentPage: 1,
        pageSize: DEFAULT_PAGE_SIZE,
        sortBy: undefined,
        descending: false,
      };
      const isSameColumn = current.sortBy === columnName;
      const nextDescending = isSameColumn ? !current.descending : false;
      return {
        ...prev,
        [nodeId]: {
          ...current,
          currentPage: 1,
          sortBy: columnName,
          descending: nextDescending,
        },
      };
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
        {inSnapshotMode && <QuotationSnapshotBanner />}
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
          snapshot={{
            tool: 'quotation',
            onSave: handleSaveSnapshot,
            saveDisabledReason: saveSnapshotDisabledReason,
            onOpen: handleOpenSnapshot,
            nodeLabels: livePanelSelectedNodes
              .map((n) => (n.name as string | undefined) ?? (n.id as string | undefined) ?? '')
              .filter((s) => s.length > 0),
          }}
          actions={{
            onRun: () => {
              if (inSnapshotMode) return;
              void handleRunOrUpdate();
            },
            onStop: () => {
              if (inSnapshotMode) return;
              void stopTask();
            },
            onClear: async () => {
              if (inSnapshotMode) return;
              if (!currentWorkspaceId) return;
              setIsClearing(true);
              await clearResults();
              setIsClearing(false);
            },
            runDisabled: inSnapshotMode || actionState.runDisabled || !canRunQuotation,
            runDisabledReason: (() => {
              if (inSnapshotMode) return 'Disabled in snapshot view';
              if (isLoadingQuotations) return undefined;
              if (actionState.runDisabledReason) return actionState.runDisabledReason;
              if (hasIncompleteSelections) return 'Select a column for each data block';
              if (!engineReady) return 'Configure the remote engine before running';
              if (quotationLanguageDisabledReason) return quotationLanguageDisabledReason;
              return undefined;
            })(),
            clearDisabled: inSnapshotMode || actionState.clearDisabled || isClearing,
            isRunning: isLoadingQuotations,
            isStopping,
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
                onChange={effHandlePageSizeChange}
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
            disabled={!!isLocked || inSnapshotMode}
            locked={!!isLocked || inSnapshotMode}
            originalCount={displayNodeCount}
            allowedDataTypes={['string']}
            lockedMessage={inSnapshotMode ? SNAPSHOT_DISABLED_REASON : ANALYSIS_LOCKED_MESSAGE}
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
                                  // Every column is sortable — in snapshot mode the client-side
                                  // comparator handles any column; in live mode the backend
                                  // materialised path sorts any column in schema (CONC_* columns
                                  // for concordance had the same treatment).
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
                      onPageChange={(newPage) => effHandlePageChange(newPage)}
                      pageSizeSummary={materializedPaths[nodeId]
                        ? (materializeSummary
                          ? <GroupedResultsPageSizeSummary
                              groups={[]}
                              totalInstances={materializeSummary.recordCount}
                              totalDocuments={materializeSummary.uniqueDocuments}
                              totalProcessed={materializeSummary.totalDocuments}
                            />
                          : (
                            // Materialise summary not yet hydrated (e.g. the
                            // task-request fetch is mid-flight after Process All).
                            // Fall back to the pagination total — it's the same
                            // total hit count the summary's ``recordCount`` would
                            // report, so the line is correct, just missing the
                            // document breakdown until the summary lands.
                            <>
                              (Found {(resultState?.pagination?.total_source_rows ?? 0).toLocaleString()} {(resultState?.pagination?.total_source_rows ?? 0) === 1 ? 'quotation' : 'quotations'} across the materialised corpus.)
                            </>
                          )
                        )
                        : <GroupedResultsPageSizeSummary groups={resultState?.groupedRows ?? []} totalProcessed={resultState?.pagination?.page_size} />
                      }
                    >
                      <DisabledReasonTooltip
                        reason={inSnapshotMode ? SNAPSHOT_DISABLED_REASON : undefined}
                      >
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleMaterialize(nodeId)}
                          disabled={
                            inSnapshotMode
                            || Boolean(nodeMaterializing[nodeId])
                            || Boolean(materializedPaths[nodeId])
                            || Boolean(nodeDetaching[nodeId])
                          }
                          className="h-auto max-w-full whitespace-normal wrap-break-word py-1.5 text-left"
                          title={inSnapshotMode ? undefined : 'Cache all occurrence rows to disk so subsequent pagination and Add-to-Workspace reuse them'}
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
                      <DisabledReasonTooltip
                        reason={inSnapshotMode ? SNAPSHOT_DISABLED_REASON : undefined}
                      >
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void openDetachDialog(nodeId)}
                          disabled={inSnapshotMode || Boolean(nodeDetaching[nodeId])}
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
