import React, { useEffect, useState, useRef } from 'react';
import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import { ANALYSIS_LOCKED_MESSAGE } from '../../../components/tabs/AnalysisLockedNotice';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '../../../hooks/useWorkspaceActions';
import { useAuth } from '../../../hooks/useAuth';
import { textApi } from '../../../api/text';
import type { QuotationEngineConfig, QuotationEngineType, QuotationRequest, QuotationResultQuery } from '../../../api/text';
import { getNodeInfo } from '../../../lib/nodeInfoCache';
import { applySelectedColumnsToSnapshots } from '../../../hooks/useSchemaManagement';
import useNodeColumnInfos from '../../../hooks/useNodeColumnInfos';
import { useAnalysisLockState, useParameterChangeDetection } from '../../../hooks/useAnalysisLockState';
import { useQuotationEngineDialogStore, useQuotationEngineConfigStore } from '../../../stores/quotationEngineStore';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Badge } from '../../../components/ui/badge';
import HelpIcon from '../../../components/help/HelpIcon';
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
import { ScrollArea } from '../../../components/ui/scroll-area';
import { ArrowUpDown, Loader2, Search, Trash2, Unlink } from 'lucide-react';
import { getAnalysisActionState } from '../common/analysisActionState';
import { getNodeIdentifier, useAnalysisHydration } from '../common';
import {
  clearAnalysisTaskResults,
  collectTaskIds,
  resolveAnalysisTaskId,
} from '../../../hooks/analysisTaskUtils';
import { AnalysisPagination } from '../../../components/AnalysisPagination';

interface QuotationResultState {
  rows: any[];
  columns: string[];
  pagination: {
    page: number;
    page_size: number;
    total_source_rows?: number;
    total_source_pages?: number;
    result_count?: number;
    has_next: boolean;
    has_prev: boolean;
  };
  sorting: {
    sort_by?: string | null;
    sort_order: 'asc' | 'desc';
  };
  column: string;
}

const DEFAULT_PAGE_SIZE = 100;
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
      const word = words[i];
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
      const word = words[i];
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

