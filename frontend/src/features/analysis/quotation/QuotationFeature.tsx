import React, { useEffect, useRef, useState } from 'react';

import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import { ANALYSIS_LOCKED_MESSAGE } from '../../../components/tabs/AnalysisLockedNotice';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '../../../hooks/useWorkspaceActions';
import { useAuth } from '../../../hooks/useAuth';
import { useUIStore } from '../../../stores/uiStore';
import AnalysisTaskBanner from '../../../components/tabs/AnalysisTaskBanner';
import { textApi } from '../../../api/text';
import type {
  QuotationAnalysisResponse,
  QuotationEngineConfig,
  QuotationEngineType,
  QuotationGroupedRow,
  QuotationHitRow,
  QuotationMetadata,
} from '../../../api/text';
import useNodeColumnInfos from '../../../hooks/useNodeColumnInfos';
import { useQuotationEngineDialogStore, useQuotationEngineConfigStore } from '../../../stores/quotationEngineStore';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Badge } from '../../../components/ui/badge';
import HelpIcon from '../../../components/help/HelpIcon';
import InfoIcon from '../../../components/help/InfoIcon';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { AnalysisTableScrollArea } from '../../../components/AnalysisTableScrollArea';
import { ArrowUpDown, Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { takeMostRecent } from '../../../utils/selectionUtils';
import {
  getNodeIdentifier,
  getServerEngineConfig,
  hasLockedParameterDiff,
  resetAnalysisSelectionAfterClear,
  restoreAnalysisLockFromRequest,
  useAnalysisLock,
  useAnalysisFeature,
  getAnalysisActionState,
  executeAnalysisRunOrUpdate,
  type WorkspaceNodeLike,
} from '../common';

import { AnalysisPagination } from '../../../components/AnalysisPagination';
import { useAnalysisTaskStatus } from '../../../hooks/useAnalysisTaskStatus';
import { useQuotationTaskFlow } from './hooks/useQuotationTaskFlow';
import { QUOTATION_COLUMN_KEYS, QUOTATION_DOCUMENT_COLUMN } from '../generatedColumns';
import { flattenQuotationGroups } from './quotationViewModels';
import {
  QuotationDetachDialog,
  type QuotationDetachNodeOption,
} from './components/QuotationDetachDialog';
import {
  MetadataColumnSelector,
} from '../common/components/MetadataColumnSelector';
import { GroupedResultsPageSizeSummary } from '../common/components/GroupedResultsPageSizeSummary';
import { reconcileMetadataColumnSelection } from '../common/components/metadataColumnSelection';
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
const DEFAULT_CONTEXT_LENGTH = 5;
const MAX_CONTEXT_LENGTH = 2000;

const TYPE_COLORS: Record<string, string> = {
  speaker: '#2563eb', // blue-600
  quote: '#059669',   // emerald-600
  verb: '#7c3aed',    // violet-600
};

const clampContextLength = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_CONTEXT_LENGTH;
  return Math.max(0, Math.min(MAX_CONTEXT_LENGTH, Math.floor(value)));
};

type HighlightSpan = { start: number; end: number; types: string[] };

interface ContextClipResult {
  text: string;
  spans: HighlightSpan[];
  prefixEllipsis: boolean;
  suffixEllipsis: boolean;
  sliceStart: number;
  sliceEnd: number;
}

type QuotationDisplayRow = QuotationHitRow & {
  __spans: { start: number; end: number; type: string }[];
};

