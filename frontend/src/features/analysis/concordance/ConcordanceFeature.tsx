// NodeSelectionPanel now handles color selection UI inline
import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import { Tabs, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '../../../hooks/useWorkspaceStatus';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceActions } from '../../../hooks/useWorkspaceActions';
import { useAuth } from '../../../hooks/useAuth';
import useNodeColumnInfos from '../../../hooks/useNodeColumnInfos';
import { type ConcordanceAnalysisResponse, type ConcordanceResultEntry, textApi } from '../../../api/text';
import { useAnalysisStore } from '../../../stores/analysisStore';
import { useUIStore } from '../../../stores';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Play, Loader2, Trash2, Link as LinkIcon } from 'lucide-react';
import HelpIcon from '../../../components/help/HelpIcon';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { ANALYSIS_LOCKED_MESSAGE } from '../../../components/tabs/AnalysisLockedNotice';
import AnalysisTaskBanner from '../../../components/tabs/AnalysisTaskBanner';
import {
  hasLockedParameterDiff,
  resetAnalysisSelectionAfterClear,
  restoreAnalysisLockFromRequest,
  getNodeIdentifier,
  useAnalysisLock,
  useAnalysisFeature,
  useNodeColorManagement,
  useSafeResult,
  EXTENDED_PALETTE,
  getAnalysisActionState,
} from '../common';
import type { WorkspaceNodeLike } from '../common/nodeSelectionTypes';
import {
  pruneTasksById,
} from '../../../hooks/analysisTaskUtils';
import { useConcordanceTaskFlow, type PaginationState } from './hooks/useConcordanceTaskFlow';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { AnalysisPagination } from '../../../components/AnalysisPagination';
import { ConcordanceDetachDialog, type DetachNodeOption } from './components/ConcordanceDetachDialog';


const CORE_COLS = [
  'left_context', 'matched_text', 'right_context', 'start_idx',
  'end_idx', 'l1', 'r1',
];

const dedupeColumns = (cols: string[]): string[] => {
  const seen = new Set<string>();
  return cols.filter((col) => {
    if (seen.has(col)) {
      return false;
    }
    seen.add(col);
    return true;
  });
};

const highlightMatchInText = (
  textValue: string,
  startValue: unknown,
  endValue: unknown,
  fallbackMatch?: string,
  fallbackCaseSensitive?: boolean
): React.ReactNode => {
  if (typeof textValue !== 'string' || textValue.length === 0) {
    return textValue;
  }

  const parseIndex = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.floor(value);
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number.parseInt(value, 10);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  };

  let startIdx = parseIndex(startValue);
  let endIdx = parseIndex(endValue);

  if (startIdx === null || endIdx === null || endIdx <= startIdx) {
    if (fallbackMatch && fallbackMatch.length > 0) {
      const source = fallbackCaseSensitive ? textValue : textValue.toLowerCase();
      const needle = fallbackCaseSensitive ? fallbackMatch : fallbackMatch.toLowerCase();
      const fallbackIdx = source.indexOf(needle);
      if (fallbackIdx !== -1) {
        startIdx = fallbackIdx;
        endIdx = fallbackIdx + needle.length;
      }
    }
  }

  if (startIdx === null || endIdx === null || endIdx <= startIdx) {
    return textValue;
  }

  const safeStart = Math.max(0, Math.min(startIdx, textValue.length));
  const safeEnd = Math.max(safeStart, Math.min(endIdx, textValue.length));

  if (safeEnd <= safeStart) {
    return textValue;
  }

  return (
    <>
      {textValue.slice(0, safeStart)}
      <mark className="bg-yellow-200 text-gray-900 rounded px-1">
        {textValue.slice(safeStart, safeEnd)}
      </mark>
      {textValue.slice(safeEnd)}
    </>
  );
};

