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
import { type ConcordanceAnalysisResponse, type ConcordanceGroupedRow, type ConcordanceResultEntry, textApi } from '../../../api/text';
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
  executeAnalysisRunOrUpdate,
} from '../common';
import type { WorkspaceNodeLike } from '../common/nodeSelectionTypes';
import {
  pruneTasksById,
} from '../../../hooks/analysisTaskUtils';
import { useConcordanceTaskFlow, type PaginationState } from './hooks/useConcordanceTaskFlow';
import { RowDetailPanel } from '../common/components/RowDetailPanel';
import { useRowDetailDialog } from '../common/components/useRowDetailDialog';
import { highlightMatchInText } from '../common/components/highlightText';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AnalysisPagination } from '../../../components/AnalysisPagination';
import { AnalysisTableScrollArea } from '../../../components/AnalysisTableScrollArea';
import { ConcordanceDetachDialog, type DetachNodeOption } from './components/ConcordanceDetachDialog';
import { ConcordanceDispersionCell } from './components/ConcordanceDispersionCell';
import {
  buildDispersionRows,
  flattenConcordanceGroups,
  getDispersionBarWidthPercent,
  getDispersionHits,
  getDispersionTextLength,
} from './concordanceViewModels';
import {
  CONCORDANCE_COLUMN_KEYS,
  CONCORDANCE_CORE_COLUMNS,
  CONCORDANCE_DISPERSION_COLUMN,
} from '../generatedColumns';
import {
  MetadataColumnSelector,
} from '../common/components/MetadataColumnSelector';
import { GroupedResultsPageSizeSummary } from '../common/components/GroupedResultsPageSizeSummary';
import { reconcileMetadataColumnSelection } from '../common/components/metadataColumnSelection';


const CORE_COLS = [...CONCORDANCE_CORE_COLUMNS];

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

const hasSuccessfulConcordanceResults = (result: ConcordanceAnalysisResponse | null): boolean =>
  Boolean(result && result.state === 'successful');