const clipTextAroundSpans = (text: string, spans: HighlightSpan[], surroundingWords: number): ContextClipResult => {
  const normalizedWords = Number.isFinite(surroundingWords)
    ? Math.max(0, Math.floor(surroundingWords))
    : 0;

  if (!text || !spans.length) {
    return {
      text,
      spans: spans.map((span) => ({ ...span })),
      prefixEllipsis: false,
      suffixEllipsis: false,
      sliceStart: 0,
      sliceEnd: text.length,
    };
  }

  const earliestStart = Math.max(0, Math.min(...spans.map((s) => s.start)));
  const latestEnd = Math.min(text.length, Math.max(...spans.map((s) => s.end)));

  if (!Number.isFinite(earliestStart) || !Number.isFinite(latestEnd) || earliestStart >= latestEnd) {
    return {
      text,
      spans: spans.map((span) => ({ ...span })),
      prefixEllipsis: false,
      suffixEllipsis: false,
      sliceStart: 0,
      sliceEnd: text.length,
    };
  }

  const regex = /\S+/g;
  const words: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    words.push({ start: match.index, end: match.index + match[0].length });
  }

  const projectSpans = (sliceStart: number, sliceEnd: number) =>
    spans
      .map((span) => {
        const start = Math.max(span.start, sliceStart);
        const end = Math.min(span.end, sliceEnd);
        if (end <= start) return null;
        return { ...span, start: start - sliceStart, end: end - sliceStart };
      })
      .filter((span): span is HighlightSpan => Boolean(span));

  if (!words.length) {
    const sliceStart = earliestStart;
    const sliceEnd = latestEnd;
    return {
      text: text.slice(sliceStart, sliceEnd),
      spans: projectSpans(sliceStart, sliceEnd),
      prefixEllipsis: sliceStart > 0,
      suffixEllipsis: sliceEnd < text.length,
      sliceStart,
      sliceEnd,
    };
  }

  const findWordIndexBeforeOrAt = (pos: number) => {
    for (let i = 0; i < words.length; i++) {
      const word = words[i]!;
      if (pos < word.start) {
        return Math.max(0, i - 1);
      }
      if (pos <= word.end) {
        return i;
      }
    }
    return words.length - 1;
  };

  const findWordIndexAfterOrAt = (pos: number) => {
    for (let i = 0; i < words.length; i++) {
      const word = words[i]!;
      if (pos <= word.end) {
        return i;
      }
      if (pos < word.start) {
        return i;
      }
    }
    return words.length - 1;
  };

  const startWordIdx = findWordIndexBeforeOrAt(earliestStart);
  const lastCharIndex = Math.max(0, latestEnd - 1);
  const endWordIdx = findWordIndexAfterOrAt(lastCharIndex);

  const clipStartIdx = Math.max(0, startWordIdx - normalizedWords);
  const clipEndIdx = Math.min(words.length - 1, endWordIdx + normalizedWords);

  let sliceStart = words[clipStartIdx]?.start ?? 0;
  let sliceEnd = words[clipEndIdx]?.end ?? text.length;

  if (!Number.isFinite(sliceStart) || !Number.isFinite(sliceEnd) || sliceEnd <= sliceStart) {
    sliceStart = 0;
    sliceEnd = text.length;
  }

  return {
    text: text.slice(sliceStart, sliceEnd),
    spans: projectSpans(sliceStart, sliceEnd),
    prefixEllipsis: sliceStart > 0,
    suffixEllipsis: sliceEnd < text.length,
    sliceStart,
    sliceEnd,
  };
};


type NormalizationFailureReason = 'empty' | 'scheme' | 'format' | 'protocol';

interface NormalizedRemoteUrl {
  normalized: string;
  valid: boolean;
  reason: NormalizationFailureReason | null;
}

const NORMALIZED_SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