const ConcordanceFeature: React.FC = () => {
  // Anchor ref for results container to stabilize scroll on view mode toggle
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const { selectedNodes } = useWorkspaceSelection();
  const { isLoading } = useWorkspaceStatus();
  const { currentWorkspaceId } = useWorkspaceData();
  const { detachConcordance, selectNodes } = useWorkspaceActions();
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
  const [searchWord, setSearchWord] = useState('');
  const [numLeftTokens, setNumLeftTokens] = useState(10);
  const [numRightTokens, setNumRightTokens] = useState(10);
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [results, concordanceResultsRef, _setResultSafely, setResults] = useSafeResult<ConcordanceAnalysisResponse>();
  const labelToNodeId = (() => {
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
  })();

  // Color management & view mode
  const { nodeColors, handleColorChange, defaultPalette } = useNodeColorManagement({
    activeNodeIds,
    palette: EXTENDED_PALETTE,
  });
  const [viewMode, setViewMode] = useState<'separated'|'combined'>('separated');
  const [combinedPage, setCombinedPage] = useState(1);
  const [combinedPageSize] = useState(20);
  const [combinedLoading, setCombinedLoading] = useState(false);

  // Map any node's id/name variants to its assigned color (used in combined table)
  const sourceColorMap = (() => {
    const map: Record<string, string> = {};
    panelSelectedNodes.forEach((node, idx) => {
      const candidateIds = [
        node.id,
        node.node_id,
      ].map((val) => (typeof val === 'string' ? val : null)).filter(Boolean) as string[];
      const primaryId = candidateIds[0] ?? `node-${idx}`;
      const assigned = nodeColors[primaryId] || defaultPalette[idx % defaultPalette.length];
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
  })();
  
  const lastPendingConcordanceRef = useRef<number | null>(null);

  // Pagination and sorting state - separate for each node
  const [nodePagination, setNodePagination] = useState<PaginationState>({});
  
  // Individual node loading states for pagination/sorting (separate from main search)
  const [nodeLoading, setNodeLoading] = useState<Record<string, boolean>>({});
  
  // Individual node detaching states
  const [nodeDetaching, setNodeDetaching] = useState<Record<string, boolean>>({});
  
  // Detach dialog state
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [pendingDetachNodes, setPendingDetachNodes] = useState<{ nodeId: string; column: string; nodeLabel: string }[]>([]);
  const [selectedDetachColumns, setSelectedDetachColumns] = useState<Record<string, string[]>>({});
  const [detachNodeOptions, setDetachNodeOptions] = useState<DetachNodeOption[]>([]);
  
  // Global page size setting
  const [globalPageSize, setGlobalPageSize] = useState(20);
  
  // Detail view state
  const [selectedDetail, setSelectedDetail] = useState<Record<string, unknown> | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  
  // State for auto-triggering search from TokenFrequencyTab
  const [shouldAutoSearch, setShouldAutoSearch] = useState(false);



  const {
    resolveTaskId,
    setLocalTaskId: setLocalConcordanceTaskId,
    isRunning: isSearching,
    setIsRunning: setIsSearching,
    taskStatus: concordanceTaskStatus,
    banner: concordanceWaitingBanner,
    hasActiveTask,
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
      setRegex(!!reqObj.regex);
      setCaseSensitive(!!reqObj.case_sensitive);
      const hydratedMode: 'separated' | 'combined' = reqObj.combined && reqObj.combinable !== false ? 'combined' : 'separated';
      setViewMode(hydratedMode);
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
    onCleared: () => {
      setResults(null);
      setNodePagination({});
      setCombinedPage(1);
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

  const effectiveNodeColumnSelections = isLocked ? activeNodeColumnSelections : nodeColumnSelections;

  const {
    handleSearch,
    updateStoredResult,
    handleSort,
    handlePageChange,
    persistResultPreferences,
    handleDetach,
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
      combinedPageSize,
      numLeftTokens,
      numRightTokens,
      regex,
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
    },
    lock: {
      getAuthHeaders,
      lockWithSnapshots,
      resolveTaskId,
      detachConcordance,
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
  });

  useEffect(() => {
    if (viewMode === 'combined' && results && results.combinable === false) {
      // Defer to avoid synchronous setState in effect body (react-hooks/set-state-in-effect)
      const id = requestAnimationFrame(() => setViewMode('separated'));
      return () => cancelAnimationFrame(id);
    }
  }, [viewMode, results]);

  useEffect(() => {
    if (!results) {
      return;
    }

    const analysisParams = results?.analysis_params ?? {};
    const preferenceSource = results?.preferences ?? (analysisParams as Record<string, unknown>)?.preferences as Record<string, unknown> | undefined ?? {};

    const nextPageSize = preferenceSource?.page_size ?? analysisParams?.page_size;
    if (typeof nextPageSize === 'number' && Number.isFinite(nextPageSize) && nextPageSize > 0 && nextPageSize !== globalPageSize) {
      // Defer to avoid synchronous setState in effect body (react-hooks/set-state-in-effect)
      const id = requestAnimationFrame(() => {
        setGlobalPageSize(nextPageSize);
        setNodePagination(prev => {
          const updated = { ...prev };
          Object.keys(updated).forEach((nodeId) => {
            updated[nodeId] = {
              ...updated[nodeId],
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

  // React to pending concordance handoff from TokenFrequencyTab
  useEffect(() => {
    if (!pendingConcordance) return;
    if (lastPendingConcordanceRef.current === pendingConcordance.timestamp) {
      return;
    }
    lastPendingConcordanceRef.current = pendingConcordance.timestamp ?? null;

    // Defer to avoid synchronous setState in effect body (react-hooks/set-state-in-effect)
    const rafIds: number[] = [];
    const word = pendingConcordance.searchWord;
    if (word) {
      rafIds.push(requestAnimationFrame(() => setSearchWord(word)));
    }

    if (Array.isArray(pendingConcordance.selectedNodes) && pendingConcordance.selectedNodes.length > 0) {
      const targetIds = pendingConcordance.selectedNodes
        .map((node) => (typeof node?.id === 'string' ? node.id : ''))
        .filter((id): id is string => id.trim().length > 0)
        .slice(0, 2);
      if (targetIds.length > 0) {
        const currentIds = selectedNodes.map((node) => node.id);
        const needsSync =
          targetIds.length !== currentIds.length ||
          targetIds.some((id, index) => id !== currentIds[index]);
        if (needsSync) {
          try {
            selectNodes(targetIds);
          } catch (error) {
            console.warn('Failed to sync workspace selection from pending concordance:', error);
          }
        }
      }
    }

    if (pendingConcordance.nodeColumnSelections?.length) {
      setNodeColumnSelections(pendingConcordance.nodeColumnSelections, { replace: true });
    }

    if (pendingConcordance.nodeColors) {
      Object.entries(pendingConcordance.nodeColors).forEach(([nodeId, color]) => {
        handleColorChange(nodeId, color as string);
      });
    }

    const shouldAutoRun = pendingConcordance.autoRun === true;
    let timeoutId: number | null = null;
    const hasNodeTargets =
      selectedNodes.length > 0 ||
      (pendingConcordance.selectedNodes?.length ?? 0) > 0 ||
      (pendingConcordance.nodeColumnSelections?.length ?? 0) > 0;
    if (shouldAutoRun && pendingConcordance.searchWord && hasNodeTargets) {
      const delay = 50;
      timeoutId = window.setTimeout(() => {
        setShouldAutoSearch(true);
      }, delay);
    }

    clearPendingConcordance();
    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      rafIds.forEach(cancelAnimationFrame);
    };
  }, [pendingConcordance, selectedNodes, setNodeColumnSelections, clearPendingConcordance, selectNodes, handleColorChange]);

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
  }, [shouldAutoSearch, handleSearch]);

  const handleClearResults = async () => {
    if (!currentWorkspaceId) return;
    await clearResults();
  };

  const handleViewModeChange = (nextMode: 'separated' | 'combined') => {
    if (nextMode === viewMode) {
      return;
    }

    setViewMode(nextMode);

    if (nextMode === 'combined' && results?.combinable) {
      const prevAnchor = resultsRef.current;
      if (prevAnchor) {
        const rect = prevAnchor.getBoundingClientRect();
        prevAnchor.style.minHeight = `${rect.height}px`;
      }

      setTimeout(() => {
        const prevTop =
          prevAnchor?.getBoundingClientRect().top ??
          resultsRef.current?.getBoundingClientRect().top ??
          0;
        const prevScrollY = window.scrollY;

        setCombinedLoading(true);
        handleSearch(true, undefined, 'combined', undefined, undefined, true).finally(() => {
          setCombinedLoading(false);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const newAnchor = resultsRef.current;
              if (newAnchor) {
                const newTop = newAnchor.getBoundingClientRect().top;
                const delta = newTop - prevTop;
                if (Math.abs(delta) > 1) {
                  window.scrollTo({ top: prevScrollY + delta });
                }
                newAnchor.style.minHeight = '';
              } else {
                window.scrollTo({ top: prevScrollY });
              }
            });
          });
        });
      }, 30);

      return;
    }

    if (nextMode === 'separated') {
      const prevAnchor = resultsRef.current;
      const prevTop = prevAnchor?.getBoundingClientRect().top ?? 0;
      const prevScrollY = window.scrollY;

      handleSearch(true, undefined, 'separated', undefined, undefined, true).finally(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const newAnchor = resultsRef.current;
            if (newAnchor) {
              const newTop = newAnchor.getBoundingClientRect().top;
              const delta = newTop - prevTop;
              if (Math.abs(delta) > 1) {
                window.scrollTo({ top: prevScrollY + delta });
              }
              newAnchor.style.minHeight = '';
            } else {
              window.scrollTo({ top: prevScrollY });
            }
          });
        });
      });
    }
  };

  // Refetch combined results when combined page changes
  const lastCombinedQueryRef = useRef<string | null>(null);
  useEffect(() => {
    if (viewMode !== 'combined' || !results) {
      return;
    }
    const taskId =
      results?.metadata?.task_id ??
      (results?.metadata as Record<string, unknown> | undefined)?.taskId ??
      '';
    const key = `${taskId}|${combinedPage}|${combinedPageSize}`;
    if (lastCombinedQueryRef.current === key) {
      return;
    }
    lastCombinedQueryRef.current = key;
    void updateStoredResult({ combined: true, page: combinedPage, page_size: combinedPageSize });
  }, [viewMode, results, combinedPage, combinedPageSize, updateStoredResult]);


  const handleRowClick = (row: Record<string, unknown>, nodeId: string, column: string) => {
    if (!currentWorkspaceId) return;

    const record = { ...row };
    const availableColumns = Object.keys(record);
    const rawFullText = record[column];
    const fullText = rawFullText === null || rawFullText === undefined ? undefined : String(rawFullText);

    const detailPayload = {
      ...row,
      nodeId,
      column,
      full_text: fullText,
      record,
      available_columns: availableColumns,
      case_sensitive: row.case_sensitive ?? caseSensitive,
    };

    setSelectedDetail(detailPayload);
    setShowDetailModal(true);
  };

  const detailFullTextInfo = (() => {
    if (!selectedDetail) {
      return { text: null as string | null, highlighted: null as React.ReactNode };
    }

    const textCandidate =
      typeof selectedDetail.full_text === 'string'
        ? selectedDetail.full_text
        : typeof selectedDetail.text === 'string'
        ? selectedDetail.text
        : null;

    if (!textCandidate) {
      return { text: null as string | null, highlighted: null as React.ReactNode };
    }

    const highlighted = highlightMatchInText(
      textCandidate,
      selectedDetail.start_idx,
      selectedDetail.end_idx,
      (typeof selectedDetail.matched_text === 'string' && selectedDetail.matched_text.length > 0)
        ? selectedDetail.matched_text
        : searchWord,
      typeof selectedDetail.case_sensitive === 'boolean' ? selectedDetail.case_sensitive : caseSensitive
    );

    return { text: textCandidate, highlighted };
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
      setDetachNodeOptions(options);
      setDetachDialogOpen(true);
    } catch (error) {
      console.error('Failed to load concordance detach options:', error);
      toast.error(`Failed to load concordance detach options: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setPendingDetachNodes([]);
      setSelectedDetachColumns({});
    }
  };

  const toggleDetachColumn = (nodeId: string, column: string, checked: boolean) => {
    setSelectedDetachColumns(prev => {
      const current = prev[nodeId] || [];
      const next = checked
        ? [...current, column]
        : current.filter(c => c !== column);
      return { ...prev, [nodeId]: next };
    });
  };

  const handleDetachConfirm = async () => {
    for (const n of pendingDetachNodes) {
      const cols = selectedDetachColumns[n.nodeId] || [];
      await handleDetach(n.nodeId, n.column, n.nodeLabel, cols);
    }
    setDetachDialogOpen(false);
    setPendingDetachNodes([]);
    setSelectedDetachColumns({});
    setDetachNodeOptions([]);
  };

  const anyNodeDetaching = pendingDetachNodes.some(n => Boolean(nodeDetaching[n.nodeId]));

  const SortableHeader: React.FC<{ columnKey: string; label: string; paginationKey: string; requestNodeId: string }> = ({ columnKey, label, paginationKey, requestNodeId }) => {
    const nodeState = nodePagination[paginationKey] || { sortBy: '', descending: false };
    const isSorted = nodeState.sortBy === columnKey;
    const sortIcon = isSorted ? (nodeState.descending ? '▼' : '▲') : '▲▼';
    
    return (
      <TableHead 
        className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-wider cursor-pointer hover:bg-gray-100 ${isSorted ? 'text-blue-600' : 'text-gray-500'}`}
        onClick={() => handleSort(columnKey, paginationKey, requestNodeId)}
      >
        <div className="flex items-center space-x-1">
          <span>{label}</span>
          <span className={`text-xs ${isSorted ? 'text-blue-600' : 'text-gray-400'}`}>
            {sortIcon}
          </span>
        </div>
      </TableHead>
    );
  };

  const renderConcordanceTable = (
    nodeKey: string,
    nodeData: ConcordanceResultEntry,
    context: { nodeId: string; paginationKey: string; requestNodeId: string; column: string }
  ) => {
    const { nodeId: actualNodeId, paginationKey, requestNodeId, column } = context;
    const effectiveNodeId = actualNodeId || requestNodeId;
    const detachNodeId = actualNodeId || (labelToNodeId?.[nodeKey] ?? requestNodeId);
    const canDetach = Boolean(detachNodeId) && detachNodeId !== '__COMBINED__';
    if (nodeKey === '__COMBINED__') {
      const rows = nodeData.data || [];
      const columns: string[] = nodeData.columns || [];
      const combinedHasPrev = Boolean(nodeData.pagination?.has_prev);
      const combinedHasNext = Boolean(nodeData.pagination?.has_next);
      // Derive display columns: core first, then metadata (columns minus core and internal)
      const coreSet = new Set(CORE_COLS);
      const metaCols = columns.filter(c => !coreSet.has(c) && c !== '__source_node');
      const rawDisplayColumns = showMetadata
        ? [...CORE_COLS.filter(c => columns.includes(c)), ...metaCols]
        : CORE_COLS.filter(c => columns.includes(c));
      const displayColumns = dedupeColumns(rawDisplayColumns);

      return (
        <div key="__COMBINED__" className="mb-6">
          <div className="flex items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Combined Results</h3>
            <div className="ml-auto flex items-center space-x-2">
              <span className="text-xs text-gray-500">Rows colored by source node</span>
              <Button
                onClick={() => {
                  const nodeIdsForDetach = selectedNodes.slice(0,2).map(n => n.id);
                  if (nodeIdsForDetach.length === 0 || !searchWord.trim()) return;
                  const nodes = nodeIdsForDetach.map(nid => {
                    const col = effectiveNodeColumnSelections.find(s => s.nodeId === nid)?.column || '';
                    const sourceNode = panelSelectedNodes.find((node, idx) => getNodeIdentifier(node, idx) === nid);
                    const sourceLabel = (sourceNode?.name || sourceNode?.id || nid) as string;
                    return { nodeId: nid, column: col, nodeLabel: sourceLabel };
                  }).filter(n => n.column);
                  void openDetachDialog(nodes);
                }}
                disabled={combinedLoading || !searchWord.trim()}
                size="sm"
                className="bg-green-600 hover:bg-green-700"
              >
                <LinkIcon className="mr-2 h-4 w-4" />
                Detach Both
              </Button>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card">
            <ScrollArea
              type="hover"
              scrollbars="both"
              className="h-100"
            >
              <div className="min-w-max">
                <Table className="min-w-180" disableContainer>
                <TableHeader className="bg-gray-50 sticky top-0 z-10">
                  <TableRow>
                    {displayColumns.map((c: string) => (
                      <TableHead
                        key={c}
                        className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                      >
                        {c}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row: Record<string, unknown>, idx:number) => {
                    const rawSrc = row.__source_node;
                    const normalized = rawSrc ? rawSrc.toString().toLowerCase() : undefined;
                    let color = normalized ? sourceColorMap[normalized] : undefined;
                    if (!color && rawSrc && normalized) {
                      // Fallback: attempt partial / loose match (startsWith) if exact failed
                      const entry = Object.entries(sourceColorMap).find(([k]) => k.includes(normalized));
                      color = entry ? entry[1] : undefined;
                    }
                    if (!color) {
                      // Final fallback: deterministic by hashing source string
                      if (rawSrc) {
                        const chars = Array.from(rawSrc.toString()) as string[];
                        const hash = chars.reduce((a, c) => a + c.charCodeAt(0), 0);
                        color = defaultPalette[hash % defaultPalette.length];
                      } else {
                        color = '#ffffff';
                      }
                    }
                    const bg = `${color}20`; // light tint
                    return (
                      <TableRow key={idx} className="cursor-pointer" style={{ backgroundColor: bg }} onClick={() => {
                        if (rawSrc) {
                  const nodesForDetail = panelSelectedNodes;
                    const nodeObj = nodesForDetail.find((n: WorkspaceNodeLike) => {
                            const candidates = [n.id, n.name, n.name, (n as Record<string, unknown>).data && typeof (n as Record<string, unknown>).data === 'object' ? ((n as Record<string, unknown>).data as Record<string, unknown>)?.name : undefined, n.label, (n as Record<string, unknown>).data && typeof (n as Record<string, unknown>).data === 'object' ? ((n as Record<string, unknown>).data as Record<string, unknown>)?.label : undefined].filter(Boolean).map(v=>String(v).toLowerCase());
                            return candidates.includes(rawSrc.toString().toLowerCase());
                          });
                          const sel = nodeObj && effectiveNodeColumnSelections.find(s => s.nodeId === nodeObj.id);
                          if (nodeObj && sel?.column) handleRowClick(row, String(nodeObj.id ?? ''), sel.column);
                        }
                      }}>
                        {displayColumns.map((c: string, i: number) => <TableCell key={i}>{row[c] !== undefined && row[c] !== null ? String(row[c]) : ''}</TableCell>)}
                      </TableRow>
                    );
                  })}
                </TableBody>
                </Table>
              </div>
            </ScrollArea>
            <AnalysisPagination
              page={combinedPage}
              pageSize={combinedPageSize}
              hasNext={combinedHasNext}
              hasPrev={combinedHasPrev}
              totalPages={nodeData.pagination?.total_source_pages}
              onPageChange={(newPage) => setCombinedPage(newPage)}
              loading={combinedLoading}
            />
          </div>
        </div>
      );
    }
    // Build per-node display columns using metadata
    const rows = nodeData.data || [];
    const allCols: string[] = (nodeData.columns || (rows.length ? Object.keys(rows[0]) : [])) as string[];
    const metaCols: string[] = (nodeData.metadata?.metadata_columns as string[] | undefined) ?? allCols.filter(c => !CORE_COLS.includes(c));
    const rawDisplayColumns = showMetadata
      ? [...CORE_COLS.filter(c => allCols.includes(c)), ...metaCols.filter(c => allCols.includes(c))]
      : CORE_COLS.filter(c => allCols.includes(c));
    const displayColumns = dedupeColumns(rawDisplayColumns);
    const sortableColumns = new Set(metaCols);

    const currentNodePagination = nodePagination[paginationKey];
    const currentPage = currentNodePagination?.currentPage ?? 1;
    const nodeIsLoading = Boolean(nodeLoading[paginationKey]);
    const hasPrev = Boolean(nodeData.pagination?.has_prev) || currentPage > 1;
    const hasNext = Boolean(nodeData.pagination?.has_next);

    if (!nodeData.data || nodeData.data.length === 0) {
      return (
        <div key={nodeKey} className="mb-6">
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-center text-gray-500">
              No results on this page for &quot;{searchWord}&quot;
            </div>
          </div>
          {hasPrev && (
            <AnalysisPagination
              page={currentPage}
              pageSize={currentNodePagination?.pageSize ?? globalPageSize}
              hasNext={hasNext}
              hasPrev={hasPrev}
              totalPages={nodeData.pagination?.total_source_pages}
              onPageChange={(newPage) => handlePageChange(newPage, paginationKey, requestNodeId)}
              loading={nodeIsLoading}
            />
          )}
        </div>
      );
    }
    const detachingKey = detachNodeId ?? "";
    const isDetaching = detachingKey ? Boolean(nodeDetaching[detachingKey]) : false;

    return (
      <div key={nodeKey} className="mb-6">
        <div className="rounded-lg border border-border bg-card">
          <ScrollArea
            type="hover"
            scrollbars="both"
            className="h-100"
          >
            <div className="min-w-max">
              <Table className="min-w-180" disableContainer>
              <TableHeader className="bg-gray-50 sticky top-0 z-10">
                <TableRow>
                  {displayColumns.map(key => {
                    const isSortable = showMetadata && sortableColumns.has(key);
                    return isSortable ? (
                      <SortableHeader key={key} columnKey={key} label={key} paginationKey={paginationKey} requestNodeId={requestNodeId} />
                    ) : (
                      <TableHead key={key} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        {key}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodeData.data.map((row: Record<string, unknown>, index: number) => (
                  <TableRow 
                    key={index} 
                    className={`cursor-pointer ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                    onClick={() => {
                      handleRowClick(row, effectiveNodeId, column);
                    }}
                  >
                    {displayColumns.map((colKey: string, cellIndex) => (
                      <TableCell key={cellIndex}>
                        {row[colKey] !== null && row[colKey] !== undefined ? String(row[colKey]) : ''}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
              </Table>
            </div>
          </ScrollArea>
        </div>

        <AnalysisPagination
          page={currentPage}
          pageSize={nodePagination[paginationKey]?.pageSize ?? globalPageSize}
          hasNext={hasNext}
          hasPrev={hasPrev}
          totalPages={nodeData.pagination?.total_source_pages}
          onPageChange={(newPage) => handlePageChange(newPage, paginationKey, requestNodeId)}
          onPageSizeChange={(newSize) => {
            const previousPageSize = globalPageSize;
            const previousPagination = Object.fromEntries(
              Object.entries(nodePagination).map(([key, value]) => [key, { ...value }])
            ) as typeof nodePagination;

            setGlobalPageSize(newSize);
            setNodePagination((prev) => {
              const updated = { ...prev };
              Object.keys(updated).forEach((nid) => {
                updated[nid] = {
                  ...updated[nid],
                  pageSize: newSize,
                  currentPage: 1,
                };
              });
              return updated;
            });

            void (async () => {
              try {
                await persistResultPreferences({ pageSize: newSize });
              } catch (error) {
                console.error('Failed to persist concordance page size preference', error);
                setGlobalPageSize(previousPageSize);
                setNodePagination(previousPagination);
              }
            })();
          }}
          pageSizeOptions={[10, 20, 50, 100]}
          loading={nodeIsLoading}
        >
          {/* Detach button */}
          <Button
            onClick={() => {
              if (detachNodeId) {
                const detachNode = panelSelectedNodes.find((n) => n.id === detachNodeId);
                const detachLabel = (detachNode?.name || nodeKey) as string;
                void openDetachDialog([{ nodeId: detachNodeId, column, nodeLabel: detachLabel }]);
              }
            }}
            disabled={nodeIsLoading || isDetaching || !searchWord.trim() || !canDetach || !detachNodeId}
            size="sm"
            className="bg-green-600 hover:bg-green-700"
            title="Create a new node with concordance results joined to the original table"
          >
            {isDetaching ? (
              <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Detaching...</>
            ) : (
              <><LinkIcon className="mr-2 h-3 w-3" />Detach</>
            )}
          </Button>
        </AnalysisPagination>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Concordance Search
                <HelpIcon
                  targetKey="analysis.concordance.parameters"
                  label="Concordance parameters"
                  tooltip="Select nodes, choose the search term, and set context options before running."
                />
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
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

          <div className="space-y-6">
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
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-foreground">Left context (tokens)</label>
                  <input
                    type="number"
                    value={numLeftTokens}
                    onChange={(e) => setNumLeftTokens(parseInt(e.target.value) || 10)}
                    min="1"
                    max="50"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-foreground">Right context (tokens)</label>
                  <input
                    type="number"
                    value={numRightTokens}
                    onChange={(e) => setNumRightTokens(parseInt(e.target.value) || 10)}
                    min="1"
                    max="50"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={regex}
                    onChange={(e) => setRegex(e.target.checked)}
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
          <Button
            onClick={() => handleSearch(true)}
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
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={showMetadata}
                      onChange={(e) => {
                        const nextValue = e.target.checked;
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
                      className="h-4 w-4"
                    />
                    <span>Show metadata</span>
                  </label>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {results.data && Object.keys(results.data).length > 0 ? (
                  <div className={`grid gap-6 ${viewMode==='combined' ? 'grid-cols-1' : 'grid-cols-1'}`}>
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
                      
                      return renderConcordanceTable(nodeName, nodeData, {
                        nodeId: node?.id || '',
                        paginationKey,
                        requestNodeId,
                        column,
                      });
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-muted bg-muted/50 px-4 py-3 text-sm text-muted-foreground">No data available</div>
                )}
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
      {selectedDetail && (
        <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
          <DialogContent className="max-w-4xl w-full max-h-[80vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle>Concordance Detail</DialogTitle>
            </DialogHeader>

            <div className="overflow-y-auto max-h-[calc(80vh-120px)] pr-1">
              {/* Metadata */}
              <div className="mb-6 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium text-gray-700">Search Word:</span>
                  <span className="ml-2 font-mono bg-yellow-100 px-1 rounded">{searchWord}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">L1 Word:</span>
                  <span className="ml-2">{String(selectedDetail.l1 ?? '')}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">R1 Word:</span>
                  <span className="ml-2">{String(selectedDetail.r1 ?? '')}</span>
                </div>
              </div>

              {/* Full Text */}
              <div className="mb-6">
                <h4 className="font-medium text-gray-700 mb-2">Full Text from Column: {String(selectedDetail.column ?? '')}</h4>
                <div className="bg-gray-50 p-4 rounded-lg border">
                  <div className="font-mono text-sm whitespace-pre-wrap max-h-96 overflow-y-auto">
                    {detailFullTextInfo.text
                      ? detailFullTextInfo.highlighted ?? detailFullTextInfo.text
                      : 'Text not available'}
                  </div>
                </div>
              </div>

              {/* Document Metadata Table */}
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Document Metadata</h4>
                <div className="bg-white border border-border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader className="bg-gray-50">
                      <TableRow>
                        <TableHead className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Field</TableHead>
                        <TableHead className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selectedDetail.record && typeof selectedDetail.record === 'object') ? Object.entries(selectedDetail.record as Record<string, unknown>).map(([key, value]) => {
                        if (key === selectedDetail.column) {
                          return null;
                        }

                        let displayValue: string;
                        if (value === null || value === undefined) {
                          displayValue = 'null';
                        } else if (typeof value === 'object') {
                          displayValue = JSON.stringify(value, null, 2);
                        } else {
                          displayValue = String(value);
                        }

                        return (
                          <TableRow key={key}>
                            <TableCell className="font-medium">{key}</TableCell>
                            <TableCell>
                              <div className="max-w-md wrap-break-word">
                                {typeof value === 'object' && value !== null ? (
                                  <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                                    {displayValue}
                                  </pre>
                                ) : (
                                  displayValue
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }) : null}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

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
        handleDetachConfirm={handleDetachConfirm}
      />
    </div>
  );
};

export default ConcordanceFeature;