const getDispersionColumnStyle = (
  isDispersionVisible: boolean,
  isMetadataVisible: boolean,
  visibleWidth: number,
): React.CSSProperties | undefined => {
  if (!isDispersionVisible || !isMetadataVisible) {
    return undefined;
  }

  if (visibleWidth <= 0) {
    return undefined;
  }

  const columnWidth = `${Math.floor(visibleWidth / 2)}px`;
  return {
    width: columnWidth,
    minWidth: columnWidth,
    maxWidth: columnWidth,
  };
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
  const [wholeWord, setWholeWord] = useState(true);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [selectedMetadataColumns, setSelectedMetadataColumns] = useState<string[] | null>(null);
  const [showDispersion, setShowDispersion] = useState(false);
  const [proportionalDispersionBars, setProportionalDispersionBars] = useState(false);
  const [resultsViewportWidth, setResultsViewportWidth] = useState(0);
  const [results, concordanceResultsRef, _setResultSafely, setResults] = useSafeResult<ConcordanceAnalysisResponse>();
  const resultsViewportRef = useRef<HTMLDivElement | null>(null);
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

  const availableMetadataColumns = (() => {
    const metadataColumnSet = new Set<string>();
    const resultEntries = results?.data ?? {};

    Object.values(resultEntries).forEach((entry) => {
      const nodeEntry = entry as ConcordanceResultEntry;
      nodeEntry.metadata.metadata_columns.forEach((column) => {
        if (column && column !== '__source_node') {
          metadataColumnSet.add(column);
        }
      });
    });

    return Array.from(metadataColumnSet);
  })();
  const availableMetadataColumnsKey = availableMetadataColumns.join('|');

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
  const { detailPayload, detailOpen, setDetailOpen, openDetail: openRowDetail } = useRowDetailDialog();
  const [concordanceDetailExtra, setConcordanceDetailExtra] = useState<{
    concordanceHits: Array<Record<string, unknown>>;
    caseSensitive: boolean;
  } | null>(null);
  
  // State for auto-triggering search from TokenFrequencyTab
  const [shouldAutoSearch, setShouldAutoSearch] = useState(false);
  const [queuedPendingConcordance, setQueuedPendingConcordance] = useState(pendingConcordance);
  const [handoffConfirmOpen, setHandoffConfirmOpen] = useState(false);
  const handoffConfirmingRef = useRef(false);



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

  const effectiveNodeColumnSelections = isLocked ? activeNodeColumnSelections : nodeColumnSelections;
  const preferredMetadataColumns = dedupeColumns(
    effectiveNodeColumnSelections.map((selection) => selection.column).filter(Boolean),
  );

  useEffect(() => {
    setSelectedMetadataColumns((previousSelection) => {
      const nextSelection = reconcileMetadataColumnSelection(
        availableMetadataColumns,
        previousSelection,
        preferredMetadataColumns,
      );
      const normalizedPreviousSelection = previousSelection ?? [];
      if (
        normalizedPreviousSelection.length === nextSelection.length &&
        normalizedPreviousSelection.every((column, index) => column === nextSelection[index])
      ) {
        return previousSelection;
      }
      return nextSelection;
    });
  }, [availableMetadataColumns, availableMetadataColumnsKey, preferredMetadataColumns]);

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

  // Queue concordance handoffs from TokenFrequencyTab so hydration can settle first.
  useEffect(() => {
    if (!pendingConcordance) return;
    if (lastPendingConcordanceRef.current === pendingConcordance.timestamp) {
      return;
    }
    lastPendingConcordanceRef.current = pendingConcordance.timestamp ?? null;
    const id = requestAnimationFrame(() => {
      setQueuedPendingConcordance(pendingConcordance);
      clearPendingConcordance();
    });
    return () => cancelAnimationFrame(id);
  }, [pendingConcordance, clearPendingConcordance]);

  useEffect(() => {
    if (!queuedPendingConcordance) {
      if (handoffConfirmOpen) {
        const id = requestAnimationFrame(() => setHandoffConfirmOpen(false));
        return () => cancelAnimationFrame(id);
      }
      return;
    }

    const hydrationSettled =
      hydrationState.status === 'error' ||
      (hydrationState.status === 'idle' && typeof hydrationState.lastHydratedAt === 'number');
    if (!hydrationSettled) {
      return;
    }

    if (hasSuccessfulConcordanceResults(results)) {
      if (!handoffConfirmOpen) {
        const id = requestAnimationFrame(() => setHandoffConfirmOpen(true));
        return () => cancelAnimationFrame(id);
      }
      return;
    }

    const rafIds: number[] = [];
    const word = queuedPendingConcordance.searchWord;
    if (word) {
      rafIds.push(requestAnimationFrame(() => setSearchWord(word)));
    }

    if (Array.isArray(queuedPendingConcordance.selectedNodes) && queuedPendingConcordance.selectedNodes.length > 0) {
      const targetIds = queuedPendingConcordance.selectedNodes
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

    if (queuedPendingConcordance.nodeColumnSelections?.length) {
      setNodeColumnSelections(queuedPendingConcordance.nodeColumnSelections, { replace: true });
    }

    if (queuedPendingConcordance.nodeColors) {
      Object.entries(queuedPendingConcordance.nodeColors).forEach(([nodeId, color]) => {
        handleColorChange(nodeId, color as string);
      });
    }

    let timeoutId: number | null = null;
    const hasNodeTargets =
      selectedNodes.length > 0 ||
      (queuedPendingConcordance.selectedNodes?.length ?? 0) > 0 ||
      (queuedPendingConcordance.nodeColumnSelections?.length ?? 0) > 0;
    if (queuedPendingConcordance.autoRun === true && queuedPendingConcordance.searchWord && hasNodeTargets) {
      timeoutId = window.setTimeout(() => {
        setShouldAutoSearch(true);
      }, 50);
    }

    const resetId = requestAnimationFrame(() => {
      setQueuedPendingConcordance(null);
      setHandoffConfirmOpen(false);
    });

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      rafIds.forEach(cancelAnimationFrame);
      cancelAnimationFrame(resetId);
    };
  }, [
    queuedPendingConcordance,
    hydrationState.status,
    hydrationState.lastHydratedAt,
    results,
    handoffConfirmOpen,
    selectedNodes,
    setNodeColumnSelections,
    selectNodes,
    handleColorChange,
  ]);

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
        updateStoredResult({ combined: true, page: combinedPage, page_size: combinedPageSize }).finally(() => {
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

      updateStoredResult({ combined: false, page: 1, page_size: globalPageSize }).finally(() => {
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
      excludeMetadataColumns: [...CORE_COLS, CONCORDANCE_COLUMN_KEYS.dispersion],
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
        {
          label: 'R1 Word',
          value: String(record[CONCORDANCE_COLUMN_KEYS.rightToken] ?? ''),
        },
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
      const groupedRows = nodeData.data;
      const rows = showDispersion
        ? buildDispersionRows(groupedRows)
        : flattenConcordanceGroups(groupedRows);
      const longestTextLength = showDispersion && proportionalDispersionBars
        ? rows.reduce((max, row) => Math.max(max, getDispersionTextLength(row, column)), 0)
        : 0;
      const columns = nodeData.columns;
      const combinedHasPrev = Boolean(nodeData.pagination?.has_prev);
      const combinedHasNext = Boolean(nodeData.pagination?.has_next);
      const metaCols = nodeData.metadata.metadata_columns;
      const visibleMetaCols = (selectedMetadataColumns ?? []).filter((columnName) => metaCols.includes(columnName));
      const rawDisplayColumns = showDispersion
        ? (showMetadata ? [CONCORDANCE_DISPERSION_COLUMN, ...visibleMetaCols] : [CONCORDANCE_DISPERSION_COLUMN])
        : (showMetadata
          ? [...CORE_COLS.filter(c => columns.includes(c)), ...visibleMetaCols]
          : CORE_COLS.filter(c => columns.includes(c)));
      const displayColumns = dedupeColumns(rawDisplayColumns);
      const dispersionColumnStyle = getDispersionColumnStyle(showDispersion, showMetadata, resultsViewportWidth);

      return (
        <div key="__COMBINED__" className="mb-6">
          <div className="flex items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Combined Results</h3>
            <div className="ml-auto flex items-center space-x-2">
              <span className="text-xs text-gray-500">Rows colored by source data block</span>
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
            <AnalysisTableScrollArea maxHeightClass="max-h-100">
                <Table className={showDispersion ? 'w-full' : 'min-w-180'} disableContainer>
                <TableHeader className="bg-gray-50 sticky top-0 z-10">
                  <TableRow>
                    {displayColumns.map((c: string) => (
                      <TableHead
                        key={c}
                        className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                        style={c === CONCORDANCE_DISPERSION_COLUMN ? dispersionColumnStyle : undefined}
                      >
                        {c}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell className="h-24 text-center text-muted-foreground" colSpan={displayColumns.length || 1}>
                        No matching rows on this page for &quot;{searchWord}&quot;. Source rows without matches are omitted.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row: Record<string, unknown>, idx:number) => {
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
                          if (showDispersion) {
                            const hits = getDispersionHits(row);
                            const sourceHit = hits[0];
                            const sourceLabel = sourceHit?.__source_node ?? rawSrc;
                            if (sourceLabel) {
                              const nodesForDetail = panelSelectedNodes;
                              const nodeObj = nodesForDetail.find((n: WorkspaceNodeLike) => {
                                const candidates = [n.id, n.name, n.name, (n as Record<string, unknown>).data && typeof (n as Record<string, unknown>).data === 'object' ? ((n as Record<string, unknown>).data as Record<string, unknown>)?.name : undefined, n.label, (n as Record<string, unknown>).data && typeof (n as Record<string, unknown>).data === 'object' ? ((n as Record<string, unknown>).data as Record<string, unknown>)?.label : undefined].filter(Boolean).map(v=>String(v).toLowerCase());
                                return candidates.includes(String(sourceLabel).toLowerCase());
                              });
                              const sel = nodeObj && effectiveNodeColumnSelections.find(s => s.nodeId === nodeObj.id);
                              if (nodeObj && sel?.column) {
                                handleRowClick(row, String(nodeObj.id ?? ''), sel.column, hits);
                              }
                            }
                            return;
                          }
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
                          {displayColumns.map((c: string, i: number) => (
                            <TableCell key={i} style={c === CONCORDANCE_DISPERSION_COLUMN ? dispersionColumnStyle : undefined}>
                              {c === CONCORDANCE_DISPERSION_COLUMN ? (
                                <ConcordanceDispersionCell
                                  hits={getDispersionHits(row)}
                                  textLength={getDispersionTextLength(row, column)}
                                  barWidthPercent={proportionalDispersionBars
                                    ? getDispersionBarWidthPercent(row, column, longestTextLength)
                                    : 100}
                                />
                              ) : row[c] !== undefined && row[c] !== null ? String(row[c]) : ''}
                            </TableCell>
                          ))}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
                </Table>
            </AnalysisTableScrollArea>
            <AnalysisPagination
              page={combinedPage}
              pageSize={combinedPageSize}
              hasNext={combinedHasNext}
              hasPrev={combinedHasPrev}
              totalPages={nodeData.pagination?.total_source_pages}
              onPageChange={(newPage) => setCombinedPage(newPage)}
              pageSizeLabel="Documents per page"
              pageSizeSummary={<GroupedResultsPageSizeSummary groups={nodeData.data} />}
              loading={combinedLoading}
            />
          </div>
        </div>
      );
    }
    // Build per-node display columns using metadata
    const groupedRows = nodeData.data;
    const rows = showDispersion
      ? buildDispersionRows(groupedRows)
      : flattenConcordanceGroups(groupedRows);
    const longestTextLength = showDispersion && proportionalDispersionBars
      ? rows.reduce((max, row) => Math.max(max, getDispersionTextLength(row, column)), 0)
      : 0;
    const allCols = nodeData.columns;
    const metaCols = nodeData.metadata.metadata_columns;
    const visibleMetaCols = (selectedMetadataColumns ?? []).filter((columnName) => metaCols.includes(columnName));
    const rawDisplayColumns = showDispersion
      ? (showMetadata ? [CONCORDANCE_DISPERSION_COLUMN, ...visibleMetaCols.filter(c => allCols.includes(c))] : [CONCORDANCE_DISPERSION_COLUMN])
      : (showMetadata
        ? [...CORE_COLS.filter(c => allCols.includes(c)), ...visibleMetaCols.filter(c => allCols.includes(c))]
        : CORE_COLS.filter(c => allCols.includes(c)));
    const displayColumns = dedupeColumns(rawDisplayColumns);
    const tableColumns = displayColumns.length > 0 ? displayColumns : allCols;
    const sortableColumns = new Set(metaCols);
    const dispersionColumnStyle = getDispersionColumnStyle(showDispersion, showMetadata, resultsViewportWidth);

    const currentNodePagination = nodePagination[paginationKey];
    const currentPage = currentNodePagination?.currentPage ?? 1;
    const nodeIsLoading = Boolean(nodeLoading[paginationKey]);
    const hasPrev = Boolean(nodeData.pagination?.has_prev) || currentPage > 1;
    const hasNext = Boolean(nodeData.pagination?.has_next);

    const detachingKey = detachNodeId ?? "";
    const isDetaching = detachingKey ? Boolean(nodeDetaching[detachingKey]) : false;

    return (
      <div key={nodeKey} className="mb-6">
        <div className="rounded-lg border border-border bg-card">
          <AnalysisTableScrollArea maxHeightClass="max-h-100">
              <Table className={showDispersion ? 'w-full' : 'min-w-180'} disableContainer>
              <TableHeader className="bg-gray-50 sticky top-0 z-10">
                <TableRow>
                  {tableColumns.map(key => {
                    const isSortable = showMetadata && sortableColumns.has(key);
                    return isSortable ? (
                      <SortableHeader key={key} columnKey={key} label={key} paginationKey={paginationKey} requestNodeId={requestNodeId} />
                    ) : (
                      <TableHead
                        key={key}
                        className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                        style={key === CONCORDANCE_DISPERSION_COLUMN ? dispersionColumnStyle : undefined}
                      >
                        {key}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-muted-foreground" colSpan={tableColumns.length || 1}>
                      No matching rows on this page for &quot;{searchWord}&quot;. Source rows without matches are omitted.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row: Record<string, unknown>, index: number) => (
                    <TableRow 
                      key={index} 
                      className={`cursor-pointer ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                      onClick={() => {
                        handleRowClick(
                          row,
                          effectiveNodeId,
                          column,
                          showDispersion ? getDispersionHits(row) : undefined,
                        );
                      }}
                    >
                      {tableColumns.map((colKey: string, cellIndex) => (
                        <TableCell key={cellIndex} style={colKey === CONCORDANCE_DISPERSION_COLUMN ? dispersionColumnStyle : undefined}>
                          {colKey === CONCORDANCE_DISPERSION_COLUMN ? (
                            <ConcordanceDispersionCell
                              hits={getDispersionHits(row)}
                              textLength={getDispersionTextLength(row, column)}
                              barWidthPercent={proportionalDispersionBars
                                ? getDispersionBarWidthPercent(row, column, longestTextLength)
                                : 100}
                            />
                          ) : row[colKey] !== null && row[colKey] !== undefined ? String(row[colKey]) : ''}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
              </Table>
          </AnalysisTableScrollArea>
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
          pageSizeLabel="Documents per page"
          pageSizeSummary={<GroupedResultsPageSizeSummary groups={nodeData.data} />}
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
            title="Create a new data block with concordance results joined to the original table"
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
                  tooltip="Select data blocks, choose the search term, and set context options before running."
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
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={showDispersion}
                        onChange={(e) => {
                          const isChecked = e.target.checked;
                          setShowDispersion(isChecked);
                          if (!isChecked) {
                            setProportionalDispersionBars(false);
                          }
                        }}
                        className="h-4 w-4"
                      />
                      <span>Dispersion View</span>
                    </label>
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
                    />
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
                    </div>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                <div ref={resultsViewportRef} className="space-y-6">
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
