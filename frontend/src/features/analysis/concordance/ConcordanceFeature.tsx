// NodeSelectionPanel now handles color selection UI inline
import React, { useState, useEffect, useRef } from 'react';
import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import { Tabs, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '../../../hooks/useWorkspaceStatus';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceActions } from '../../../hooks/useWorkspaceActions';
import { useAuth } from '../../../hooks/useAuth';
import { ConcordanceAnalysisRequest, ConcordanceAnalysisResponse, ConcordanceResultQuery, textApi } from '../../../api/text';
import { httpRequest } from '../../../api/http';
import { workspacesApi } from '../../../api/workspaces';
import { useAnalysisStore } from '../../../stores/analysisStore';
import { useUIStore } from '../../../stores';
import { useAnalysisLockState } from '../../../hooks/useAnalysisLockState';
import useNodeColumnInfos from '../../../hooks/useNodeColumnInfos';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Play, Loader2, Trash2, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
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
import type { AnalysisTaskStatus } from '../../../hooks/useAnalysisTaskStatus';
import useAnalysisTaskLifecycle, { type AnalysisTaskRefreshContext } from '../../../hooks/useAnalysisTaskLifecycle';
import { getAnalysisActionState } from '../common/analysisActionState';
import { restoreAnalysisLockFromRequest, useAnalysisHydration, useColorStackAllocator } from '../common';
import {
  clearAnalysisTaskArtifacts,
  collectTaskIds,
  pruneTasksById,
  resolveAnalysisTaskId,
} from '../../../hooks/analysisTaskUtils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { AnalysisPagination } from '../../../components/AnalysisPagination';

const sanitizeResultParams = (params?: Record<string, unknown>): Record<string, unknown> | undefined => {
  if (!params) return undefined;
  const cleaned = Object.entries(params).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (value === undefined || value === null) {
      return acc;
    }
    if (key === 'update_only') {
      return acc;
    }
    acc[key] = value;
    return acc;
  }, {});
  return Object.keys(cleaned).length ? cleaned : undefined;
};

