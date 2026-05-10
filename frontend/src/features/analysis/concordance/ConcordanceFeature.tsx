// NodeSelectionPanel now handles color selection UI inline
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import NodeSelectionPanel from '@/components/NodeSelectionPanel';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkspaceSelection } from '@/hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '@/hooks/useWorkspaceStatus';
import { useWorkspaceData } from '@/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useAuth } from '@/hooks/useAuth';
import useNodeColumnInfos from '@/hooks/useNodeColumnInfos';
import { type ConcordanceAnalysisResponse, type ConcordanceDispersionBinRow, type ConcordanceGroupedRow, textApi } from '@/api/text';
import { useAnalysisStore } from '@/stores/analysisStore';
import { useUIStore } from '@/stores';
import { Button } from '@/components/ui/button';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Play, Loader2, Trash2 } from 'lucide-react';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';
import { ANALYSIS_LOCKED_MESSAGE } from '@/components/tabs/AnalysisLockedNotice';
import AnalysisTaskBanner from '@/components/tabs/AnalysisTaskBanner';
import {
  hasLockedParameterDiff,
  resetAnalysisSelectionAfterClear,
  restoreAnalysisLockFromRequest,
  useAnalysisLock,
  useAnalysisFeature,
  useNodeColorManagement,
  useSafeResult,
  EXTENDED_PALETTE,
  getAnalysisActionState,
  executeAnalysisRunOrUpdate,
} from '../common';
import type { WorkspaceNodeLike } from '../common/nodeSelectionTypes';
import {
  pruneTasksById,
} from '@/hooks/analysisTaskUtils';
import { useConcordanceTaskFlow, type PaginationState } from './hooks/useConcordanceTaskFlow';
import { useConcordanceMetadataColumns } from './hooks/useConcordanceMetadataColumns';
import { useConcordanceMaterializedEvents } from './hooks/useConcordanceMaterializedEvents';
import { useConcordancePendingHandoff } from './hooks/useConcordancePendingHandoff';
import { useConcordanceViewModeSwap } from './hooks/useConcordanceViewModeSwap';
import { ConcordanceTableNodeBlock } from './components/ConcordanceTableNodeBlock';
import { ConcordanceDispersionNodeBlock } from './components/ConcordanceDispersionNodeBlock';
import { RowDetailPanel } from '../common/components/RowDetailPanel';
import { useRowDetailDialog } from '../common/components/useRowDetailDialog';
import { highlightMatchInText } from '../common/components/highlightText';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ConcordanceDetachDialog } from './components/ConcordanceDetachDialog';
import type { DetachDialogNodeOption } from '../components/DetachColumnsDialog';
import { useDetachColumnsState } from '../common/hooks/useDetachColumnsState';
import { PageSizeSelect } from '../common/components/PageSizeSelect';
import {
  DISPERSION_DEFAULT_BIN_COUNT,
  DISPERSION_DISPLAY_BIN_COUNTS,
  type DispersionDisplayBinCount,
  type TaggedBinRow,
} from './concordanceViewModels';
import {
  CONCORDANCE_COLUMN_KEYS,
  CONCORDANCE_CORE_COLUMNS,
  CONCORDANCE_FREQ_COLUMNS,
} from '../generatedColumns';
import {
  MetadataColumnSelector,
} from '../common/components/MetadataColumnSelector';


const CORE_COLS = [...CONCORDANCE_CORE_COLUMNS];
const FREQ_COLS = [...CONCORDANCE_FREQ_COLUMNS];
const ALL_CONC_COLS_SET = new Set<string>([...CORE_COLS, ...FREQ_COLS]);



