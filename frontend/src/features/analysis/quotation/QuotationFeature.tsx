import React, { useEffect, useMemo, useState, useCallback } from 'react';
import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import AnalysisLockedNotice from '../../../components/tabs/AnalysisLockedNotice';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Badge } from '../../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, Search, Trash2, Unlink } from 'lucide-react';

interface QuotationResultState {
  rows: any[];
  columns: string[];
  pagination: {
    page: number;
    page_size: number;
    total_rows: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
  sorting: {
    sort_by?: string | null;
    sort_order: 'asc' | 'desc';
  };
  column: string;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_CONTEXT_LENGTH = 20;
const MAX_CONTEXT_LENGTH = 2000;

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

const resolveNodeId = (node: any, fallbackIndex = 0): string => {
  if (!node) return `node-${fallbackIndex}`;
  const candidates = [
    node.id,
    node.node_id,
    node.data?.id,
    node.data?.node_id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length) {
      return candidate;
    }
  }
  return `node-${fallbackIndex}`;
};

const QuotationFeature: React.FC = () => {
  const { selectedNodes, handlePageChange: baseHandlePageChange, handlePageSizeChange: baseHandlePageSizeChange } = useWorkspaceSelection();
  const { currentWorkspaceId, getNodeShape, nodeData } = useWorkspaceData();
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

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: panelSelectedNodes,
  });

  type ColumnSelection = (typeof nodeColumnSelections)[number];

  const activeSelections = useMemo<ColumnSelection[]>(() => (
    isLocked ? activeNodeColumnSelections : nodeColumnSelections
  ), [isLocked, activeNodeColumnSelections, nodeColumnSelections]);

  const displayedNodes = useMemo(() => (
    panelSelectedNodes.slice(0, 1)
  ), [panelSelectedNodes]);

  const resolvedEnginePayload = useMemo(() => {
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
  }, [engineConfig]);

  const engineReady = resolvedEnginePayload.type === 'local'
    ? true
    : resolvedEnginePayload.isValid;

  const engineBadgeLabel = useMemo(() => {
    if (resolvedEnginePayload.type === 'remote') {
      return resolvedEnginePayload.isValid
        ? 'Remote Engine'
        : 'Remote Engine • Not configured';
    }
    return 'Local Engine';
  }, [resolvedEnginePayload]);

  const engineBadgeTitle = useMemo(() => {
    if (resolvedEnginePayload.type === 'remote') {
      if (resolvedEnginePayload.isValid && resolvedEnginePayload.normalizedUrl.length) {
        return `Remote Engine • ${resolvedEnginePayload.normalizedUrl}`;
      }
      return 'Remote Engine • Not configured';
    }
    return 'Local Engine';
  }, [resolvedEnginePayload]);

  const engineDisplayUrl = useMemo(() => {
    if (resolvedEnginePayload.type === 'remote') {
      if (resolvedEnginePayload.isValid && resolvedEnginePayload.normalizedUrl.length) {
        return resolvedEnginePayload.normalizedUrl;
      }
      return resolvedEnginePayload.rawUrl;
    }
    return '';
  }, [resolvedEnginePayload]);

  const buildEngineRequest = useCallback((): EngineRequestPayload | null => {
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
  }, [resolvedEnginePayload, engineConfig.url, updateRemoteUrl]);

  const handleEngineDialogSave = useCallback(() => {
    const payload = buildEngineRequest();
    if (!payload) {
      return;
    }
    closeEngineDialog();
  }, [buildEngineRequest, closeEngineDialog]);

  useEffect(() => {
    setEngineError(null);
  }, [engineConfig.type, engineConfig.url]);

  const persistContextLengthPreference = useCallback(async (value: number) => {
    if (!currentWorkspaceId) return;
    await textApi.postQuotationCurrentResult(
      currentWorkspaceId,
      { context_length: value, update_only: true },
      getAuthHeaders()
    );
  }, [currentWorkspaceId, getAuthHeaders]);

  const applyContextLengthPreferenceFromResult = useCallback((payload: any) => {
    const prefValue = Number(payload?.preferences?.context_length ?? payload?.preferences?.contextLength);
    if (!Number.isFinite(prefValue)) {
      return;
    }
    const normalized = clampContextLength(prefValue);
    setContextLength(normalized);
    setContextLengthInput(String(normalized));
  }, []);

  const getStringColumns = useCallback((node: any) => getColumnInfos(node).map(info => info.name), [getColumnInfos]);

  const applyContextLengthInput = useCallback(async () => {
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
  }, [contextLengthInput, hasLoaded, currentWorkspaceId, contextLength, persistContextLengthPreference]);

  const handleContextLengthBlur = useCallback(() => {
    void applyContextLengthInput();
  }, [applyContextLengthInput]);

  const handleContextLengthKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void applyContextLengthInput();
    }
  }, [applyContextLengthInput]);

  const hasIncompleteSelections = useMemo(() => (
    !displayedNodes.length || displayedNodes.some((node, idx) => {
      const nodeId = resolveNodeId(node, idx);
      const selection = activeSelections.find((sel) => sel.nodeId === nodeId);
      return !selection || !selection.column;
    })
  ), [activeSelections, displayedNodes]);

  const canRunQuotation = useMemo(() => (
    Boolean(currentWorkspaceId) && displayedNodes.length > 0 && !hasIncompleteSelections && engineReady
  ), [currentWorkspaceId, displayedNodes, hasIncompleteSelections, engineReady]);

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

  const currentRequestParams = useMemo(() => {
    const targetNode = (isLocked && lockedNodesSnapshot.length ? lockedNodesSnapshot[0] : displayedNodes[0]) as any;
    if (!targetNode) {
      return {} as Record<string, unknown>;
    }
    const nodeId = resolveNodeId(targetNode, 0);
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
  }, [activeSelections, displayedNodes, isLocked, lockedNodesSnapshot, nodeState, resolvedEnginePayload]);

  const hasParamsChanged = useParameterChangeDetection<Record<string, unknown>>(
    isLocked,
    currentRequestParams,
    lockedRequestParams
  );

    const resolveLockedNodeContext = useCallback((): { nodeId: string; column: string } | null => {
      const sourceNode = (isLocked && lockedNodesSnapshot.length ? lockedNodesSnapshot[0] : displayedNodes[0]) as any;
      if (!sourceNode) {
        return null;
      }
      const nodeId = resolveNodeId(sourceNode, 0);
      const selection = activeSelections.find((sel) => sel.nodeId === nodeId);
      const fallbackColumn = typeof lockedRequestParams?.column === 'string' ? lockedRequestParams.column : undefined;
      const column = selection?.column || fallbackColumn;
      if (!column) {
        return null;
      }
      return { nodeId, column };
    }, [
      activeSelections,
      displayedNodes,
      isLocked,
      lockedNodesSnapshot,
      lockedRequestParams,
    ]);

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

  // Colors for underline types
  const TYPE_COLORS: Record<string, string> = useMemo(() => ({
    speaker: '#2563eb', // blue-600
    quote: '#059669',   // emerald-600
    verb: '#7c3aed',    // violet-600
  }), []);

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
      textUnderlineOffset: '2px',
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
    const totalRows = Math.max(0, toNumber(rawPagination.total_rows, rows.length));
    const pagination = {
      page: Math.max(1, toNumber(rawPagination.page, 1)),
      page_size: pageSize,
      total_rows: totalRows,
      total_pages: Math.max(1, toNumber(rawPagination.total_pages, pageSize > 0 ? Math.ceil((totalRows || 1) / pageSize) : 1)),
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
  };

  const updateStoredQuotationResult = useCallback(async (
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

    const response = await textApi.postQuotationCurrentResult(
      currentWorkspaceId,
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
  }, [
    applyContextLengthPreferenceFromResult,
    currentWorkspaceId,
    getAuthHeaders,
    nodeState,
    resolveLockedNodeContext,
    resolvedEnginePayload,
    setLockedRequestParams,
    updateResultState,
  ]);

  const handleSearchAll = async () => {
    const targetNode = displayedNodes[0];
    const nodeId = targetNode ? resolveNodeId(targetNode, 0) : '';
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
    const nodeId = targetNode ? resolveNodeId(targetNode, 0) : '';
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
    const nodeId = targetNode ? resolveNodeId(targetNode, 0) : '';
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
      alert(`Error detaching quotation: ${e?.message || 'Unknown error'}`);
    } finally {
      setNodeDetaching(prev => ({ ...prev, [nodeId]: false }));
    }
  };

  // Hydration from backend once per mount
  const hydratedOnceRef = React.useRef<boolean>(false);
  useEffect(() => {
    (async () => {
      if (hydratedOnceRef.current) return;
      hydratedOnceRef.current = true;
      if (!currentWorkspaceId) return;
      try {
        const reqResp = await textApi.getQuotationCurrentRequest(currentWorkspaceId, getAuthHeaders());
        if (!reqResp) {
          return;
        }

        const requestData = (reqResp as any)?.data;
        const nodeId = requestData?.node_id || requestData?.nodeId;
        const column = requestData?.column || '';
        const reqEngine = (requestData?.engine ?? null) as QuotationEngineConfig | null;
        let hydratedEngine: EngineRequestPayload = (() => {
          if (resolvedEnginePayload.type === 'remote' && resolvedEnginePayload.isValid) {
            return { type: 'remote', url: resolvedEnginePayload.normalizedUrl } as EngineRequestPayload;
          }
          return { type: 'local' } as EngineRequestPayload;
        })();

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

        const res = await textApi.getQuotationCurrentResult(currentWorkspaceId, getAuthHeaders());
        if (!res) {
          return;
        }

        applyContextLengthPreferenceFromResult(res);
        const normalized = updateResultState(nodeId, column, res);
        setLockedRequestParams({
          column: normalized.column,
          page: normalized.pagination.page,
          page_size: normalized.pagination.page_size,
          sort_by: normalized.sorting.sort_by ?? null,
          sort_order: normalized.sorting.sort_order,
          engine_type: hydratedEngine.type,
          engine_url: hydratedEngine.type === 'remote' ? hydratedEngine.url : null,
        });
        setHasLoaded(true);
      } catch { /* ignore */ }
    })();
  }, [currentWorkspaceId, getAuthHeaders]);

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
                <CardTitle>Quotation Extraction</CardTitle>
                <CardDescription>Load quotations for a single node and highlight speaker, quote, and verb spans.</CardDescription>
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
              getNodeShapeFn={getNodeShape}
              showColorPicker={false}
              disabled={!!isLocked}
              locked={!!isLocked}
              originalCount={displayNodeCount}
              allowedDataTypes={['string']}
              lockedMessage={<AnalysisLockedNotice />}
            />
            <div className="flex flex-wrap gap-3">
              {hasParamsChanged ? (
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  onClick={handleSearchAll}
                  disabled={!canRunQuotation || isLoadingQuotations}
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
                  disabled={!canRunQuotation || isLoadingQuotations || !!isLocked}
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
              {hasLoaded && (
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full sm:w-auto"
                  onClick={async () => {
                    if (!currentWorkspaceId) return;
                    setIsClearing(true);
                    try {
                      try {
                        await textApi.clearQuotation(currentWorkspaceId, getAuthHeaders());
                      } catch {
                        /* ignore */
                      }
                    } finally {
                      setIsClearing(false);
                      setHasLoaded(false);
                      setResultsByNode({});
                      setNodeState({});
                      setLockedRequestParams(null);
                      unlockSelection();
                      setNodeColumnSelections([], { replace: true, persist: false });
                      recomputeAutoColumns();
                    }
                  }}
                  disabled={isClearing}
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
              )}
            </div>
          </CardContent>
        </Card>

        {hasLoaded && displayedNodes.length > 0 && displayedNodes.map((node, idx) => {
          const nodeId = resolveNodeId(node, idx);
          const nodeLabel = node.name || node.data?.name || node.data?.label || nodeId;
          const originalColumns = getStringColumns(node);
          const selection = activeSelections.find((s) => s.nodeId === nodeId);
          const textCol = selection?.column || '';
          
          // Core quotation columns from backend
          const coreQuotationCols = [
            'document_idx', 'speaker', 'speaker_start_idx', 'speaker_end_idx',
            'quote', 'quote_start_idx', 'quote_end_idx',
            'verb', 'verb_start_idx', 'verb_end_idx',
            'quote_type', 'quote_token_count', 'is_floating_quote', 'quote_row_idx',
            textCol // Include the selected text column
          ].filter(c => c); // Remove empty values
          
          const resultState = resultsByNode[nodeId];
          const fallbackRows: any[] = Array.isArray(nodeData?.data) ? nodeData.data : [];
          const rowsForRender = resultState?.rows?.length ? resultState.rows : fallbackRows;
          const columnsSource = resultState?.columns?.length
            ? resultState.columns
            : (rowsForRender.length > 0
              ? Object.keys(rowsForRender[0]).filter((key) => !key.startsWith('__'))
              : originalColumns);

          const allCols = columnsSource.filter((c: string) => !c.startsWith('__'));

          const cols = showMetadata
            ? allCols
            : allCols.filter((c: string) => coreQuotationCols.includes(c));
          return (
            <Card key={nodeId} className="overflow-hidden">
              <CardHeader className="gap-1 border-b bg-muted/40">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <CardTitle className="text-base">Quotations for {nodeLabel}</CardTitle>
                    <CardDescription>Text column: {textCol || 'Select a text column to view highlighted quotations.'}</CardDescription>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-foreground whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={showMetadata}
                      onChange={(e) => setShowMetadata(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <span>Show metadata</span>
                  </label>
                </div>
                <div className="mt-4 rounded-md border border-border/60 bg-muted/20 px-4 py-2">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="uppercase tracking-wide text-[10px] font-semibold text-foreground/80">Context length (words per side)</span>
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
                      className="h-8 w-20 text-right"
                      inputMode="numeric"
                      disabled={isSavingContextLength}
                    />
                    {isSavingContextLength && (
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Saving…</span>
                      </div>
                    )}
                    <span className={`text-[11px] ${contextLengthError ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {contextLengthError ?? `Enter a whole number between 0 and ${MAX_CONTEXT_LENGTH}.`}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  <ScrollArea
                    type="always"
                    scrollbars="both"
                    className="max-h-[70vh]"
                    style={{ scrollbarGutter: 'stable both-edges' }}
                  >
                    <div className="min-w-max">
                      <Table className="min-w-full">
                        <TableHeader className="bg-gray-50 sticky top-0 z-10">
                          <TableRow>
                            {cols.map((c: string) => (
                              <TableHead
                                key={c}
                                className="h-10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 select-none cursor-pointer hover:bg-gray-100 hover:text-gray-700 transition-colors whitespace-nowrap"
                                onClick={() => handleSort(nodeId, c)}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span>{c}</span>
                                  <ArrowUpDown className="h-3 w-3 opacity-50" />
                                </div>
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rowsForRender.length === 0 ? (
                            <TableRow>
                              <TableCell className="h-24 text-center text-muted-foreground" colSpan={cols.length || 1}>
                                No quotations
                              </TableCell>
                            </TableRow>
                          ) : (
                            rowsForRender.map((row: any, idx: number) => (
                              <TableRow key={idx} className="hover:bg-muted/50 transition-colors">
                              {cols.map((c: string, i: number) => {
                                const val = row?.[c];
                                const rowWithSpans = row;
                                const cellKey = `${nodeId}:${idx}:${i}`;
                                const content = (c === textCol)
                                  ? renderHighlightedText(typeof val === 'string' ? val : (val ?? ''), rowWithSpans, cellKey)
                                  : (val !== undefined && val !== null ? String(val) : '');
                                return (
                                  <TableCell
                                    key={i}
                                    className="px-4 py-2.5 text-sm align-top"
                                    style={{ lineHeight: 1.6 }}
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
                  {(() => {
                    const pag = resultState?.pagination || ((nodeData as any)?.pagination ?? {});
                    const page = Number(pag.page) || 1;
                    const page_size = Number(pag.page_size) || DEFAULT_PAGE_SIZE;
                    const total_rows = Number(pag.total_rows) || rowsForRender.length;
                    const total_pages = Number(pag.total_pages) || (page_size > 0 ? Math.max(1, Math.ceil((total_rows || 1) / page_size)) : 1);
                    const has_prev = typeof pag.has_prev === 'boolean' ? pag.has_prev : page > 1;
                    const has_next = typeof pag.has_next === 'boolean' ? pag.has_next : page < total_pages;
                    return (
                      <div className="flex flex-col gap-4 border-t border-border bg-muted/30 px-4 py-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <span>Show</span>
                            <Select value={String(page_size)} onValueChange={(value) => handlePageSizeChange(Number(value))}>
                              <SelectTrigger className="h-8 w-[110px] text-left">
                                <SelectValue placeholder="Rows" />
                              </SelectTrigger>
                              <SelectContent>
                                {[10, 20, 50, 100].map(sz => (
                                  <SelectItem key={sz} value={String(sz)}>
                                    {sz}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <span>rows</span>
                          </div>
                          <div>
                            Showing {Math.min((page - 1) * page_size + 1, total_rows)} to {Math.min(page * page_size, total_rows)} of {total_rows} rows
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handlePageChange(1)}
                            disabled={!has_prev}
                            title="First page"
                          >
                            <ChevronsLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handlePageChange(page - 1)}
                            disabled={!has_prev}
                            title="Previous page"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>Page</span>
                            <Input
                              type="number"
                              value={page}
                              onChange={(e) => {
                                const newPage = Number(e.target.value);
                                if (Number.isFinite(newPage) && newPage >= 1 && newPage <= total_pages) {
                                  handlePageChange(newPage);
                                }
                              }}
                              className="h-8 w-20 text-center"
                              min={1}
                              max={total_pages}
                            />
                            <span>of {total_pages}</span>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handlePageChange(page + 1)}
                            disabled={!has_next}
                            title="Next page"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handlePageChange(total_pages)}
                            disabled={!has_next}
                            title="Last page"
                          >
                            <ChevronsRight className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => handleDetach(nodeId)}
                            disabled={Boolean(nodeDetaching[nodeId])}
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
                        </div>
                      </div>
                    );
                  })()}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
};

export default QuotationFeature;