type EngineRequestPayload = { type: 'local' } | { type: 'remote'; url: string };

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
  const { currentWorkspaceId, nodeData } = useWorkspaceData();
  const { quotationSearch, detachQuotation } = useWorkspaceActions();
  const { getAuthHeaders } = useAuth();

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
  } = useAnalysisLockState({
    allowedDataTypes: ['string'],
    maxNodes: 1,
    docTypeOnly: true,
    enableHeuristicGuess: false,
  });

  // Show metadata by default so the table mirrors original columns
  const engineConfig = useQuotationEngineConfigStore((state) => state.config);
  const lastRemoteUrl = useQuotationEngineConfigStore((state) => state.lastRemoteUrl);
  const setEngineConfigStore = useQuotationEngineConfigStore((state) => state.setConfig);
  const updateRemoteUrl = useQuotationEngineConfigStore((state) => state.updateRemoteUrl);
  const [engineError, setEngineError] = useState<string | null>(null);
  const engineDialogOpen = useQuotationEngineDialogStore((state) => state.isOpen);
  const setEngineDialogOpen = useQuotationEngineDialogStore((state) => state.setOpen);
  const openEngineDialog = useQuotationEngineDialogStore((state) => state.open);
  const closeEngineDialog = useQuotationEngineDialogStore((state) => state.close);
  const [showMetadata, setShowMetadata] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoadingQuotations, setIsLoadingQuotations] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [lockedRequestParams, setLockedRequestParams] = useState<Record<string, unknown> | null>(null);
  const [contextLengthInput, setContextLengthInput] = useState(String(DEFAULT_CONTEXT_LENGTH));
  const [contextLength, setContextLength] = useState(DEFAULT_CONTEXT_LENGTH);
  const [contextLengthError, setContextLengthError] = useState<string | null>(null);
  const [isSavingContextLength, setIsSavingContextLength] = useState(false);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorDialogMessage, setErrorDialogMessage] = useState<string>('');
  const [localQuotationTaskId, setLocalQuotationTaskId] = useState<string | null>(null);

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: panelSelectedNodes,
  });

  const activeSelections = isLocked ? activeNodeColumnSelections : nodeColumnSelections;

  const displayedNodes = panelSelectedNodes.slice(0, 1);

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
      if ((engineConfig.url ?? '').trim() !== normalizedUrl) {
        updateRemoteUrl(normalizedUrl);
      }
      setEngineError(null);
      return { type: 'remote', url: normalizedUrl };
    }
    setEngineError(null);
    return { type: 'local' };
  };

  const getErrorMessage = (error: any): string => {
    const detail = error?.response?.data?.detail ?? error?.data?.detail ?? (error?.body as any)?.detail;
    if (typeof detail === 'string' && detail.trim().length) return detail;
    if (detail && typeof detail === 'object') {
      try {
        return JSON.stringify(detail);
      } catch {
        /* ignore */
      }
    }
    if (typeof error?.message === 'string' && error.message.trim().length) return error.message;
    return 'An unexpected error occurred while loading quotations.';
  };

  const showErrorDialog = (message: string) => {
    setErrorDialogMessage(message || 'An unexpected error occurred.');
    setErrorDialogOpen(true);
  };

  const handleEngineDialogSave = () => {
    const payload = buildEngineRequest();
    if (!payload) {
      return;
    }
    closeEngineDialog();
  };

  useEffect(() => {
    setEngineError(null);
  }, [engineConfig.type, engineConfig.url]);

  useEffect(() => {
    if (!currentWorkspaceId) {
      setLocalQuotationTaskId(null);
    }
  }, [currentWorkspaceId]);

  const resolveQuotationTaskId = async (): Promise<string | null> => {
    if (!currentWorkspaceId) {
      return null;
    }

    return resolveAnalysisTaskId({
      candidateIds: [localQuotationTaskId],
      fetchCurrentTaskId: async () => {
        const headers = getAuthHeaders();
        const current = (await textApi.getAnalysisCurrent(currentWorkspaceId, 'quotation', headers)) as any;
        const taskId = Array.isArray(current?.task_ids) ? current.task_ids[0] : null;
        return typeof taskId === 'string' && taskId.trim().length > 0 ? taskId : null;
      },
      onResolved: setLocalQuotationTaskId,
    });
  };

  const persistContextLengthPreference = async (value: number) => {
    if (!currentWorkspaceId) return;
    const taskId = await resolveQuotationTaskId();
    if (!taskId) return;
    await textApi.postQuotationTaskResult(
      currentWorkspaceId,
      taskId,
      { context_length: value, update_only: true },
      getAuthHeaders()
    );
  };

  const applyContextLengthPreferenceFromResult = (payload: any) => {
    const prefValue = Number(payload?.preferences?.context_length ?? payload?.preferences?.contextLength);
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
    sortOrder: 'asc' | 'desc';
  }>>({});
  // Deprecated per-node loading indicator; rely on DataView-like UX
  const [nodeDetaching, setNodeDetaching] = useState<Record<string, boolean>>({});
  const [resultsByNode, setResultsByNode] = useState<Record<string, QuotationResultState>>({});

  const currentRequestParams = (() => {
    const targetNode = (isLocked && lockedNodesSnapshot.length ? lockedNodesSnapshot[0] : displayedNodes[0]) as any;
    if (!targetNode) {
      return {} as Record<string, unknown>;
    }
    const nodeId = getNodeIdentifier(targetNode, 0);
    const selection = activeSelections.find((sel) => sel.nodeId === nodeId);
    if (!selection?.column) {
      return {} as Record<string, unknown>;
    }
    const state = nodeState[nodeId] || {
      currentPage: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sortBy: undefined,
      sortOrder: 'asc' as const,
    };
    const engineSnapshot = resolvedEnginePayload;
    const engineUrl = engineSnapshot.type === 'remote' && engineSnapshot.isValid
      ? engineSnapshot.normalizedUrl
      : null;
    return {
      column: selection.column,
      page: state.currentPage,
      page_size: state.pageSize,
      sort_by: state.sortBy ?? null,
      sort_order: state.sortOrder,
      engine_type: engineSnapshot.type,
      engine_url: engineUrl,
    } as Record<string, unknown>;
  })();

  const hasParamsChanged = useParameterChangeDetection<Record<string, unknown>>(
    isLocked,
    currentRequestParams,
    lockedRequestParams
  );

  const actionState = getAnalysisActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    hasSelection: displayedNodes.length > 0,
    isLocked,
    hasResults: hasLoaded,
    isBusy: isLoadingQuotations,
    hasActiveTask: false,
    allowRunWhenLocked: hasParamsChanged,
  });

    const resolveLockedNodeContext = (): { nodeId: string; column: string } | null => {
      const sourceNode = (isLocked && lockedNodesSnapshot.length ? lockedNodesSnapshot[0] : displayedNodes[0]) as any;
      if (!sourceNode) {
        return null;
      }
      const nodeId = getNodeIdentifier(sourceNode, 0);
      const selection = activeSelections.find((sel) => sel.nodeId === nodeId);
      const fallbackColumn = typeof lockedRequestParams?.column === 'string' ? lockedRequestParams.column : undefined;
      const column = selection?.column || fallbackColumn;
      if (!column) {
        return null;
      }
      return { nodeId, column };
    };

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
      textDecorationLine: decorations as any,
      textDecorationColor: colors.join(' ') as any,
      textDecorationThickness: '2px',
      textUnderlineOffset: '4px',
      textDecorationSkipInk: 'none',
      display: 'inline',
    } as React.CSSProperties;
  };

  // Render a single text cell with underline spans using indices and label badges
  const renderHighlightedText = (text: string, row: any, cellKey: string): React.ReactNode => {
    try {
      if (typeof text !== 'string' || !text.length) return text ?? '';
      const spans: HighlightSpan[] = [];
      const addSpan = (start?: any, end?: any, type?: string) => {
        if (type && Number.isFinite(start) && Number.isFinite(end) && start < end && start >= 0 && end <= text.length) {
          spans.push({ start: Number(start), end: Number(end), types: [type] });
        }
      };
      // Prefer aggregated spans if present
      if (Array.isArray(row?.__spans) && row.__spans.length > 0) {
        row.__spans.forEach((s: any) => addSpan(s?.start, s?.end, s?.type));
      } else {
        addSpan(row?.speaker_start_idx, row?.speaker_end_idx, 'speaker');
        addSpan(row?.quote_start_idx, row?.quote_end_idx, 'quote');
        addSpan(row?.verb_start_idx, row?.verb_end_idx, 'verb');
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
        const s = points[i];
        const e = points[i + 1];
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
              backgroundColor: hoverState && hoverState.key === cellKey && hoverState.segIndex === segIndex && hoverState.type === (t as any)
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
          {row?.quote_type ? (
            <span className="ml-1 align-baseline text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">{String(row.quote_type)}</span>
          ) : null}
        </span>
      );
    } catch {
      return text;
    }
  };

  const normalizeQuotationResult = (result: any, column: string): QuotationResultState => {
    const toNumber = (value: unknown, fallback: number) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };

    const rawRows: any[] = Array.isArray(result?.data) ? result.data : [];
    const rows = rawRows.map((row) => {
      const spans: { start: number; end: number; type: string }[] = [];
      const addSpan = (start?: any, end?: any, type?: string) => {
        if (!type) return;
        const s = Number(start);
        const e = Number(end);
        if (Number.isFinite(s) && Number.isFinite(e) && s < e) {
          spans.push({ start: s, end: e, type });
        }
      };
      addSpan(row?.speaker_start_idx, row?.speaker_end_idx, 'speaker');
      addSpan(row?.quote_start_idx, row?.quote_end_idx, 'quote');
      addSpan(row?.verb_start_idx, row?.verb_end_idx, 'verb');
      return { ...row, __spans: spans };
    });

    let columns: string[] = Array.isArray(result?.columns) && result.columns.length
      ? result.columns.slice()
      : (rows[0] ? Object.keys(rows[0]).filter((key) => !key.startsWith('__')) : []);
    if (column && !columns.includes(column)) {
      columns = [...columns, column];
    }

    const rawPagination = (result?.pagination || {}) as Record<string, unknown>;
    const pageSize = Math.max(1, toNumber(rawPagination.page_size, rows.length || DEFAULT_PAGE_SIZE));
    const pagination = {
      page: Math.max(1, toNumber(rawPagination.page, 1)),
      page_size: pageSize,
      total_source_rows: rawPagination.total_source_rows != null ? toNumber(rawPagination.total_source_rows, 0) : undefined,
      total_source_pages: rawPagination.total_source_pages != null ? toNumber(rawPagination.total_source_pages, 1) : undefined,
      result_count: rawPagination.result_count != null ? toNumber(rawPagination.result_count, 0) : undefined,
      has_next: Boolean(rawPagination.has_next ?? false),
      has_prev: Boolean(rawPagination.has_prev ?? false),
    };

    const rawSorting = (result?.sorting || {}) as Record<string, unknown>;
    const sortOrder: 'asc' | 'desc' = rawSorting.sort_order === 'desc' ? 'desc' : 'asc';
    const sorting = {
      sort_by: (rawSorting.sort_by ?? null) as string | null | undefined,
      sort_order: sortOrder,
    };

    return {
      rows,
      columns,
      pagination,
      sorting,
      column,
    };
  };

  const updateResultState = (nodeId: string, column: string, result: any): QuotationResultState => {
    const normalized = normalizeQuotationResult(result, column);
    setResultsByNode((prev) => ({ ...prev, [nodeId]: normalized }));
    setNodeState((prev) => ({
      ...prev,
      [nodeId]: {
        currentPage: normalized.pagination.page,
        pageSize: normalized.pagination.page_size,
        sortBy: normalized.sorting.sort_by ?? undefined,
        sortOrder: normalized.sorting.sort_order,
      },
    }));
    return normalized;
  };

  const fetchQuotations = async (
    nodeId: string,
    overrides?: {
      page?: number;
      pageSize?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      columnOverride?: string;
    },
  ) => {
    if (!currentWorkspaceId) return null;
    const selection = activeSelections.find((s) => s.nodeId === nodeId);
    const column = overrides?.columnOverride || selection?.column;
    if (!column) return null;

    const state = nodeState[nodeId] || {
      currentPage: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sortBy: undefined,
      sortOrder: 'asc' as const,
    };

    const page = overrides?.page ?? state.currentPage ?? 1;
    const pageSize = overrides?.pageSize ?? state.pageSize ?? DEFAULT_PAGE_SIZE;
    const sortBy = overrides?.sortBy ?? state.sortBy;
    const sortOrder: 'asc' | 'desc' = overrides?.sortOrder ?? state.sortOrder ?? 'asc';

    const enginePayload = buildEngineRequest();
    if (!enginePayload) {
      openEngineDialog();
      return null;
    }

    const engineConfigForRequest: QuotationEngineConfig = enginePayload.type === 'remote'
      ? { type: 'remote', url: enginePayload.url }
      : { type: 'local' };

    const requestPayload: QuotationRequest = {
      column,
      page,
      page_size: pageSize,
      sort_by: sortBy ?? undefined,
      sort_order: sortOrder,
      engine: engineConfigForRequest,
    };

    try {
      const result = await quotationSearch(nodeId, requestPayload);
      applyContextLengthPreferenceFromResult(result);
      const normalized = updateResultState(nodeId, column, result);
      return {
        normalized,
        request: {
          column,
          page: requestPayload.page,
          page_size: requestPayload.page_size,
          sort_by: requestPayload.sort_by ?? null,
          sort_order: requestPayload.sort_order,
          engine_type: engineConfigForRequest.type,
          engine_url: engineConfigForRequest.type === 'remote' ? (engineConfigForRequest.url ?? '') : null,
        },
      };
    } catch (error: any) {
      console.error('Failed to fetch quotations', error);
      showErrorDialog(getErrorMessage(error));
      return null;
    }
  };

  const updateStoredQuotationResult = async (
    overrides: Partial<QuotationResultQuery> = {},
  ) => {
    if (!currentWorkspaceId) {
      return null;
    }
    const context = resolveLockedNodeContext();
    if (!context) {
      return null;
    }

    const { nodeId, column } = context;
    const state = nodeState[nodeId] || {
      currentPage: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sortBy: undefined,
      sortOrder: 'asc' as const,
    };

    const payload: QuotationResultQuery = {
      page: overrides.page ?? state.currentPage ?? 1,
      page_size: overrides.page_size ?? state.pageSize ?? DEFAULT_PAGE_SIZE,
      sort_by: overrides.sort_by ?? state.sortBy ?? null,
      sort_order: overrides.sort_order ?? state.sortOrder ?? 'asc',
    };

    try {
      const taskId = await resolveQuotationTaskId();
      if (!taskId) {
        return null;
      }
      const response = await textApi.postQuotationTaskResult(
        currentWorkspaceId,
        taskId,
        payload,
        getAuthHeaders()
      );

      if (!response) {
        return null;
      }

      applyContextLengthPreferenceFromResult(response);
      const normalized = updateResultState(nodeId, column, response);
      setHasLoaded(true);
      setLockedRequestParams((prev) => {
        const engineSnapshot = (() => {
          if (prev?.engine_type) {
            return {
              engine_type: prev.engine_type,
              engine_url: prev.engine_url ?? null,
            };
          }
          if (resolvedEnginePayload.type === 'remote') {
            const url = resolvedEnginePayload.isValid
              ? resolvedEnginePayload.normalizedUrl
              : resolvedEnginePayload.rawUrl;
            return {
              engine_type: 'remote' as const,
              engine_url: url,
            };
          }
          return {
            engine_type: 'local' as const,
            engine_url: null,
          };
        })();

        return {
          ...engineSnapshot,
          column,
          page: normalized.pagination.page,
          page_size: normalized.pagination.page_size,
          sort_by: normalized.sorting.sort_by ?? null,
          sort_order: normalized.sorting.sort_order,
        } as Record<string, unknown>;
      });

      return normalized;
    } catch (error: any) {
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
      if (!outcome?.normalized) {
        return;
      }
      setHasLoaded(true);
      try {
        const lockedSelections = activeSelections.filter((sel) => sel.nodeId === nodeId && sel.column);
        const info = await getNodeInfo({ workspaceId: currentWorkspaceId!, nodeId, getAuthHeaders });
        const name = info?.name || info?.data?.name || nodeId;
        const columns = Array.isArray(info?.columns)
          ? info.columns
          : (Array.isArray(info?.data?.columns) ? info.data.columns : []);
        const columnMap = lockedSelections.reduce<Record<string, string | undefined>>(
          (acc, sel) => {
            acc[sel.nodeId] = sel.column;
            return acc;
          },
          {}
        );
        const normalizedSnapshots = applySelectedColumnsToSnapshots(
          [{ id: nodeId, name: String(name), columns }],
          columnMap
        );
        lockWithSnapshots(normalizedSnapshots);
      } catch {
        /* ignore */
      }
      setLockedRequestParams(outcome.request);
    } finally {
      setIsLoadingQuotations(false);
    }
  };

  const handlePageChange = async (newPage: number) => {
    const targetNode = (isLocked && lockedNodesSnapshot.length ? lockedNodesSnapshot[0] : displayedNodes[0]) as any;
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
    if (!updated) {
      baseHandlePageChange(newPage);
    }
  };

  const handlePageSizeChange = async (pageSize: number) => {
    const targetNode = (isLocked && lockedNodesSnapshot.length ? lockedNodesSnapshot[0] : displayedNodes[0]) as any;
    const nodeId = targetNode ? getNodeIdentifier(targetNode, 0) : '';
    if (!nodeId) {
      baseHandlePageSizeChange(pageSize);
      return;
    }
    if (!isLocked || !hasLoaded) {
      baseHandlePageSizeChange(pageSize);
      return;
    }
    const updated = await updateStoredQuotationResult({ page: 1, page_size: pageSize });
    if (!updated) {
      baseHandlePageSizeChange(pageSize);
    }
  };

  const handleSort = async (nodeId: string, column: string) => {
    const sortableColumns = new Set(originalColumnsByNode[nodeId] || []);
    if (!sortableColumns.has(column)) {
      return;
    }
    const state = nodeState[nodeId] || {
      currentPage: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sortBy: undefined,
      sortOrder: 'asc' as const,
    };
    const isSame = state.sortBy === column;
    const nextOrder: 'asc' | 'desc' = isSame && state.sortOrder === 'asc' ? 'desc' : 'asc';
    if (!isLocked || !hasLoaded) {
      const outcome = await fetchQuotations(nodeId, {
        page: 1,
        sortBy: column,
        sortOrder: nextOrder,
      });
      if (outcome) {
        setLockedRequestParams(outcome.request);
      }
      return;
    }

    await updateStoredQuotationResult({
      page: 1,
      sort_by: column,
      sort_order: nextOrder,
    });
  };

  const handleDetach = async (nodeId: string) => {
    const selection = activeSelections.find(s => s.nodeId === nodeId);
    if (!selection?.column) return;
    setNodeDetaching(prev => ({ ...prev, [nodeId]: true }));
    try {
      const enginePayload = buildEngineRequest();
      if (!enginePayload) {
        openEngineDialog();
        return;
      }
      await detachQuotation(nodeId, {
        node_id: nodeId,
        column: selection.column,
        engine: enginePayload.type === 'remote'
          ? { type: 'remote', url: enginePayload.url }
          : { type: 'local' },
      });
    } catch (e: any) {
      showErrorDialog(getErrorMessage(e));
    } finally {
      setNodeDetaching(prev => ({ ...prev, [nodeId]: false }));
    }
  };

  const applyHydratedRequest = async (requestPayload: unknown) => {
    const requestData = (requestPayload as any)?.data ?? requestPayload;
    if (!requestData) return;

    const nodeId = requestData?.node_id || requestData?.nodeId;
    const column = requestData?.column || '';
    const reqEngine = (requestData?.engine ?? null) as QuotationEngineConfig | null;
    let hydratedEngine: EngineRequestPayload =
      resolvedEnginePayload.type === 'remote' && resolvedEnginePayload.isValid
        ? { type: 'remote', url: resolvedEnginePayload.normalizedUrl }
        : { type: 'local' };

    if (!nodeId) {
      return;
    }

    if (reqEngine?.type === 'remote') {
      const trimmed = (reqEngine.url ?? '').trim();
      if (trimmed.length) {
        const { normalized, valid } = normalizeRemoteUrl(trimmed);
        const appliedUrl = valid ? normalized : trimmed;
        hydratedEngine = { type: 'remote', url: appliedUrl };
        updateRemoteUrl(appliedUrl);
        setEngineConfigStore({ type: 'remote', url: appliedUrl });
      }
    } else if (reqEngine?.type === 'local') {
      hydratedEngine = { type: 'local' };
      setEngineConfigStore({ type: 'local' });
    }

    setNodeColumnSelections([{ nodeId, column }], { replace: true });
    setShowMetadata(true);

    try {
      const info = await getNodeInfo({ workspaceId: currentWorkspaceId!, nodeId, getAuthHeaders });
      const name = info?.name || info?.data?.name || nodeId;
      const columns = Array.isArray(info?.columns)
        ? info.columns
        : (Array.isArray(info?.data?.columns) ? info.data.columns : []);
      const normalizedSnapshots = applySelectedColumnsToSnapshots(
        [{ id: nodeId, name: String(name), columns }],
        column ? { [nodeId]: column } : {}
      );
      lockWithSnapshots(normalizedSnapshots);
    } catch {
      /* ignore */
    }

    setLockedRequestParams((prev) => ({
      ...prev,
      engine_type: hydratedEngine.type,
      engine_url: hydratedEngine.type === 'remote' ? hydratedEngine.url : null,
    }));
  };

  const applyHydratedResult = async (resultPayload: unknown) => {
    const res = resultPayload as any;
    if (!res) return;
    const selection = nodeColumnSelections[0];
    const nodeId = selection?.nodeId ?? '';
    const column = selection?.column ?? '';
    if (!nodeId) return;

    applyContextLengthPreferenceFromResult(res);
    const normalized = updateResultState(nodeId, column, res);
    setLockedRequestParams((prev) => ({
      ...prev,
      column: normalized.column,
      page: normalized.pagination.page,
      page_size: normalized.pagination.page_size,
      sort_by: normalized.sorting.sort_by ?? null,
      sort_order: normalized.sorting.sort_order,
    }));
    setHasLoaded(true);
  };

  const fetchQuotationRequest = async (taskId?: string | null) => {
    if (!currentWorkspaceId || !taskId) return null;
    return textApi.getTaskRequest(currentWorkspaceId, taskId, getAuthHeaders());
  };

  const fetchQuotationResult = async (taskId?: string | null) => {
    if (!currentWorkspaceId || !taskId) return null;
    return textApi.getQuotationTaskResult(currentWorkspaceId, taskId, getAuthHeaders());
  };

  const { hydrateFromServer } = useAnalysisHydration({
    workspaceId: currentWorkspaceId,
    analysisKey: 'quotation',
    getAuthHeaders,
    onTaskIdResolved: setLocalQuotationTaskId,
    fetchRequest: fetchQuotationRequest,
    fetchResult: fetchQuotationResult,
    applyRequest: applyHydratedRequest,
    applyResult: applyHydratedResult,
    autoHydrateOnFocus: false,
    autoHydrateOnVisibility: false,
  });

  const hydratedOnceRef = useRef<boolean>(false);
  useEffect(() => {
    hydratedOnceRef.current = false;
  }, [currentWorkspaceId]);
  useEffect(() => {
    if (!currentWorkspaceId || hydratedOnceRef.current) return;
    hydratedOnceRef.current = true;
    void hydrateFromServer();
  }, [currentWorkspaceId, hydrateFromServer]);

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
      <div className="space-y-6">
        <Card>
          <CardHeader className="space-y-0 pb-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Quotation Extraction
                  <HelpIcon
                    targetKey="analysis.quotation.parameters"
                    label="Quotation parameters"
                    tooltip="Select a node, choose a text column, and configure quotation settings."
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
          <CardContent className="space-y-6 pt-0">
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
            <div className="flex flex-wrap gap-3">
              {hasParamsChanged ? (
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  onClick={handleSearchAll}
                  disabled={actionState.runDisabled || !canRunQuotation}
                >
                  {isLoadingQuotations ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Updating…
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      Update Results
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  onClick={handleSearchAll}
                  disabled={actionState.runDisabled || !canRunQuotation}
                >
                  {isLoadingQuotations ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading…
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      Load Quotations
                    </>
                  )}
                </Button>
              )}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full sm:w-auto"
                  onClick={async () => {
                    if (!currentWorkspaceId) return;
                    setIsClearing(true);
                    try {
                      const resolvedTaskId = await resolveQuotationTaskId();
                      const taskIds = collectTaskIds([localQuotationTaskId, resolvedTaskId]);
                      await clearAnalysisTaskResults({
                        workspaceId: currentWorkspaceId,
                        taskIds,
                        clearAnalysisTask: (workspaceId, taskId) =>
                          textApi.clearTask(workspaceId, taskId, getAuthHeaders()),
                        warnContext: 'quotation',
                      });
                    } finally {
                      setIsClearing(false);
                      setLocalQuotationTaskId(null);
                      setHasLoaded(false);
                      setResultsByNode({});
                      setNodeState({});
                      setLockedRequestParams(null);
                      unlockSelection();
                      setNodeColumnSelections([], { replace: true, persist: false });
                      recomputeAutoColumns();
                    }
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
            </div>
          </CardContent>
        </Card>

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
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={showMetadata}
                      onChange={(event) => setShowMetadata(event.target.checked)}
                    />
                    <span>Show metadata</span>
                  </label>
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
                const fallbackRows: any[] = Array.isArray(nodeData?.data) ? nodeData.data : [];
                const rowsForRender = resultState?.rows?.length ? resultState.rows : fallbackRows;
                const rowsWithQuotes = rowsForRender.filter((row: any) => row?.quote);

                const metaColumns = [
                  'speaker',
                  'speaker_start_idx',
                  'speaker_end_idx',
                  'quote_start_idx',
                  'quote_end_idx',
                  'verb',
                  'verb_start_idx',
                  'verb_end_idx',
                  'quote_type',
                  'quote_token_count',
                  'is_floating_quote',
                  'quote_row_idx',
                ];

                const allCols = (() => {
                  if (Array.isArray(resultState?.columns) && resultState.columns.length) {
                    return resultState.columns.filter((c: string) => !c.startsWith('__'));
                  }
                  if (rowsWithQuotes.length) {
                    return Object.keys(rowsWithQuotes[0]).filter((c) => !c.startsWith('__'));
                  }
                  return [] as string[];
                })();

                const mainColumn = textCol || (allCols.includes('quote') ? 'quote' : allCols[0] || 'quote');
                const baseColumns = (originalColumnsByNode[nodeId] || []).filter((c) => c !== textCol && !c.startsWith('__'));
                const presentMeta = metaColumns.filter((c) => allCols.includes(c));

                const cols = (() => {
                  const ordered: string[] = [];
                  if (mainColumn) ordered.push(mainColumn);
                  if (showMetadata) {
                    ordered.push(...baseColumns);
                    ordered.push(...presentMeta);
                  }
                  return ordered.length ? Array.from(new Set(ordered)) : [mainColumn];
                })();

                return (
                  <section key={nodeId} className="space-y-4">
                    <div className="border-b border-border/60 pb-4">
                      <p className="text-sm text-muted-foreground">
                        Text column: {textCol || 'Select a text column to view highlighted quotations.'}
                      </p>
                    </div>

                    <div className="rounded-lg border border-border bg-card">
                      <ScrollArea
                        scrollbars="both"
                        className="max-h-[70vh]"
                      >
                        <div className="min-w-max h-full">
                          <Table className="min-w-full text-sm" disableContainer>
                            <TableHeader className="bg-muted sticky top-0 z-10">
                              <TableRow className="border-b border-border/60">
                                {cols.map((c: string) => {
                                  const sortable = (originalColumnsByNode[nodeId] || []).includes(c);
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
                                    No quotations
                                  </TableCell>
                                </TableRow>
                              ) : (
                                rowsWithQuotes.map((row: any, rowIdx: number) => (
                                  <TableRow
                                    key={rowIdx}
                                    className="border-b border-border/60 last:border-b-0 hover:bg-muted/40"
                                  >
                                    {cols.map((c: string, cellIdx: number) => {
                                      const val = row?.[c];
                                      const cellKey = `${nodeId}:${rowIdx}:${cellIdx}`;
                                      const shouldHighlight = textCol ? c === textCol : c === 'quote';
                                      const content = shouldHighlight
                                        ? renderHighlightedText(
                                            typeof val === 'string' ? val : val ?? '',
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
                        </div>
                      </ScrollArea>
                    </div>

                    <AnalysisPagination
                      page={resultState?.pagination?.page ?? 1}
                      pageSize={resultState?.pagination?.page_size ?? DEFAULT_PAGE_SIZE}
                      hasNext={resultState?.pagination?.has_next ?? false}
                      hasPrev={resultState?.pagination?.has_prev ?? ((resultState?.pagination?.page ?? 1) > 1)}
                      totalPages={resultState?.pagination?.total_source_pages}
                      onPageChange={(newPage) => handlePageChange(newPage)}
                      onPageSizeChange={(newSize) => handlePageSizeChange(newSize)}
                      pageSizeOptions={[50, 100, 200, 400]}
                    >
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleDetach(nodeId)}
                        disabled={Boolean(nodeDetaching[nodeId])}
                        className="bg-green-600 text-white hover:bg-green-700"
                      >
                        {nodeDetaching[nodeId] ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Detaching…
                          </>
                        ) : (
                          <>
                            <Unlink className="mr-2 h-4 w-4" />
                            Detach
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
    </>
  );
};

export default QuotationFeature;