const DEFAULT_PALETTE = [
  '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#d97706', '#0d9488',
  '#db2777', '#4f46e5', '#65a30d', '#0891b2', '#92400e', '#6b7280',
];

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
  const pendingConcordance = useAnalysisStore((state) => state.pendingConcordance);
  const clearPendingConcordance = useAnalysisStore((state) => state.clearPendingConcordance);
  const setTasks = useAnalysisStore((state) => state.setTasks);

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
  } = useAnalysisLockState({
    allowedDataTypes: ['string'],
    maxNodes: 2,
    docTypeOnly: true,
    enableHeuristicGuess: false,
  });
  const [searchWord, setSearchWord] = useState('');
  const [numLeftTokens, setNumLeftTokens] = useState(10);
  const [numRightTokens, setNumRightTokens] = useState(10);
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<ConcordanceAnalysisResponse | null>(null);
  const labelToNodeId = (() => {
    const params = (results as any)?.analysis_params;
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
  // Use stack-based allocator for automatic color assignment
  const stackPalette = React.useMemo(() => DEFAULT_PALETTE.slice(0, 6), []);
  const { nodeColors: stackColors } = useColorStackAllocator({
    colors: stackPalette, // Use first six palette colors in stack order
    activeNodeIds: activeNodeIds,
  });
  const [manualColors, setManualColors] = useState<Record<string,string>>({});
  // Merge stack-allocated and manually set colors
  const nodeColors = React.useMemo(() => {
    const merged: Record<string, string> = {};
    // Start with stack-allocated colors
    Object.entries(stackColors).forEach(([id, color]) => {
      merged[id] = color;
    });
    // Override with manual selections
    Object.entries(manualColors).forEach(([id, color]) => {
      if (activeNodeIds.includes(id)) {
        merged[id] = color;
      }
    });
    // Fallback for overflow (>6 nodes)
    activeNodeIds.forEach((id, index) => {
      if (!merged[id]) {
        merged[id] = DEFAULT_PALETTE[index % DEFAULT_PALETTE.length];
      }
    });
    return merged;
  }, [stackColors, manualColors, activeNodeIds]);
  const defaultPalette = DEFAULT_PALETTE;
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
        (node as any)?.node_id,
        node.data?.id,
        node.data?.node_id,
      ].map((val) => (typeof val === 'string' ? val : null)).filter(Boolean) as string[];
      const primaryId = candidateIds[0] ?? `node-${idx}`;
      const assigned = nodeColors[primaryId] || defaultPalette[idx % defaultPalette.length];
      const variants = new Set<string>();
      [
        primaryId,
        node.name,
        (node as any)?.name,
        node.data?.name,
        node.label,
        (node as any)?.label,
        node.data?.label,
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
  const lastTerminalFetchRef = useRef<string | null>(null);

  // Pagination and sorting state - separate for each node
  const [nodePagination, setNodePagination] = useState<Record<string, {
    currentPage: number;
    pageSize: number;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
  }>>({});
  
  // Individual node loading states for pagination/sorting (separate from main search)
  const [nodeLoading, setNodeLoading] = useState<Record<string, boolean>>({});
  
  // Individual node detaching states
  const [nodeDetaching, setNodeDetaching] = useState<Record<string, boolean>>({});
  
  // Global page size setting
  const [globalPageSize, setGlobalPageSize] = useState(20);
  
  // Detail view state
  const [selectedDetail, setSelectedDetail] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  
  // State for auto-triggering search from TokenFrequencyTab
  const [shouldAutoSearch, setShouldAutoSearch] = useState(false);
  const [localConcordanceTaskId, setLocalConcordanceTaskId] = useState<string | null>(null);
  const concordanceTaskStatusRef = useRef<AnalysisTaskStatus | null>(null);

  const resolveConcordanceTaskId = async (): Promise<string | null> => {
    if (!currentWorkspaceId) {
      return null;
    }

    const status = concordanceTaskStatusRef.current;
    return resolveAnalysisTaskId({
      candidateIds: [
        localConcordanceTaskId,
        (results as any)?.metadata?.task_id,
        status?.activeTaskId,
        status?.runningTask?.task_id,
        status?.queuedTask?.task_id,
        status?.terminalTask?.task_id,
      ],
      fetchCurrentTaskId: async () => {
        const headers = getAuthHeaders();
        const current = (await textApi.getAnalysisCurrent(
          'concordance',
          headers
        )) as any;
        const taskId = Array.isArray(current?.task_ids) ? current.task_ids[0] : null;
        return typeof taskId === 'string' && taskId.trim().length > 0 ? taskId : null;
      },
      onResolved: setLocalConcordanceTaskId,
    });
  };

  const effectiveNodeColumnSelections = isLocked ? activeNodeColumnSelections : nodeColumnSelections;

  const refreshCurrentConcordanceResult = async (queryOverrides?: Record<string, unknown>) => {
    if (!currentWorkspaceId) {
      return null;
    }

    try {
      const headers = getAuthHeaders();
      const taskId = await resolveConcordanceTaskId();
      if (!taskId) {
        return null;
      }
      const response = await httpRequest<ConcordanceAnalysisResponse>(
        `/workspaces/concordance/tasks/${taskId}/result`,
        { method: 'GET', headers, params: sanitizeResultParams(queryOverrides) }
      );
      const typedResponse = response as ConcordanceAnalysisResponse | null;
      if (typedResponse) {
        setResults(typedResponse);
      }
      return typedResponse;
    } catch (error) {
      console.error('Failed to refresh concordance results automatically', error);
      return null;
    }
  };

  const updateStoredResult = async (
    body: ConcordanceResultQuery
  ): Promise<ConcordanceAnalysisResponse | null> => {
    if (!currentWorkspaceId) {
      return null;
    }

    const headers = getAuthHeaders();
    const taskId = await resolveConcordanceTaskId();
    if (!taskId) {
      return null;
    }
    const response = await textApi.postConcordanceTaskResult(taskId, body, headers) as ConcordanceAnalysisResponse;
    if (response) {
      setResults(response);
    }
    return response;
  };

  const concordanceFallbackBanner = (status: AnalysisTaskStatus) => {
    if (results?.state !== 'running') {
      return null;
    }
    return {
      taskId:
        (results as any)?.metadata?.task_id ??
        localConcordanceTaskId ??
        status.activeTaskId ??
        null,
      message: status.bannerMessage?.trim() || undefined,
    };
  };

  const handleTaskRefresh = async (context: AnalysisTaskRefreshContext) => {
    if (context.reason !== 'terminal') {
      return;
    }

    if (context.taskId && lastTerminalFetchRef.current === context.taskId && results) {
      return;
    }

    const refreshed = await refreshCurrentConcordanceResult();
    if (!refreshed && context.reason === 'terminal' && context.taskState === 'failed') {
      setResults({
        state: 'failed',
        message: context.task?.message || 'Concordance analysis failed',
        data: {},
      } as ConcordanceAnalysisResponse);
    }

    if (context.reason === 'terminal' && context.taskId) {
      setLocalConcordanceTaskId((prev) => (prev === context.taskId ? null : prev));
      lastTerminalFetchRef.current = context.taskId;
    }
  };

  const {
    status: concordanceTaskStatus,
    banner: concordanceWaitingBanner,
  } = useAnalysisTaskLifecycle({
    taskType: 'concordance',
    isTabActive: isActiveTab,
    workspaceId: currentWorkspaceId,
    manualActiveTaskId: localConcordanceTaskId,
    fallbackRunningBanner: concordanceFallbackBanner,
    onRefresh: handleTaskRefresh,
  });

  useEffect(() => {
    concordanceTaskStatusRef.current = concordanceTaskStatus;
  }, [concordanceTaskStatus]);

  const hasActiveTask = Boolean(
    localConcordanceTaskId ||
    concordanceTaskStatus.activeTaskId ||
    concordanceTaskStatus.runningTask?.task_id ||
    concordanceTaskStatus.queuedTask?.task_id ||
    concordanceTaskStatus.terminalTask?.task_id ||
    concordanceTaskStatus.tasks.length > 0
  );
  const actionState = getAnalysisActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    hasSelection: panelSelectedNodes.length > 0,
    isLocked,
    hasResults: Boolean(results),
    isBusy: isSearching,
    hasActiveTask,
  });

  useEffect(() => {
    if (viewMode === 'combined' && results && results.combinable === false) {
      setViewMode('separated');
    }
  }, [viewMode, results]);

  useEffect(() => {
    if (!results) {
      return;
    }

    const analysisParams = (results as any)?.analysis_params ?? {};
    const preferenceSource = (results as any)?.preferences ?? analysisParams?.preferences ?? {};

    const nextPageSize = preferenceSource?.page_size ?? analysisParams?.page_size;
    if (typeof nextPageSize === 'number' && Number.isFinite(nextPageSize) && nextPageSize > 0 && nextPageSize !== globalPageSize) {
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
    }

    const nextShowMetadata = preferenceSource?.show_metadata ?? analysisParams?.show_metadata;
    if (typeof nextShowMetadata === 'boolean' && nextShowMetadata !== showMetadata) {
      setShowMetadata(nextShowMetadata);
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
  }, [selectedNodeIdsKey, isLocked]);

  useEffect(() => {
    if (!currentWorkspaceId) {
      setLocalConcordanceTaskId(null);
      lastTerminalFetchRef.current = null;
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    if (concordanceTaskStatus.tasks.length === 0) {
      setLocalConcordanceTaskId(null);
    }
  }, [concordanceTaskStatus.tasks.length]);

  // React to pending concordance handoff from TokenFrequencyTab
  useEffect(() => {
    if (!pendingConcordance) return;
    if (lastPendingConcordanceRef.current === pendingConcordance.timestamp) {
      return;
    }
    lastPendingConcordanceRef.current = pendingConcordance.timestamp ?? null;

    if (pendingConcordance.searchWord) {
      setSearchWord(pendingConcordance.searchWord);
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
      setManualColors((prev) => ({ ...pendingConcordance.nodeColors, ...prev }));
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
    };
  }, [pendingConcordance, selectedNodes, setNodeColumnSelections, clearPendingConcordance, selectNodes]);

  // Recompute auto columns if unlocked and selections empty but nodes exist
  useEffect(() => {
    if (!isLocked && selectedNodes.length > 0 && nodeColumnSelections.length === 0) {
      recomputeAutoColumns();
    }
  }, [isLocked, selectedNodes, nodeColumnSelections, recomputeAutoColumns]);


  // Color assignment now handled by stack allocator - no auto-fill effect needed


  const handleColorChange = (nodeId: string, color: string) => setManualColors(prev => ({ ...prev, [nodeId]: color }));

  const handleColumnChange = (nodeId: string, column: string) => setNodeColumnSelection(nodeId, column);

  const handleSearch = async (
    resetPage = true,
    targetNodeId?: string,
    forceMode?: 'separated' | 'combined',
    overrideSortBy?: string,
    overrideSortOrder?: 'asc' | 'desc',
    allowWhenLocked: boolean = false
  ) => {
    if (!currentWorkspaceId) return;
    if (isLocked && !allowWhenLocked) return;

    const trimmedSearch = searchWord.trim();
    if (!trimmedSearch) {
      toast.error('Please enter a search word.');
      return;
    }

    const requestNodeIds = (() => {
      const baseIds = activeNodeIds.slice(0, 2);
      if (targetNodeId && !baseIds.includes(targetNodeId)) {
        return [...baseIds, targetNodeId];
      }
      return baseIds;
    })();

    if (requestNodeIds.length === 0) {
      return;
    }

    const effectiveSelections = effectiveNodeColumnSelections.filter((sel) =>
      requestNodeIds.includes(sel.nodeId)
    );

    const incompleteSelections = effectiveSelections.filter((sel) => !sel.column);
    if (incompleteSelections.length > 0) {
      toast.error('Please select a text column for all selected data blocks.');
      return;
    }

    const updatedPagination = { ...nodePagination };
    requestNodeIds.forEach((nodeId) => {
      if (!updatedPagination[nodeId]) {
        updatedPagination[nodeId] = {
          currentPage: 1,
          pageSize: globalPageSize,
          sortBy: '',
          sortOrder: 'asc' as 'asc' | 'desc',
        };
      }
      if (resetPage && (!targetNodeId || targetNodeId === nodeId)) {
        updatedPagination[nodeId].currentPage = 1;
      }
    });
    setNodePagination(updatedPagination);

    const shouldForceSeparated = resetPage && !allowWhenLocked && !forceMode;
    const effectiveMode = shouldForceSeparated ? 'separated' : (forceMode || viewMode);
    if (shouldForceSeparated && viewMode !== 'separated') {
      setViewMode('separated');
    }
    if (shouldForceSeparated && combinedPage !== 1) {
      setCombinedPage(1);
    }

    const firstNodeId = requestNodeIds[0];
    const firstNodePagination = updatedPagination[firstNodeId];
    if (!firstNodePagination) {
      return;
    }

    const nodeColumns: Record<string, string> = {};
    effectiveSelections.forEach((sel) => {
      nodeColumns[sel.nodeId] = sel.column;
    });

    setIsSearching(true);
    try {
      const authHeaders = getAuthHeaders();
      const isCombinedQuery = effectiveMode === 'combined';
      const useStoredResult = forceMode !== undefined || (isLocked && allowWhenLocked);
      let response: ConcordanceAnalysisResponse | null = null;

      if (useStoredResult) {
        const overrides: ConcordanceResultQuery = {
          combined: isCombinedQuery,
          sort_by: (overrideSortBy ?? firstNodePagination.sortBy) || undefined,
          sort_order: overrideSortOrder ?? firstNodePagination.sortOrder,
        };

        if (isCombinedQuery) {
          overrides.page = combinedPage;
          overrides.page_size = combinedPageSize;
        } else {
          overrides.page = firstNodePagination.currentPage;
          overrides.page_size = firstNodePagination.pageSize;
        }

        response = await updateStoredResult(overrides as ConcordanceResultQuery);

        if (isCombinedQuery && response && response.combinable === false) {
          setViewMode('separated');
        }
      } else {
        const request: ConcordanceAnalysisRequest = {
          node_ids: requestNodeIds,
          node_columns: nodeColumns,
          search_word: trimmedSearch,
          num_left_tokens: numLeftTokens,
          num_right_tokens: numRightTokens,
          regex,
          case_sensitive: caseSensitive,
        };
        if (isCombinedQuery) {
          request.combined = true;
        }
        const requestedSortBy = overrideSortBy ?? firstNodePagination.sortBy;
        if (requestedSortBy) {
          request.sort_by = requestedSortBy;
        }

        response = await textApi.concordance(request, authHeaders);
        setResults(response);
        const responseTaskId = (response as any)?.metadata?.task_id;
        if (typeof responseTaskId === 'string' && responseTaskId.trim().length > 0) {
          setLocalConcordanceTaskId(responseTaskId);
        }

        try {
          await restoreAnalysisLockFromRequest({
            workspaceId: currentWorkspaceId,
            requestData: { node_ids: requestNodeIds, node_columns: nodeColumns },
            getAuthHeaders,
            lockWithSnapshots,
            maxNodes: 2,
          });
        } catch {
          /* ignore */
        }

        if (response?.combinable === false && viewMode === 'combined') {
          setViewMode('separated');
        }
      }
    } catch (error) {
      console.error('Error performing concordance search:', error);
      setResults({
        state: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        data: {},
      } as any);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (!shouldAutoSearch) {
      return;
    }
    setShouldAutoSearch(false);
    void handleSearch(true);
  }, [shouldAutoSearch, handleSearch]);

  const applyHydratedRequest = async (requestPayload: unknown) => {
    const req = (requestPayload as any)?.data ?? requestPayload;
    if (!req) {
      return;
    }

    const nodeIds: string[] = Array.isArray(req.node_ids) ? req.node_ids.slice(0,2) : [];
    const node_columns: Record<string,string> = req.node_columns || {};
    const sels = nodeIds.map((id: string) => ({ nodeId: id, column: node_columns[id] || '' }));
    setNodeColumnSelections(sels, { replace: true });
    setSearchWord(String(req.search_word || ''));
    setNumLeftTokens(Number(req.num_left_tokens ?? 10));
    setNumRightTokens(Number(req.num_right_tokens ?? 10));
    setRegex(!!req.regex);
    setCaseSensitive(!!req.case_sensitive);
    const hydratedMode: 'separated' | 'combined' = req.combined && req.combinable !== false ? 'combined' : 'separated';
    setViewMode(hydratedMode);

    try {
      await restoreAnalysisLockFromRequest({
        workspaceId: currentWorkspaceId,
        requestData: req,
        getAuthHeaders,
        lockWithSnapshots,
        maxNodes: 2,
      });
    } catch {
      /* ignore */
    }
  };

  const applyHydratedResult = async (resultPayload: unknown) => {
    const res = (resultPayload as any)?.data ?? resultPayload;
    if (res) {
      setResults(resultPayload as any);
    }
  };

  const fetchConcordanceRequest = async (taskId?: string | null) => {
    if (!currentWorkspaceId || !taskId) return null;
    return textApi.getTaskRequest(taskId, getAuthHeaders());
  };

  const fetchConcordanceResult = async (taskId?: string | null) => {
    if (!currentWorkspaceId || !taskId) return null;
    return textApi.getConcordanceTaskResult(taskId, getAuthHeaders());
  };

  const { hydrateFromServer } = useAnalysisHydration({
    workspaceId: currentWorkspaceId,
    analysisKey: 'concordance',
    getAuthHeaders,
    onTaskIdResolved: setLocalConcordanceTaskId,
    fetchRequest: fetchConcordanceRequest,
    fetchResult: fetchConcordanceResult,
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
    if (!currentWorkspaceId || !isActiveTab) {
      return;
    }
    if (hydratedOnceRef.current) {
      return;
    }
    hydratedOnceRef.current = true;
    void hydrateFromServer();
  }, [currentWorkspaceId, hydrateFromServer, isActiveTab]);

  const handleClearResults = async () => {
    const taskIds = collectTaskIds([
      (results as any)?.metadata?.task_id,
      localConcordanceTaskId,
      concordanceTaskStatus.activeTaskId,
      concordanceTaskStatus.runningTask?.task_id,
      concordanceTaskStatus.queuedTask?.task_id,
      concordanceTaskStatus.terminalTask?.task_id,
    ]);

    if (currentWorkspaceId) {
      const headers = getAuthHeaders();

      await clearAnalysisTaskArtifacts({
        workspaceId: currentWorkspaceId,
        taskIds,
        cancelTask: (workspaceId, taskId) =>
          workspacesApi.cancelTasks({ task_id: taskId }, headers),
        clearManagerTask: (workspaceId, taskId) =>
          workspacesApi.clearTasks({ task_id: taskId }, headers),
        clearAnalysisTask: (workspaceId, taskId) =>
          textApi.clearTask(taskId, headers),
        warnContext: 'concordance',
      });
    }

    setTasks((prev) => {
      if (!Array.isArray(prev)) return prev;
      if (taskIds.length === 0) {
        return prev;
      }
      return pruneTasksById(prev, taskIds);
    });
    setResults(null);
    setNodePagination({});
    setCombinedPage(1);
    unlockSelection();
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
      (results as any)?.metadata?.task_id ??
      (results as any)?.metadata?.taskId ??
      '';
    const key = `${taskId}|${combinedPage}|${combinedPageSize}`;
    if (lastCombinedQueryRef.current === key) {
      return;
    }
    lastCombinedQueryRef.current = key;
    void updateStoredResult({ combined: true, page: combinedPage, page_size: combinedPageSize });
  }, [viewMode, results, combinedPage, combinedPageSize, updateStoredResult]);


  const handleSort = (columnName: string, nodeKey: string, requestNodeId?: string) => {
    const currentNodePagination = nodePagination[nodeKey] || {
      currentPage: 1,
      pageSize: globalPageSize,
      sortBy: '',
      sortOrder: 'asc' as 'asc' | 'desc'
    };

    const isSameColumn = currentNodePagination.sortBy === columnName;
    const newSortOrder = isSameColumn ? (currentNodePagination.sortOrder === 'asc' ? 'desc' : 'asc') : 'asc';

    setNodePagination(prev => ({
      ...prev,
      [nodeKey]: {
        ...currentNodePagination,
        currentPage: 1, // reset to first page on new sort
        sortBy: columnName,
        sortOrder: newSortOrder
      }
    }));

    // Trigger backend resort using current-result POST
    const pageSize = currentNodePagination.pageSize;
    if (!currentWorkspaceId) {
      return;
    }
    const targetNodeId = requestNodeId ?? nodeKey;
    void (async () => {
      setNodeLoading(prev => ({ ...prev, [nodeKey]: true }));
      try {
        const overrides: ConcordanceResultQuery = {
          node_id: targetNodeId,
          sort_by: columnName,
          sort_order: newSortOrder,
          page: 1,
          page_size: pageSize,
        };
        await updateStoredResult(overrides);
      } finally {
        setNodeLoading(prev => ({ ...prev, [nodeKey]: false }));
      }
    })();
  };

  const handlePageChange = (newPage: number, nodeKey: string, requestNodeId?: string) => {
    const currentNodePagination = nodePagination[nodeKey] || {
      currentPage: 1,
      pageSize: globalPageSize,
      sortBy: '',
      sortOrder: 'asc' as 'asc' | 'desc'
    };

    setNodePagination(prev => ({
      ...prev,
      [nodeKey]: {
        ...currentNodePagination,
        currentPage: newPage
      }
    }));

    // Trigger backend page update using current-result POST
    if (!currentWorkspaceId) {
      return;
    }
    const targetNodeId = requestNodeId ?? nodeKey;
    void (async () => {
      setNodeLoading(prev => ({ ...prev, [nodeKey]: true }));
      try {
        const overrides: ConcordanceResultQuery = {
          node_id: targetNodeId,
          page: newPage,
          page_size: currentNodePagination.pageSize,
          sort_by: currentNodePagination.sortBy || undefined,
          sort_order: currentNodePagination.sortOrder,
        };
        await updateStoredResult(overrides);
      } finally {
        setNodeLoading(prev => ({ ...prev, [nodeKey]: false }));
      }
    })();
  };

  const persistResultPreferences = async (partial: { pageSize?: number; showMetadata?: boolean }) => {
    if (!currentWorkspaceId) {
      return;
    }

    const preferenceUpdates: Record<string, unknown> = {};
    if (partial.pageSize !== undefined) {
      preferenceUpdates.page_size = partial.pageSize;
    }
    if (partial.showMetadata !== undefined) {
      preferenceUpdates.show_metadata = partial.showMetadata;
    }

    if (Object.keys(preferenceUpdates).length === 0) {
      return;
    }

    try {
      const fetchParams: Record<string, unknown> = { combined: viewMode === 'combined' };
      if (viewMode === 'combined') {
        fetchParams.page = combinedPage;
        fetchParams.page_size = partial.pageSize ?? combinedPageSize;
      } else {
        fetchParams.page = 1;
        fetchParams.page_size = partial.pageSize ?? globalPageSize;
      }

      const mergedBody = {
        ...preferenceUpdates,
        ...fetchParams,
        update_only: false
      } as ConcordanceResultQuery;

      return await updateStoredResult(mergedBody);
    } catch (error) {
      console.error('Failed to persist concordance preferences', error);
      throw error;
    }
  };

  const handleRowClick = (row: any, nodeId: string, column: string) => {
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

  const handleDetach = async (nodeId: string, column: string) => {
    if (!currentWorkspaceId || !searchWord.trim()) {
      return;
    }

    setNodeDetaching(prev => ({ ...prev, [nodeId]: true }));
    
    try {
      const request = {
        node_id: nodeId,
        column: column,
        search_word: searchWord.trim(),
        num_left_tokens: numLeftTokens,
        num_right_tokens: numRightTokens,
        regex: regex,
        case_sensitive: caseSensitive,
        new_node_name: undefined // Let backend generate the name
      };

      await detachConcordance(nodeId, request);
      
      // The workspace will automatically refresh and show the new node
      // No need for additional notifications
      
    } catch (error) {
      console.error('Error detaching concordance:', error);
      // Only show error messages, not success messages
      toast.error(`Error detaching concordance: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setNodeDetaching(prev => ({ ...prev, [nodeId]: false }));
    }
  };

  const SortableHeader: React.FC<{ columnKey: string; label: string; paginationKey: string; requestNodeId: string }> = ({ columnKey, label, paginationKey, requestNodeId }) => {
    const nodeState = nodePagination[paginationKey] || { sortBy: '', sortOrder: 'asc' as 'asc' | 'desc' };
    const isSorted = nodeState.sortBy === columnKey;
    const sortIcon = isSorted ? (nodeState.sortOrder === 'asc' ? '▲' : '▼') : '▲▼';
    
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
    nodeData: any,
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
                onClick={async () => {
                  // Use locked snapshot when locked so actions are stable
                  const nodeIdsForDetach = selectedNodes.slice(0,2).map(n => n.id);
                  if (nodeIdsForDetach.length === 0 || !searchWord.trim()) return;
                  setCombinedLoading(true);
                  try {
                    for (const nid of nodeIdsForDetach.slice(0,2)) {
                      // Prefer lockedNodeColumns when available to ensure correct column
                      const col = effectiveNodeColumnSelections.find(s => s.nodeId === nid)?.column || '';
                      if (!col) continue;
                      await handleDetach(nid, col);
                    }
                  } finally { setCombinedLoading(false); }
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
                  {rows.map((row:any, idx:number) => {
                    const rawSrc = row.__source_node;
                    const normalized = rawSrc ? rawSrc.toString().toLowerCase() : undefined;
                    let color = normalized ? sourceColorMap[normalized] : undefined;
                    if (!color && rawSrc) {
                      // Fallback: attempt partial / loose match (startsWith) if exact failed
                      const entry = Object.entries(sourceColorMap).find(([k]) => k.includes(normalized!));
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
                    const nodeObj = nodesForDetail.find((n: any) => {
                            const candidates = [n.id, n.name, (n as any).name, n.data?.name, (n as any).label, n.data?.label].filter(Boolean).map(v=>v.toString().toLowerCase());
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

    if (!nodeData.data || nodeData.data.length === 0) {
      return (
        <div key={nodeKey} className="mb-6">
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-center text-gray-500">
              No results found for “{searchWord}”
            </div>
          </div>
        </div>
      );
    }

    const currentNodePagination = nodePagination[paginationKey];
    const currentPage = currentNodePagination?.currentPage ?? 1;
    const nodeIsLoading = Boolean(nodeLoading[paginationKey]);
    const hasPrev = Boolean(nodeData.pagination?.has_prev);
    const hasNext = Boolean(nodeData.pagination?.has_next);
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
                {nodeData.data.map((row: any, index: number) => (
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
                handleDetach(detachNodeId, column);
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
                  disabled={!!isLocked}
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
                    disabled={!!isLocked}
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
                    disabled={!!isLocked}
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
                    disabled={!!isLocked}
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
                  disabled={!!isLocked}
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
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Searching...</>
            ) : (
              <><Play className="mr-2 h-4 w-4" />Search</>
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
                      let node = nodesForDetail.find((n: any) => (n.data?.name || n.id) === nodeName);
                      if (!node) {
                        node = nodesForDetail.find((n: any) => n.id === nodeName);
                      }
                      if (!node) {
                        node = nodesForDetail.find((n: any) => n.name === nodeName);
                      }
                      const mappedNodeId = labelToNodeId?.[nodeName];
                      if (!node && mappedNodeId) {
                        node = nodesForDetail.find((n: any) => n.id === mappedNodeId);
                      }
                      if (!node) {
                        node = (nodesForDetail as any)[approxIndex];
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
                  <span className="ml-2">{selectedDetail.l1}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">R1 Word:</span>
                  <span className="ml-2">{selectedDetail.r1}</span>
                </div>
              </div>

              {/* Full Text */}
              <div className="mb-6">
                <h4 className="font-medium text-gray-700 mb-2">Full Text from Column: {selectedDetail.column}</h4>
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
                      {selectedDetail.record && Object.entries(selectedDetail.record).map(([key, value]) => {
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
                      })}
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
    </div>
  );
};

export default ConcordanceFeature;