const normalizeRemoteUrl = (value: string): NormalizedRemoteUrl => {
  const trimmed = value.trim();
  if (!trimmed.length) {
    return { normalized: '', valid: false, reason: 'empty' };
  }

  const hasScheme = NORMALIZED_SCHEME_REGEX.test(trimmed);

  const isHttpScheme = /^https?:\/\//i.test(trimmed);

  const canParse = (candidate: string) => {
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  if (canParse(trimmed)) {
    return { normalized: trimmed, valid: true, reason: null };
  }

  if (!hasScheme) {
    const prefixed = `http://${trimmed}`;
    if (canParse(prefixed)) {
      return { normalized: prefixed, valid: true, reason: null };
    }
    return { normalized: trimmed, valid: false, reason: 'format' };
  }

  if (!isHttpScheme) {
    return { normalized: trimmed, valid: false, reason: 'protocol' };
  }

  return { normalized: trimmed, valid: false, reason: 'format' };
};

const QuotationFeature: React.FC = () => {
  const { selectedNodes, handlePageChange: baseHandlePageChange, handlePageSizeChange: baseHandlePageSizeChange } = useWorkspaceSelection();
  const { currentWorkspaceId } = useWorkspaceData();
  const { quotationSearch, detachQuotation, materializeQuotation } = useWorkspaceActions();
  const { getAuthHeaders } = useAuth();
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

  const engineConfig = useQuotationEngineConfigStore((state) => state.config);
  const lastRemoteUrl = useQuotationEngineConfigStore((state) => state.lastRemoteUrl);
  const setEngineConfigStore = useQuotationEngineConfigStore((state) => state.setConfig);
  const updateRemoteUrl = useQuotationEngineConfigStore((state) => state.updateRemoteUrl);
  const [engineError, setEngineError] = useState<string | null>(null);
  const engineDialogOpen = useQuotationEngineDialogStore((state) => state.isOpen);
  const setEngineDialogOpen = useQuotationEngineDialogStore((state) => state.setOpen);
  const openEngineDialog = useQuotationEngineDialogStore((state) => state.open);
  const closeEngineDialog = useQuotationEngineDialogStore((state) => state.close);
  const [showMetadata, setShowMetadata] = useState(false);
  const [selectedMetadataColumns, setSelectedMetadataColumns] = useState<string[] | null>(null);
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
      setShowMetadata(false);
      const matPath = requestData.materialized_path;
      if (typeof matPath === 'string' && matPath) {
        setMaterializedPaths(prev => ({ ...prev, [nodeId]: matPath }));
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

  const canRunQuotation = Boolean(currentWorkspaceId) && displayedNodes.length > 0 && !hasIncompleteSelections && engineReady;

  // Per-node pagination and sorting state
  const [nodeState, setNodeState] = useState<Record<string, {
    currentPage: number;
    pageSize: number;
    sortBy?: string;
    descending: boolean;
  }>>({});
  // Deprecated per-node loading indicator; rely on DataView-like UX
  const [nodeDetaching, setNodeDetaching] = useState<Record<string, boolean>>({});
  const [nodeMaterializing, setNodeMaterializing] = useState<Record<string, boolean>>({});
  const [materializeTaskIds, setMaterializeTaskIds] = useState<Record<string, string>>({});
  const [materializedPaths, setMaterializedPaths] = useState<Record<string, string>>({});
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [pendingDetachNodeId, setPendingDetachNodeId] = useState<string | null>(null);
  const [detachNodeOptions, setDetachNodeOptions] = useState<QuotationDetachNodeOption[]>([]);
  const [selectedDetachColumns, setSelectedDetachColumns] = useState<Record<string, string[]>>({});
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

  // Track hovered segment per cell to highlight only that particular part
  const [hoverState, setHoverState] = useState<{ key: string; segIndex: number; type?: 'speaker'|'quote'|'verb' } | null>(null);

  const hexToRgba = (hex: string, alpha = 0.18) => {
    const h = hex.replace('#', '');
    const bigint = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  // Build multiple text decorations for proper multi-line underlines
  const buildUnderlineStyle = (types: string[]): React.CSSProperties => {
    if (!types.length) return {};
    // Use text-decoration-line with multiple underlines for proper line wrapping
    const decorations = types.map(() => 'underline').join(' ');
    const colors = types.map(t => TYPE_COLORS[t] || '#111827');
    return {
      textDecorationLine: decorations as string,
      textDecorationColor: colors.join(' ') as string,
      textDecorationThickness: '2px',
      textUnderlineOffset: '4px',
      textDecorationSkipInk: 'none',
      display: 'inline',
    } as React.CSSProperties;
  };

  // Render a single text cell with underline spans using indices and label badges
  const renderHighlightedText = (text: string, row: Record<string, unknown>, cellKey: string): React.ReactNode => {
    try {
      if (typeof text !== 'string' || !text.length) return text ?? '';
      const spans: HighlightSpan[] = [];
      const addSpan = (start?: unknown, end?: unknown, type?: string) => {
        if (type && Number.isFinite(start) && Number.isFinite(end) && (start as number) < (end as number) && (start as number) >= 0 && (end as number) <= text.length) {
          spans.push({ start: Number(start), end: Number(end), types: [type] });
        }
      };
      // Prefer aggregated spans if present
      if (Array.isArray(row?.__spans) && row.__spans.length > 0) {
        row.__spans.forEach((s: Record<string, unknown>) => addSpan(s?.start, s?.end, s?.type as string | undefined));
      } else {
        addSpan(row?.[QUOTATION_COLUMN_KEYS.speakerStartIdx], row?.[QUOTATION_COLUMN_KEYS.speakerEndIdx], 'speaker');
        addSpan(row?.[QUOTATION_COLUMN_KEYS.quoteStartIdx], row?.[QUOTATION_COLUMN_KEYS.quoteEndIdx], 'quote');
        addSpan(row?.[QUOTATION_COLUMN_KEYS.verbStartIdx], row?.[QUOTATION_COLUMN_KEYS.verbEndIdx], 'verb');
      }

      if (!spans.length) return text;

      const clipped = clipTextAroundSpans(text, spans, contextLength);
      let workingText = clipped.text;
      let workingSpans = clipped.spans;
      if (!workingSpans.length) {
        workingText = text.slice(clipped.sliceStart, clipped.sliceEnd);
        workingSpans = spans
          .map((span) => {
            const start = Math.max(span.start, clipped.sliceStart);
            const end = Math.min(span.end, clipped.sliceEnd);
            if (end <= start) return null;
            return { ...span, start: start - clipped.sliceStart, end: end - clipped.sliceStart };
          })
          .filter((span): span is HighlightSpan => Boolean(span));
      }

      // Build segmentation boundaries
      const bounds = new Set<number>([0, workingText.length]);
      workingSpans.forEach(s => { bounds.add(s.start); bounds.add(s.end); });
      const points = Array.from(bounds).sort((a, b) => a - b);

      const segs: Array<{ start: number; end: number; types: string[] }> = [];
      for (let i = 0; i < points.length - 1; i++) {
        const s = points[i]!;
        const e = points[i + 1]!;
        if (e <= s) continue;
        const covering = workingSpans.filter(sp => sp.start < e && sp.end > s).flatMap(sp => sp.types);
        segs.push({ start: s, end: e, types: Array.from(new Set(covering)) });
      }

      const renderLabels = (types: string[], segIndex: number) => {
        if (!types.length) return null;
        return types.map((t, idx) => (
          <span
            key={idx}
            className="text-[10px] font-semibold px-1 py-0.5 rounded border mr-1 align-baseline cursor-pointer"
            style={{
              color: '#0f172a',
              borderColor: TYPE_COLORS[t] || '#334155',
              backgroundColor: hoverState && hoverState.key === cellKey && hoverState.segIndex === segIndex && hoverState.type === t
                ? hexToRgba(TYPE_COLORS[t] || '#cbd5e1', 0.28)
                : '#f1f5f9',
            }}
            onMouseEnter={() => setHoverState({ key: cellKey, segIndex, type: t as 'speaker'|'quote'|'verb' })}
            onMouseLeave={() => setHoverState(null)}
          >
            {t.toUpperCase()}
          </span>
        ));
      };

      return (
        <span>
          {clipped.prefixEllipsis && <span className="mr-1 text-muted-foreground">...</span>}
          {segs.map((seg, i) => {
            const str = workingText.slice(seg.start, seg.end);
            if (!seg.types.length) return <span key={i}>{str}</span>;
            const style = buildUnderlineStyle(seg.types);
            // Determine hover match for this segment: if the currently hovered type applies to this cell and segment
            const isHoveredSeg = !!(hoverState && hoverState.key === cellKey && hoverState.segIndex === i);
            const colorForSeg = (hoverState?.type && isHoveredSeg && seg.types.includes(hoverState.type))
              ? hoverState.type
              : undefined;
            const bgStyle: React.CSSProperties = isHoveredSeg ? {
              backgroundColor: hexToRgba(TYPE_COLORS[colorForSeg || 'quote'] || '#cbd5e1', 0.22),
              borderRadius: 3,
              paddingLeft: 1,
              paddingRight: 1,
            } : {};

            // On text hover, pick a deterministic type to highlight (priority: quote > speaker > verb)
            const choosePriorityType = (ts: string[]) => {
              const order = ['quote', 'speaker', 'verb'];
              for (const t of order) if (ts.includes(t)) return t as 'quote'|'speaker'|'verb';
              return ts[0] as 'quote'|'speaker'|'verb';
            };
            const segHoverType = choosePriorityType(seg.types);
            return (
              <span key={i}>
                {renderLabels(seg.types, i)}
                <span
                  style={{ ...style, ...bgStyle }}
                  onMouseEnter={() => setHoverState({ key: cellKey, segIndex: i, type: segHoverType })}
                  onMouseLeave={() => setHoverState(null)}
                >{str}</span>
              </span>
            );
          })}
          {clipped.suffixEllipsis && <span className="ml-1 text-muted-foreground">...</span>}
          {row?.[QUOTATION_COLUMN_KEYS.quoteType] ? (
            <span className="ml-1 align-baseline text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">{String(row[QUOTATION_COLUMN_KEYS.quoteType])}</span>
          ) : null}
        </span>
      );
    } catch {
      return text;
    }
  };

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
    },
  });

  // Watch quotation_materialize task status: clear flag on terminal state; on
  // success, refresh request to learn materialized_path, reset page_size to
  // the default 20, and refetch the current page (which will now slice from
  // the cached parquet with occurrence-row semantics).
  const quotationMaterializeStatus = useAnalysisTaskStatus(['quotation_materialize']);
  const processedQuotationMaterializeTaskIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const trackedEntries = Object.entries(materializeTaskIds);
    if (trackedEntries.length === 0) return;

    for (const task of quotationMaterializeStatus.tasks) {
      const taskId = task?.task_id;
      if (!taskId) continue;
      if (processedQuotationMaterializeTaskIdsRef.current.has(taskId)) continue;
      const state = task?.state;
      if (state !== 'successful' && state !== 'failed' && state !== 'cancelled') continue;

      const nodeEntry = trackedEntries.find(([, trackedId]) => trackedId === taskId);
      if (!nodeEntry) continue;
      const [nodeId] = nodeEntry;

      processedQuotationMaterializeTaskIdsRef.current.add(taskId);
      setNodeMaterializing((prev) => {
        if (!prev[nodeId]) return prev;
        const { [nodeId]: _removed, ...next } = prev;
        void _removed;
        return next;
      });
      setMaterializeTaskIds((prev) => {
        if (!(nodeId in prev)) return prev;
        const { [nodeId]: _removed, ...next } = prev;
        void _removed;
        return next;
      });

      if (state !== 'successful') continue;

      void (async () => {
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
          }
        } catch (error) {
          console.warn('Failed to refresh quotation task request after materialize', error);
        }

        try {
          handlePageSizeChange(20);
        } catch (error) {
          console.warn('Failed to reset quotation page size after materialize', error);
        }
      })();
    }
  }, [
    quotationMaterializeStatus.tasks,
    materializeTaskIds,
    getAuthHeaders,
    resolveTaskId,
    handlePageSizeChange,
  ]);

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

  const toggleDetachColumn = (nodeId: string, column: string, checked: boolean) => {
    setSelectedDetachColumns((prev) => {
      const current = new Set(prev[nodeId] || []);
      if (checked) current.add(column);
      else current.delete(column);
      return { ...prev, [nodeId]: Array.from(current) };
    });
  };

  const selectAllDetachColumns = () => {
    setSelectedDetachColumns((prev) => {
      const next = { ...prev };
      detachNodeOptions.forEach((node) => {
        next[node.node_id] = node.available_columns.filter(
          (column) => !(node.disabled_columns || []).includes(column)
        );
      });
      return next;
    });
  };

  const deselectAllDetachColumns = () => {
    setSelectedDetachColumns((prev) => {
      const next = { ...prev };
      detachNodeOptions.forEach((node) => {
        next[node.node_id] = [];
      });
      return next;
    });
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
  const preferredMetadataColumns = (() => {
    const nodeId = displayedNodes[0] ? getNodeIdentifier(displayedNodes[0], 0) : '';
    if (!nodeId) {
      return [] as string[];
    }

    const selection = activeSelections.find((item) => item.nodeId === nodeId);
    return selection?.column ? [selection.column] : [];
  })();
  const resolvedMetadataColumns = reconcileMetadataColumnSelection(
    quotationMetadataColumns,
    selectedMetadataColumns,
    preferredMetadataColumns,
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
        <Card>
          <CardHeader className="space-y-0 pb-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Quotation Extraction
                  <InfoIcon
                    targetKey="quotation.overview"
                    label="About Quotation Extraction"
                    tooltip="Learn what quotation extraction is and how it can help you."
                  />
                  <HelpIcon
                    targetKey="analysis.quotation.parameters"
                    label="Quotation parameters"
                    tooltip="Select a data block, choose a text column, and configure quotation settings."
                  />
                </CardTitle>
              </div>
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
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <NodeSelectionPanel
              selectedNodes={panelSelectedNodes}
              nodeColumnSelections={activeSelections}
              onColumnChange={handleColumnChange}
              nodeColors={{}}
              onColorChange={()=>{}}
              getNodeColumns={getColumnInfos}
              defaultPalette={[]}
              maxCompare={1}
              className="border border-dashed border-muted-foreground/40 rounded-lg bg-muted/30 p-4"
              showShape
              showColorPicker={false}
              disabled={!!isLocked}
              locked={!!isLocked}
              originalCount={displayNodeCount}
              allowedDataTypes={['string']}
              lockedMessage={ANALYSIS_LOCKED_MESSAGE}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={() => {
                  void handleRunOrUpdate();
                }}
                disabled={actionState.runDisabled || !canRunQuotation}
              >
                {isLoadingQuotations ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Running…
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    {actionState.runLabel}
                  </>
                )}
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full sm:w-auto"
                  onClick={async () => {
                    if (!currentWorkspaceId) return;
                    setIsClearing(true);
                    await clearResults();
                    setIsClearing(false);
                  }}
                  disabled={actionState.clearDisabled || isClearing}
                >
                  {isClearing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Clearing…
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Clear Results
                    </>
                  )}
                </Button>
                <HelpIcon targetKey="analysis.quotation.clear-results" label="Clear results" />
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="whitespace-nowrap text-sm text-muted-foreground">Documents per batch</span>
                <Select
                  value={String(
                    nodeState[displayedNodes[0] ? getNodeIdentifier(displayedNodes[0], 0) : '']?.pageSize
                    ?? DEFAULT_PAGE_SIZE
                  )}
                  onValueChange={(val) => handlePageSizeChange(Number(val))}
                >
                  <SelectTrigger className="h-9 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {[10, 20, 50, 100, 200, 400, 800].map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
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
                    showMetadata={showMetadata}
                    onShowMetadataChange={setShowMetadata}
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
                                        ? renderHighlightedText(
                                            typeof val === 'string' ? val : String(val ?? ''),
                                            row,
                                            cellKey,
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
                      pageSizeSummary={<GroupedResultsPageSizeSummary groups={resultState?.groupedRows ?? []} totalProcessed={resultState?.pagination?.page_size} />}
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
                        className="h-auto max-w-full whitespace-normal wrap-break-word bg-green-600 py-1.5 text-left text-white hover:bg-green-700"
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