const ConcordanceFeature: React.FC = () => {
  // Anchor ref for results container to stabilize scroll on view mode toggle
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const { selectedNodes } = useWorkspaceSelection();
  const { isLoading } = useWorkspaceStatus();
  const { currentWorkspaceId } = useWorkspaceData();
  const { detachConcordance, materializeConcordance, selectNodes } = useWorkspaceActions();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'concordance';
  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
  });

  const { getAuthHeaders } = useAuth();
  const {
    isLocked,
    lockWithSnapshots,
    unlockSelection,
    nodeColumnSelections,
    setNodeColumnSelection,
    setNodeColumnSelections,
    recomputeAutoColumns,
    activeNodeColumnSelections,
    activeNodeIds,
    panelSelectedNodes,
    displayNodeCount,
    serverRequest,
  } = useAnalysisLock({
    analysisType: 'concordance_analysis',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    allowedDataTypes: ['string'],
    maxNodes: 2,
    docTypeOnly: true,
  });
  const pendingConcordance = useAnalysisStore((state) => state.pendingConcordance);
  const clearPendingConcordance = useAnalysisStore((state) => state.clearPendingConcordance);
  const setTasks = useAnalysisStore((state) => state.setTasks);
  const materializedEvents = useAnalysisStore((state) => state.materializedEvents);
  const [searchWord, setSearchWord] = useState('');
  const [numLeftTokens, setNumLeftTokens] = useState(10);
  const [numRightTokens, setNumRightTokens] = useState(10);
  const [regex, setRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(true);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [selectedMetadataColumns, setSelectedMetadataColumns] = useState<string[]>([]);
  const [concordanceView, setConcordanceView] = useState<'table' | 'dispersion'>('table');
  const showDispersion = concordanceView === 'dispersion';
  const [proportionalDispersionBars, setProportionalDispersionBars] = useState(false);
  const [colourMatches, setColourMatches] = useState(false);
  const [lowercaseMatches, setLowercaseMatches] = useState(false);
  const [hiddenMatchedTexts, setHiddenMatchedTexts] = useState<Set<string>>(new Set());
  const [binCount, setBinCount] = useState<DispersionDisplayBinCount>(DISPERSION_DEFAULT_BIN_COUNT);
  const [combinedSourceMode, setCombinedSourceMode] = useState<'aggregate' | 'split'>('aggregate');
  const [materializedBins, setMaterializedBins] = useState<Record<string, ConcordanceDispersionBinRow[]>>({});
  // Declared early so the position-fetch effect / lookups can reference it.
  // The setter is also used further below by the materialise-task watcher.
  const [materializedPaths, setMaterializedPaths] = useState<Record<string, string>>({});
  const [resultsViewportWidth, setResultsViewportWidth] = useState(0);
  const [results, concordanceResultsRef, _setResultSafely, setResults] = useSafeResult<ConcordanceAnalysisResponse>();
  const resultsViewportRef = useRef<HTMLDivElement | null>(null);
  const labelToNodeId = useMemo<Record<string, string> | null>(() => {
    const params = results?.analysis_params;
    const mapping = params?.label_to_node_map;
    if (mapping && typeof mapping === 'object') {
      const normalized: Record<string, string> = {};
      Object.entries(mapping).forEach(([label, value]) => {
        if (typeof label === 'string' && typeof value === 'string' && label) {
          normalized[label] = value;
        }
      });
      return normalized;
    }
    return null;
  }, [results]);

  // Color management & view mode
  const { nodeColors, handleColorChange, defaultPalette } = useNodeColorManagement({
    activeNodeIds,
    palette: EXTENDED_PALETTE,
  });

  const concordanceTaskId = useMemo(() => {
    const md = (results as ConcordanceAnalysisResponse | null)?.metadata as
      | Record<string, unknown>
      | undefined;
    const value = md?.task_id ?? md?.taskId;
    return typeof value === 'string' ? value : '';
  }, [results]);

  const resolveNodeIdForKey = useCallback((nodeKey: string): string | null => {
    if (nodeKey === '__COMBINED__') return null;
    const direct = panelSelectedNodes.find((n: WorkspaceNodeLike) => {
      const d = n.data as Record<string, unknown> | undefined;
      const dataName = d && typeof d === 'object' ? (d.name as string | undefined) : undefined;
      return n.id === nodeKey || n.name === nodeKey || dataName === nodeKey;
    });
    if (direct?.id) return direct.id;
    const mapped = labelToNodeId?.[nodeKey];
    if (mapped) return mapped;
    return null;
  }, [panelSelectedNodes, labelToNodeId]);

  const relevantNodeIdsForKey = (nodeKey: string): string[] => {
    if (nodeKey === '__COMBINED__') {
      return panelSelectedNodes
        .map((n: WorkspaceNodeLike) => n.id)
        .filter((id: string | undefined): id is string => Boolean(id));
    }
    const id = resolveNodeIdForKey(nodeKey);
    return id ? [id] : [];
  };

  // Fetch slim hit positions for any node that has been materialised on the
  // backend (signalled by an entry in client-side `materializedPaths`) but
  // whose positions aren't yet cached. Decoupled from `nodeData.materialized`
  // so combined-view lookups and not-yet-refreshed pages still work.
  useEffect(() => {
    if (!showDispersion || proportionalDispersionBars) return;
    // Same trick as the materialised-events consumer: when the bare task id is
    // briefly empty (results being refetched after a materialise), fall back
    // to the last known good value so we don't drop the fetch.
    const effectiveTaskId = concordanceTaskId || concordanceTaskIdRef.current;
    if (!effectiveTaskId) return;
    const panelIds = panelSelectedNodes
      .map((n: WorkspaceNodeLike) => n.id)
      .filter((id: string | undefined): id is string => Boolean(id));
    const validIds = Object.keys(materializedPaths).filter((id) => panelIds.includes(id));
    const missing = validIds.filter((id) => !(id in materializedBins));
    if (missing.length === 0) return;
    let cancelled = false;
    const authHeaders = getAuthHeaders();
    void Promise.all(
      missing.map(async (nodeId) => {
        try {
          const resp = await textApi.getConcordanceTaskDispersionBins(
            effectiveTaskId,
            nodeId,
            authHeaders,
          );
          return [nodeId, resp.rows] as const;
        } catch (err) {
          console.error('Failed to fetch concordance dispersion bins', nodeId, err);
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setMaterializedBins((prev) => {
        const next = { ...prev };
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDispersion, proportionalDispersionBars, concordanceTaskId, materializedPaths, panelSelectedNodes]);

  const isBlockMaterialised = (nodeKey: string): boolean => {
    const ids = relevantNodeIdsForKey(nodeKey);
    return ids.length > 0 && ids.every((id) => id in materializedPaths);
  };

  const getMaterializedBinsForKey = (
    nodeKey: string,
  ): TaggedBinRow[] | undefined => {
    const ids = relevantNodeIdsForKey(nodeKey);
    if (ids.length === 0) return undefined;
    if (!ids.every((id) => id in materializedPaths)) return undefined;
    if (!ids.every((id) => id in materializedBins)) return undefined;
    const tagged: TaggedBinRow[] = [];
    for (const id of ids) {
      const node = panelSelectedNodes.find((n: WorkspaceNodeLike) => n.id === id);
      const sourceLabel = (node?.name as string | undefined) ?? id;
      for (const row of materializedBins[id]!) {
        tagged.push({ ...row, __source_node: sourceLabel });
      }
    }
    return tagged;
  };

  const allMatchedTexts = useMemo((): string[] => {
    if (!showDispersion || !colourMatches || !results?.data) return [];
    const seen = new Set<string>();
    for (const [nodeKey, nodeData] of Object.entries(results.data)) {
      const binRows = getMaterializedBinsForKey(nodeKey);
      if (binRows) {
        for (const row of binRows) {
          const raw = String(row.matched_text ?? '');
          if (raw) seen.add(lowercaseMatches ? raw.toLowerCase() : raw);
        }
        continue;
      }
      for (const group of nodeData.data) {
        for (const hit of group) {
          const raw = String(hit[CONCORDANCE_COLUMN_KEYS.matchedText] ?? '');
          if (raw) seen.add(lowercaseMatches ? raw.toLowerCase() : raw);
        }
      }
    }
    return [...seen].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDispersion, colourMatches, lowercaseMatches, results?.data, materializedBins, materializedPaths, panelSelectedNodes]);

  const matchedTextColorMap = useMemo(
    (): Record<string, string> =>
      Object.fromEntries(allMatchedTexts.map((t, i) => [t, EXTENDED_PALETTE[i % EXTENDED_PALETTE.length]!])),
    [allMatchedTexts],
  );

  const [viewMode, setViewMode] = useState<'separated'|'combined'>('separated');
  const [combinedPage, setCombinedPage] = useState(1);

  useEffect(() => {
    const element = resultsViewportRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      setResultsViewportWidth(element.clientWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [results]);

  // Hoisted up so the metadata-column hook can read it (it consults each
  // panel node's selected text column to exclude it from the metadata list).
  const effectiveNodeColumnSelections = isLocked ? activeNodeColumnSelections : nodeColumnSelections;

  const { availableMetadataColumns, metadataColumnSections, metadataDisabledReason } =
    useConcordanceMetadataColumns({
      results,
      panelSelectedNodes,
      effectiveNodeColumnSelections,
      getColumnInfos,
      viewMode,
      nodeColors,
      resolveNodeIdForKey,
    });
  const availableMetadataColumnsKey = availableMetadataColumns.join('|');

  // Map any node's id/name variants to its assigned color (used in combined table).
  const sourceColorMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    panelSelectedNodes.forEach((node, idx) => {
      const candidateIds = [
        node.id,
        node.node_id,
      ].map((val) => (typeof val === 'string' ? val : null)).filter(Boolean) as string[];
      const primaryId = candidateIds[0] ?? `node-${idx}`;
      const assigned = (nodeColors[primaryId] || defaultPalette[idx % defaultPalette.length])!;
      const variants = new Set<string>();
      [
        primaryId,
        node.name,
        node.name,
        node.label,
        node.label,
      ].forEach((value) => {
        if (typeof value === 'string' && value.trim()) {
          variants.add(value);
        }
      });
      variants.forEach((value) => {
        map[value.toLowerCase()] = assigned;
      });
    });
    return map;
  }, [panelSelectedNodes, nodeColors, defaultPalette]);

  // Pagination and sorting state - separate for each node
  const [nodePagination, setNodePagination] = useState<PaginationState>({});
  
  // Individual node loading states for pagination/sorting (separate from main search)
  const [nodeLoading, setNodeLoading] = useState<Record<string, boolean>>({});
  
  // Individual node detaching states
  const [nodeDetaching, setNodeDetaching] = useState<Record<string, boolean>>({});

  // Individual node materializing states and tracked task ids
  const [nodeMaterializing, setNodeMaterializing] = useState<Record<string, boolean>>({});
  const [materializeTaskIds, setMaterializeTaskIds] = useState<Record<string, string>>({});
  const [materializeSummaries, setMaterializeSummaries] = useState<Record<string, { recordCount: number; uniqueDocuments: number; totalDocuments: number }>>({});
  
  // Detach dialog state
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [pendingDetachNodes, setPendingDetachNodes] = useState<{ nodeId: string; column: string; nodeLabel: string }[]>([]);
  const [detachNodeOptions, setDetachDialogNodeOptions] = useState<DetachDialogNodeOption[]>([]);
  const {
    selectedDetachColumns,
    setSelectedDetachColumns,
    toggleDetachColumn,
    selectAllDetachColumns,
    deselectAllDetachColumns,
  } = useDetachColumnsState(detachNodeOptions);
  
  // Global page size setting
  const [globalPageSize, setGlobalPageSize] = useState(20);
  
  // Detail view state
  const { detailPayload, detailOpen, setDetailOpen, openDetail: openRowDetail } = useRowDetailDialog();
  const [concordanceDetailExtra, setConcordanceDetailExtra] = useState<{
    concordanceHits: Array<Record<string, unknown>>;
    caseSensitive: boolean;
  } | null>(null);
  
  const {
    resolveTaskId,
    setLocalTaskId: setLocalConcordanceTaskId,
    isRunning: isSearching,
    setIsRunning: setIsSearching,
    taskStatus: concordanceTaskStatus,
    banner: concordanceWaitingBanner,
    hasActiveTask,
    hydrationState,
    clearResults,
  } = useAnalysisFeature<ConcordanceAnalysisResponse>({
    analysisType: 'concordance_analysis',
    taskType: 'concordance',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    resultRef: concordanceResultsRef,
    fetchResult: async (taskId, headers) =>
      textApi.getConcordanceTaskResult(taskId, headers),
    fetchRequest: async (taskId, headers) =>
      textApi.getConcordanceTaskRequest(taskId, headers),
    onResultFetched: (resultData) => {
      if (resultData) {
        setResults(resultData as ConcordanceAnalysisResponse);
      }
    },
    onHydratedResult: (resultPayload) => {
      const res = resultPayload?.data ?? resultPayload;
      if (res) {
        setResults(resultPayload as ConcordanceAnalysisResponse);
      }
    },
    onHydratedRequest: async (requestPayload) => {
      const req = (requestPayload as Record<string, unknown>)?.data ?? requestPayload;
      if (!req || typeof req !== 'object') return;
      const reqObj = req as Record<string, unknown>;
      const nodeIds: string[] = Array.isArray(reqObj.node_ids) ? reqObj.node_ids.slice(0, 2) : [];
      const node_columns: Record<string, string> = (reqObj.node_columns as Record<string, string>) || {};
      const sels = nodeIds.map((id: string) => ({ nodeId: id, column: node_columns[id] || '' }));
      setNodeColumnSelections(sels, { replace: true });
      setSearchWord(String(reqObj.search_word || ''));
      setNumLeftTokens(Number(reqObj.num_left_tokens ?? 10));
      setNumRightTokens(Number(reqObj.num_right_tokens ?? 10));
      const hydratedRegex = !!reqObj.regex;
      setRegex(hydratedRegex);
      setWholeWord(hydratedRegex ? false : typeof reqObj.whole_word === 'boolean' ? reqObj.whole_word : true);
      setCaseSensitive(!!reqObj.case_sensitive);
      const hydratedMode: 'separated' | 'combined' = reqObj.combined && reqObj.combinable !== false ? 'combined' : 'separated';
      setViewMode(hydratedMode);
      // Replace (not merge) on hydration so the saved task's materialised
      // state is the source of truth. Otherwise stale entries from a
      // previous task could survive a re-run that produced an empty
      // `materialized_paths`, leaving the Process All button incorrectly
      // disabled and the bin-fetch hitting "No materialised concordance for
      // node X" 404s. Also reset the bin cache + applied-event tracker so
      // the consumer + bin-fetch effects re-populate cleanly for whatever
      // the hydrated task contains.
      const paths = reqObj.materialized_paths as Record<string, string> | undefined;
      const nextPaths = (paths && typeof paths === 'object') ? { ...paths } : {};
      setMaterializedPaths(nextPaths);
      setMaterializedBins({});
      resetProcessedEvents();
      const summaries = reqObj.materialize_summaries as Record<string, Record<string, unknown>> | undefined;
      const nextSummaries: Record<string, { recordCount: number; uniqueDocuments: number; totalDocuments: number }> = {};
      if (summaries && typeof summaries === 'object') {
        for (const [nid, s] of Object.entries(summaries)) {
          nextSummaries[nid] = {
            recordCount: Number(s.record_count) || 0,
            uniqueDocuments: Number(s.unique_documents_with_hits) || 0,
            totalDocuments: Number(s.total_source_documents) || 0,
          };
        }
      }
      setMaterializeSummaries(nextSummaries);
      try {
        await restoreAnalysisLockFromRequest({
          workspaceId: currentWorkspaceId,
          requestData: req,
          getAuthHeaders,
          lockWithSnapshots,
          maxNodes: 2,
        });
      } catch { /* ignore */ }
    },
    onCleared: (_, options) => {
      setResults(null);
      setNodePagination({});
      setCombinedPage(1);
      setMaterializeSummaries({});
      if (options?.preserveLocalState) {
        return;
      }
      resetAnalysisSelectionAfterClear({ unlockSelection });
    },
    pruneGlobalTasks: (taskIds) => {
      setTasks((prev) => {
        if (!Array.isArray(prev)) return prev;
        return taskIds.length > 0 ? pruneTasksById(prev, taskIds) : prev;
      });
    },
    isResultRunning: (r) => r?.state === 'running',
  });

  // (effectiveNodeColumnSelections is declared above so it can be referenced
  // by the metadata-column section IIFE.)

  // No auto-selection on activation: Show metadata starts empty and the user
  // explicitly ticks the columns they want. We just clean up any selections
  // that are no longer in the available set (e.g. after a re-run that drops
  // a column from the source data).
  useEffect(() => {
    setSelectedMetadataColumns((prev) => {
      const filtered = prev.filter((column) => availableMetadataColumns.includes(column));
      if (filtered.length === prev.length) return prev;
      return filtered;
    });
  }, [availableMetadataColumns, availableMetadataColumnsKey]);

  const {
    handleSearch,
    updateStoredResult,
    handleSort,
    handlePageChange,
    persistResultPreferences,
    handleDetach,
    handleMaterialize,
  } = useConcordanceTaskFlow({
    state: {
      currentWorkspaceId,
      searchWord,
      isLocked,
      activeNodeIds,
      effectiveNodeColumnSelections,
      globalPageSize,
      nodePagination,
      viewMode,
      combinedPage,
      numLeftTokens,
      numRightTokens,
      regex,
      wholeWord,
      caseSensitive,
    },
    actions: {
      setNodePagination,
      setViewMode,
      setCombinedPage,
      setIsSearching,
      setResults,
      setLocalTaskId: setLocalConcordanceTaskId,
      setNodeLoading,
      setNodeDetaching,
      setNodeMaterializing,
      setMaterializeTaskIds,
    },
    lock: {
      getAuthHeaders,
      lockWithSnapshots,
      resolveTaskId,
      detachConcordance,
      materializeConcordance,
    },
  });

  const hasLockedParameterChanges = hasLockedParameterDiff({
    isLocked,
    serverRequest: (serverRequest as Record<string, unknown> | null) ?? null,
    currentParams: {
      search_word: searchWord,
      num_left_tokens: numLeftTokens,
      num_right_tokens: numRightTokens,
      regex,
      whole_word: wholeWord,
      case_sensitive: caseSensitive,
    },
    getServerParams: (request) => ({
      search_word: typeof request.search_word === 'string' ? request.search_word : '',
      num_left_tokens:
        typeof request.num_left_tokens === 'number'
          ? request.num_left_tokens
          : typeof request.num_tokens_left === 'number'
            ? request.num_tokens_left
            : 5,
      num_right_tokens:
        typeof request.num_right_tokens === 'number'
          ? request.num_right_tokens
          : typeof request.num_tokens_right === 'number'
            ? request.num_tokens_right
            : 5,
      regex: typeof request.regex === 'boolean' ? request.regex : false,
      whole_word:
        typeof request.regex === 'boolean' && request.regex
          ? false
          : typeof request.whole_word === 'boolean'
            ? request.whole_word
            : true,
      case_sensitive: typeof request.case_sensitive === 'boolean' ? request.case_sensitive : false,
    }),
  });

  const actionState = getAnalysisActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    hasSelection: panelSelectedNodes.length > 0,
    isLocked,
    hasResults: Boolean(results),
    isBusy: isSearching,
    hasActiveTask,
    allowRunWhenLocked: hasLockedParameterChanges,
    canUpdate: true,
  });

  // Track whether initial preference hydration from server results has been
  // applied.  After the first sync we stop overwriting globalPageSize from
  // response data to avoid a feedback loop: user changes page size → response
  // arrives with old page_size → effect overwrites user's choice → new request
  // fires → oscillation.
  const prefsSyncedRef = useRef(false);
  useEffect(() => {
    if (!results) {
      prefsSyncedRef.current = false;
      return;
    }
    // Only sync preferences on the first result load (hydration).
    if (prefsSyncedRef.current) return;
    prefsSyncedRef.current = true;

    const analysisParams = results?.analysis_params ?? {};
    const preferenceSource = results?.preferences ?? (analysisParams as Record<string, unknown>)?.preferences as Record<string, unknown> | undefined ?? {};

    // Fall back to the first node's resolved pagination.page_size (which reflects
    // server-side estimation) when the analysis params don't carry it.
    const firstNodeEntry = results?.data
      ? Object.values(results.data)[0]
      : undefined;
    const firstNodePageSize = firstNodeEntry?.pagination?.page_size;

    const nextPageSize = preferenceSource?.page_size ?? analysisParams?.page_size ?? firstNodePageSize;
    if (typeof nextPageSize === 'number' && Number.isFinite(nextPageSize) && nextPageSize > 0 && nextPageSize !== globalPageSize) {
      // Defer to avoid synchronous setState in effect body (react-hooks/set-state-in-effect)
      const id = requestAnimationFrame(() => {
        setGlobalPageSize(nextPageSize);
        setNodePagination(prev => {
          const updated = { ...prev };
          Object.keys(updated).forEach((nodeId) => {
            updated[nodeId] = {
              ...updated[nodeId]!,
              pageSize: nextPageSize,
            };
          });
          return updated;
        });
      });
      return () => cancelAnimationFrame(id);
    }

    const nextShowMetadata = preferenceSource?.show_metadata ?? analysisParams?.show_metadata;
    if (typeof nextShowMetadata === 'boolean' && nextShowMetadata !== showMetadata) {
      const id = requestAnimationFrame(() => setShowMetadata(nextShowMetadata));
      return () => cancelAnimationFrame(id);
    }
  }, [results, globalPageSize, showMetadata, setNodePagination]);

  // Materialize lifecycle: terminal-state task watcher, task-id ref reset,
  // and `analysis_materialized` SSE consumer. See hook for details.
  const { concordanceTaskIdRef, resetProcessedEvents } = useConcordanceMaterializedEvents({
    concordanceTaskId,
    materializeTaskIds,
    materializedEvents,
    getAuthHeaders,
    resolveTaskId,
    persistResultPreferences,
    setNodeMaterializing,
    setMaterializeTaskIds,
    setMaterializedPaths,
    setMaterializeSummaries,
    setMaterializedBins,
    setGlobalPageSize,
    setNodePagination,
  });

  // Preserve results across transient graph refetches: only clear when the actual set of selected IDs changes
  const selectedNodeIds = selectedNodes.map((node) => node.id).sort();
  const selectedNodeIdsKey = selectedNodeIds.join('|');
  const prevSelectedNodeIdsRef = React.useRef<string[] | null>(null);
  useEffect(() => {
    const prev = prevSelectedNodeIdsRef.current;
    const curr = selectedNodeIds;
    const changed = !prev || prev.length !== curr.length || prev.some((id, i) => id !== curr[i]);
    if (changed && !isLocked) {
      setResults(null);
    }
    prevSelectedNodeIdsRef.current = curr;
  }, [selectedNodeIdsKey, isLocked, selectedNodeIds, setResults]);

  useEffect(() => {
    if (!currentWorkspaceId) {
      setLocalConcordanceTaskId(null);
    }
  }, [currentWorkspaceId, setLocalConcordanceTaskId]);

  useEffect(() => {
    if (concordanceTaskStatus.tasks.length === 0) {
      setLocalConcordanceTaskId(null);
    }
  }, [concordanceTaskStatus.tasks.length, setLocalConcordanceTaskId]);

  const {
    queuedPendingConcordance,
    setQueuedPendingConcordance,
    handoffConfirmOpen,
    setHandoffConfirmOpen,
    handoffConfirmingRef,
    shouldAutoSearch,
    setShouldAutoSearch,
  } = useConcordancePendingHandoff({
    pendingConcordance,
    clearPendingConcordance,
    hydrationState,
    results,
    selectedNodes,
    setSearchWord,
    setNodeColumnSelections,
    selectNodes,
    handleColorChange,
  });

  // Recompute auto columns if unlocked and selections empty but nodes exist
  useEffect(() => {
    if (!isLocked && selectedNodes.length > 0 && nodeColumnSelections.length === 0) {
      recomputeAutoColumns();
    }
  }, [isLocked, selectedNodes, nodeColumnSelections, recomputeAutoColumns]);


  // Color assignment now handled by stack allocator - no auto-fill effect needed




  const handleColumnChange = (nodeId: string, column: string) => setNodeColumnSelection(nodeId, column);

  useEffect(() => {
    if (!shouldAutoSearch) {
      return;
    }
    // Defer to avoid synchronous setState in effect body (react-hooks/set-state-in-effect)
    const id = requestAnimationFrame(() => {
      setShouldAutoSearch(false);
      void handleSearch(true);
    });
    return () => cancelAnimationFrame(id);
  }, [shouldAutoSearch, handleSearch, setShouldAutoSearch]);

  const handleClearResults = async () => {
    if (!currentWorkspaceId) return;
    await clearResults();
  };

  const handleConfirmPendingConcordance = async () => {
    if (!queuedPendingConcordance) {
      setHandoffConfirmOpen(false);
      return;
    }
    handoffConfirmingRef.current = true;
    try {
      await clearResults({ preserveLocalState: true });
      setHandoffConfirmOpen(false);
    } finally {
      handoffConfirmingRef.current = false;
    }
  };

  const handleCancelPendingConcordance = () => {
    setQueuedPendingConcordance(null);
    setHandoffConfirmOpen(false);
  };

  const handleRunOrUpdate = async () => {
    await executeAnalysisRunOrUpdate({
      hasLockedParameterChanges,
      clearResults: handleClearResults,
      runFreshAnalysis: () =>
        handleSearch(
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          hasLockedParameterChanges,
        ),
    });
  };

  const { combinedLoading, handleViewModeChange } = useConcordanceViewModeSwap({
    viewMode,
    setViewMode,
    results,
    combinedPage,
    globalPageSize,
    updateStoredResult,
    resultsRef,
  });


  const handleRowClick = (
    row: Record<string, unknown>,
    nodeId: string,
    column: string,
    groupedHits?: ConcordanceGroupedRow,
  ) => {
    if (!currentWorkspaceId) return;

    const concordanceHits = groupedHits && groupedHits.length > 0 ? groupedHits : [row];
    const primaryRecord = concordanceHits[0] ?? row;
    const record = { ...primaryRecord };
    const rawFullText = record[column];
    const fullText = rawFullText === null || rawFullText === undefined ? undefined : String(rawFullText);

    setConcordanceDetailExtra({
      concordanceHits,
      caseSensitive: (typeof row.case_sensitive === 'boolean' ? row.case_sensitive : caseSensitive),
    });

    openRowDetail({
      record,
      textColumn: column,
      fullText,
      excludeMetadataColumns: [...ALL_CONC_COLS_SET, CONCORDANCE_COLUMN_KEYS.dispersion],
    });
  };

  const concordanceCustomization = (() => {
    if (!detailPayload || !concordanceDetailExtra) return undefined;
    const { record } = detailPayload;
    const { concordanceHits, caseSensitive: detailCaseSensitive } = concordanceDetailExtra;

    const matchedTextValue = record[CONCORDANCE_COLUMN_KEYS.matchedText];

    return {
      label: 'Concordance',
      summaryFields: [
        {
          label: 'Search Word',
          value: searchWord,
          highlight: true,
        },
        {
          label: 'Matches',
          value: String(concordanceHits.length),
        },
        {
          label: 'L1 Word',
          value: String(record[CONCORDANCE_COLUMN_KEYS.leftToken] ?? ''),
        },
        ...(record[CONCORDANCE_COLUMN_KEYS.leftTokenFreq] != null ? [{
          label: 'L1 Freq',
          value: String(record[CONCORDANCE_COLUMN_KEYS.leftTokenFreq]),
        }] : []),
        {
          label: 'R1 Word',
          value: String(record[CONCORDANCE_COLUMN_KEYS.rightToken] ?? ''),
        },
        ...(record[CONCORDANCE_COLUMN_KEYS.rightTokenFreq] != null ? [{
          label: 'R1 Freq',
          value: String(record[CONCORDANCE_COLUMN_KEYS.rightTokenFreq]),
        }] : []),
      ],
      renderDocumentText: (text: string) =>
        highlightMatchInText(
          text,
          concordanceHits.map((hit) => ({
            start: hit[CONCORDANCE_COLUMN_KEYS.startIdx],
            end: hit[CONCORDANCE_COLUMN_KEYS.endIdx],
          })),
          (typeof matchedTextValue === 'string' && matchedTextValue.length > 0)
            ? matchedTextValue
            : searchWord,
          detailCaseSensitive,
        ),
    };
  })();

  // --- Detach dialog helpers ---
  const openDetachDialog = async (nodes: { nodeId: string; column: string; nodeLabel: string }[]) => {
    setPendingDetachNodes(nodes);

    try {
      const responses = await Promise.all(
        nodes.map((node) => textApi.getConcordanceDetachOptions(node.nodeId, node.column, getAuthHeaders()))
      );
      const options = responses.flatMap((response) => response.data?.nodes ?? []);
      const initial: Record<string, string[]> = {};
      options.forEach((node) => {
        initial[node.node_id] = [];
      });
      setSelectedDetachColumns(initial);
      setDetachDialogNodeOptions(options);
      setDetachDialogOpen(true);
    } catch (error) {
      console.error('Failed to load concordance detach options:', error);
      toast.error(`Failed to load concordance detach options: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setPendingDetachNodes([]);
      setSelectedDetachColumns({});
    }
  };

  const handleDetachConfirm = async () => {
    for (const n of pendingDetachNodes) {
      const cols = selectedDetachColumns[n.nodeId] || [];
      await handleDetach(n.nodeId, n.column, n.nodeLabel, cols, materializedPaths[n.nodeId] ?? null);
    }
    setDetachDialogOpen(false);
    setPendingDetachNodes([]);
    setSelectedDetachColumns({});
    setDetachDialogNodeOptions([]);
  };

  const anyNodeDetaching = pendingDetachNodes.some(n => Boolean(nodeDetaching[n.nodeId]));


  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Concordance Search
                <InfoIcon
                  targetKey="concordance.overview"
                  label="About Concordance Search"
                  tooltip="Learn what concordance search is and how it can help you."
                />
                <HelpIcon
                  targetKey="analysis.concordance.parameters"
                  label="Concordance parameters"
                  tooltip="Select data blocks, choose the search term, and set context options before running."
                />
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <NodeSelectionPanel
            selectedNodes={panelSelectedNodes}
            nodeColumnSelections={effectiveNodeColumnSelections}
            onColumnChange={handleColumnChange}
            nodeColors={nodeColors}
            onColorChange={handleColorChange}
            defaultPalette={defaultPalette}
            maxCompare={2}
            className="border border-dashed border-muted-foreground/40 rounded-lg bg-muted/30 p-4"
            showShape
            disabled={!!isLocked}
            locked={!!isLocked}
            showColorPicker={true}
            getNodeColumns={getColumnInfos}
            allowedDataTypes={['string']}
            originalCount={displayNodeCount}
            lockedMessage={ANALYSIS_LOCKED_MESSAGE}
          />

          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="block text-sm font-medium text-foreground">Search word or phrase</label>
                  <HelpIcon targetKey="analysis.concordance.search-term" label="Concordance search term" />
                </div>
                <input
                  type="text"
                  value={searchWord}
                  onChange={(e) => setSearchWord(e.target.value)}
                  placeholder="Enter word or phrase to search for"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-foreground">Left context (tokens)</label>
                  <input
                    type="number"
                    value={numLeftTokens}
                    onChange={(e) => setNumLeftTokens(parseInt(e.target.value) || 0)}
                    min="0"
                    max="50"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-foreground">Right context (tokens)</label>
                  <input
                    type="number"
                    value={numRightTokens}
                    onChange={(e) => setNumRightTokens(parseInt(e.target.value) || 0)}
                    min="0"
                    max="50"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={wholeWord}
                    onChange={(e) => setWholeWord(e.target.checked)}
                    disabled={regex}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-foreground">Whole word</span>
                </label>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={regex}
                    onChange={(e) => {
                      const nextRegex = e.target.checked;
                      setRegex(nextRegex);
                      if (nextRegex) {
                        setWholeWord(false);
                      }
                    }}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-foreground">Use regular expression</span>
                </label>
                <HelpIcon targetKey="analysis.concordance.regex-toggle" label="Regex mode toggle" />
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-foreground">Case sensitive</span>
              </label>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center gap-3 pt-0">
          <DisabledReasonTooltip reason={(() => {
            if (isSearching) return undefined;
            if (actionState.runDisabledReason) return actionState.runDisabledReason;
            if (!searchWord.trim()) return 'Enter a search word first';
            if (effectiveNodeColumnSelections.some(sel => !sel.column)) return 'Select a column for each data block';
            return undefined;
          })()}>
            <Button
              onClick={() => {
                void handleRunOrUpdate();
              }}
              disabled={
                actionState.runDisabled ||
                !searchWord.trim() ||
                effectiveNodeColumnSelections.some(sel => !sel.column)
              }
              className="w-full md:w-auto"
            >
              {isSearching ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Running...</>
              ) : (
                <><Play className="mr-2 h-4 w-4" />{actionState.runLabel}</>
              )}
            </Button>
          </DisabledReasonTooltip>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleClearResults}
              variant="destructive"
              disabled={actionState.clearDisabled}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Results
            </Button>
            <HelpIcon targetKey="analysis.concordance.clear-results" label="Clear results" />
          </div>
          <PageSizeSelect
            value={globalPageSize}
            onChange={(newSize) => {
              setGlobalPageSize(newSize);
              setNodePagination((prev) => {
                const updated = { ...prev };
                Object.keys(updated).forEach((nid) => {
                  updated[nid] = { ...updated[nid]!, pageSize: newSize, currentPage: 1 };
                });
                return updated;
              });
              void persistResultPreferences({ pageSize: newSize });
            }}
          />
        </CardFooter>
      </Card>

      {concordanceWaitingBanner && (
        <AnalysisTaskBanner
          analysisName="Concordance"
          status={concordanceWaitingBanner.status}
          taskId={concordanceWaitingBanner.taskId}
          message={concordanceWaitingBanner.message}
          className="mt-4"
        />
      )}

      {/* Results */}
      {results?.state === 'successful' && (
        <Card ref={resultsRef}>
          <>
              <CardHeader className="space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      Search Results
                      <HelpIcon
                        targetKey="analysis.concordance.results"
                        label="Concordance results"
                        tooltip="Browse keyword-in-context hits, switch between separated/combined views, and adjust pagination."
                      />
                    </CardTitle>
                    {results.message && (
                      <CardDescription className="max-w-2xl text-sm text-muted-foreground">
                        {results.message}
                      </CardDescription>
                    )}
                  </div>
                  {panelSelectedNodes.length > 1 && (
                    <Tabs
                      value={viewMode}
                      onValueChange={(mode) => handleViewModeChange(mode as 'separated' | 'combined')}
                      className="w-full md:w-auto"
                    >
                      <TabsList aria-label="Concordance view mode">
                        <TabsTrigger value="separated">Separated</TabsTrigger>
                        {results?.combinable && (
                          <TabsTrigger value="combined">
                            {combinedLoading ? (
                              <span className="flex items-center gap-1">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Combined
                              </span>
                            ) : (
                              'Combined'
                            )}
                          </TabsTrigger>
                        )}
                      </TabsList>
                    </Tabs>
                  )}
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <Tabs
                      value={concordanceView}
                      onValueChange={(value) => {
                        const newView = value as 'table' | 'dispersion';
                        setConcordanceView(newView);
                        if (newView === 'table') {
                          setProportionalDispersionBars(false);
                          setColourMatches(false);
                          setLowercaseMatches(false);
                          setHiddenMatchedTexts(new Set());
                        }
                      }}
                    >
                      <TabsList>
                        <TabsTrigger value="table">Table View</TabsTrigger>
                        <TabsTrigger value="dispersion">Dispersion View</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <div className="flex flex-wrap items-center gap-4">
                      {showDispersion && !proportionalDispersionBars && (
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          <span>Bin No.</span>
                          <select
                            value={binCount}
                            onChange={(e) => {
                              const parsed = Number.parseInt(e.target.value, 10) as DispersionDisplayBinCount;
                              if ((DISPERSION_DISPLAY_BIN_COUNTS as readonly number[]).includes(parsed)) {
                                setBinCount(parsed);
                              }
                            }}
                            className="h-7 rounded border border-input bg-background px-2 text-sm"
                          >
                            {DISPERSION_DISPLAY_BIN_COUNTS.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <MetadataColumnSelector
                        showMetadata={showMetadata}
                        onShowMetadataChange={(nextValue) => {
                          const previousValue = showMetadata;
                          setShowMetadata(nextValue);
                          void (async () => {
                            try {
                              await persistResultPreferences({ showMetadata: nextValue });
                            } catch (error) {
                              console.error('Failed to persist concordance metadata preference', error);
                              setShowMetadata(previousValue);
                            }
                          })();
                        }}
                        availableColumns={availableMetadataColumns}
                        selectedColumns={selectedMetadataColumns ?? []}
                        onSelectedColumnsChange={setSelectedMetadataColumns}
                        sections={metadataColumnSections}
                        disabledReason={metadataDisabledReason}
                      />
                    </div>
                  </div>
                  {showDispersion ? (
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={proportionalDispersionBars}
                          onChange={(e) => setProportionalDispersionBars(e.target.checked)}
                          className="h-4 w-4"
                        />
                        <span>Bar length proportional to text length</span>
                      </label>
                      {!proportionalDispersionBars && viewMode === 'combined' && (
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          <span>Sources:</span>
                          <select
                            value={combinedSourceMode}
                            onChange={(e) => setCombinedSourceMode(e.target.value as 'aggregate' | 'split')}
                            className="h-7 rounded border border-input bg-background px-2 text-sm"
                          >
                            <option value="aggregate">Aggregate</option>
                            <option value="split">Split (solid/dashed)</option>
                          </select>
                        </label>
                      )}
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={colourMatches}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setColourMatches(checked);
                            if (!checked) {
                              setLowercaseMatches(false);
                              setHiddenMatchedTexts(new Set());
                            }
                          }}
                          className="h-4 w-4"
                        />
                        <span>Colour matches</span>
                      </label>
                      {colourMatches && (
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          <input
                            type="checkbox"
                            checked={lowercaseMatches}
                            onChange={(e) => {
                              setLowercaseMatches(e.target.checked);
                              setHiddenMatchedTexts(new Set());
                            }}
                            className="h-4 w-4"
                          />
                          <span>Lowercase matches</span>
                        </label>
                      )}
                    </div>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                <div ref={resultsViewportRef} className="space-y-4">
                {results.data && Object.keys(results.data).length > 0 ? (
                  <div className={`grid gap-4 ${viewMode==='combined' ? 'grid-cols-1' : 'grid-cols-1'}`}>
                    {Object.entries(results.data).filter(([k]) => viewMode==='combined' ? k==='__COMBINED__' : k !== '__COMBINED__').map(([nodeName, nodeData]) => {
                      const nodesForDetail = panelSelectedNodes;
                      const keyedOrder = Object.keys(results.data);
                      const approxIndex = keyedOrder.indexOf(nodeName);
                      let node = nodesForDetail.find((n: WorkspaceNodeLike) => {const d = n.data as Record<string,unknown> | undefined; return ((d?.name as string | undefined) || n.id) === nodeName;});
                      if (!node) {
                        node = nodesForDetail.find((n: WorkspaceNodeLike) => n.id === nodeName);
                      }
                      if (!node) {
                        node = nodesForDetail.find((n: WorkspaceNodeLike) => n.name === nodeName);
                      }
                      const mappedNodeId = labelToNodeId?.[nodeName];
                      if (!node && mappedNodeId) {
                        node = nodesForDetail.find((n: WorkspaceNodeLike) => n.id === mappedNodeId);
                      }
                      if (!node) {
                        node = nodesForDetail[approxIndex];
                      }
                      
                      const resolvedNodeId = node?.id || mappedNodeId || '';
                      const paginationKey = resolvedNodeId || nodeName;
                      const requestNodeId = resolvedNodeId || nodeName;
                      const selection = effectiveNodeColumnSelections.find(sel => sel.nodeId === resolvedNodeId);
                      const column = selection?.column || '';
                      
                      const nodeDisplayName = (node?.name || nodeName) as string;
                      const nodeColor = sourceColorMap[nodeName.toLowerCase()]
                        || sourceColorMap[(node?.id || '').toLowerCase()]
                        || sourceColorMap[(node?.name || '').toLowerCase()]
                        || defaultPalette[approxIndex % defaultPalette.length];

                      const blockContext = {
                        nodeId: node?.id || '',
                        paginationKey,
                        requestNodeId,
                        column,
                        displayName: nodeDisplayName,
                        nodeColor,
                      };
                      const sharedProps = {
                        nodeKey: nodeName,
                        nodeData,
                        context: blockContext,
                        searchWord,
                        showMetadata,
                        selectedMetadataColumns,
                        selectedNodes,
                        panelSelectedNodes,
                        effectiveNodeColumnSelections,
                        labelToNodeId,
                        sourceColorMap,
                        defaultPalette,
                        nodePagination,
                        globalPageSize,
                        combinedPage,
                        combinedLoading,
                        nodeLoading,
                        nodeDetaching,
                        nodeMaterializing,
                        materializedPaths,
                        materializeSummaries,
                        handlePageChange,
                        handleRowClick,
                        handleMaterialize,
                        setCombinedPage,
                        openDetachDialog,
                      };
                      return concordanceView === 'dispersion' ? (
                        <ConcordanceDispersionNodeBlock
                          key={nodeName}
                          {...sharedProps}
                          resultsViewportWidth={resultsViewportWidth}
                          proportionalDispersionBars={proportionalDispersionBars}
                          colourMatches={colourMatches}
                          lowercaseMatches={lowercaseMatches}
                          hiddenMatchedTexts={hiddenMatchedTexts}
                          setHiddenMatchedTexts={setHiddenMatchedTexts}
                          binCount={binCount}
                          combinedSourceMode={combinedSourceMode}
                          allMatchedTexts={allMatchedTexts}
                          matchedTextColorMap={matchedTextColorMap}
                          getMaterializedBinsForKey={getMaterializedBinsForKey}
                          isBlockMaterialised={isBlockMaterialised}
                        />
                      ) : (
                        <ConcordanceTableNodeBlock
                          key={nodeName}
                          {...sharedProps}
                          handleSort={handleSort}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-muted bg-muted/50 px-4 py-3 text-sm text-muted-foreground">No data available</div>
                )}
                </div>
              </CardContent>
          </>
        </Card>
      )}

      {results?.state === 'failed' && (
        <Card>
          <CardContent>
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {results?.message ?? 'The search failed. Please try again.'}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detail Modal */}
      <RowDetailPanel
        open={detailOpen}
        onOpenChange={setDetailOpen}
        payload={detailPayload}
        customization={concordanceCustomization}
      />

      {/* Loading State */}
      {isLoading.graph && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-gray-600 mt-2">Loading workspace...</p>
        </div>
      )}

      {/* Detach column selection dialog */}
      <ConcordanceDetachDialog
        open={detachDialogOpen}
        onOpenChange={setDetachDialogOpen}
        isDetaching={anyNodeDetaching}
        detachNodeOptions={detachNodeOptions}
        selectedDetachColumns={selectedDetachColumns}
        toggleDetachColumn={toggleDetachColumn}
        selectAllDetachColumns={selectAllDetachColumns}
        deselectAllDetachColumns={deselectAllDetachColumns}
        handleDetachConfirm={handleDetachConfirm}
      />
      <ConfirmDialog
        open={handoffConfirmOpen}
        onOpenChange={(open) => {
          setHandoffConfirmOpen(open);
          if (!open && queuedPendingConcordance && !handoffConfirmingRef.current) {
            handleCancelPendingConcordance();
          }
        }}
        title="Replace concordance results?"
        description="This will clear the current concordance results and fill the clicked token into the search box."
        confirmText="Clear and fill token"
        cancelText="Keep current results"
        onConfirm={() => {
          void handleConfirmPendingConcordance();
        }}
      />
    </div>
  );
};

export default ConcordanceFeature;
