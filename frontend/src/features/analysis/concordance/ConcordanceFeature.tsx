// NodeSelectionPanel now handles color selection UI inline
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { getNodeInfo } from '../../../lib/nodeInfoCache';
import { useAnalysisStore } from '../../../stores/analysisStore';
import { useAnalysisLockState } from '../../../hooks/useAnalysisLockState';
import useNodeColumnInfos from '../../../hooks/useNodeColumnInfos';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Play, Loader2, Trash2, Link as LinkIcon, X, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { applySelectedColumnsToSnapshots } from '../../../hooks/useSchemaManagement';
import AnalysisLockedNotice from '../../../components/tabs/AnalysisLockedNotice';
import AnalysisTaskBanner from '../../../components/tabs/AnalysisTaskBanner';
import type { AnalysisTaskStatus } from '../../../hooks/useAnalysisTaskStatus';
import useAnalysisTaskLifecycle, { type AnalysisTaskRefreshContext } from '../../../hooks/useAnalysisTaskLifecycle';

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

const ConcordanceFeature: React.FC = () => {
  // Anchor ref for results container to stabilize scroll on view mode toggle
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const { selectedNodes } = useWorkspaceSelection();
  const { isLoading } = useWorkspaceStatus();
  const { currentWorkspaceId } = useWorkspaceData();
  const { detachConcordance, selectNodes } = useWorkspaceActions();

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
  const labelToNodeId = useMemo(() => {
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
  }, [results]);

  // Color management & view mode
  const [nodeColors, setNodeColors] = useState<Record<string,string>>({});
  const defaultPalette = useMemo(() => [
    '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#d97706', '#0d9488', '#db2777', '#4f46e5', '#65a30d', '#0891b2', '#92400e', '#6b7280'
  ], []);
  // legacy inline picker state removed in favor of shared component
  const [viewMode, setViewMode] = useState<'separated'|'combined'>('separated');
  const [combinedPage, setCombinedPage] = useState(1);
  const [combinedPageSize] = useState(20);
  const [combinedLoading, setCombinedLoading] = useState(false);

  // Map any node's id/name variants to its assigned color (used in combined table)
  const sourceColorMap = useMemo(() => {
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
  }, [panelSelectedNodes, nodeColors, defaultPalette]);
  
  const lastPendingConcordanceRef = useRef<number | null>(null);

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

  const effectiveNodeColumnSelections = useMemo(() => (
    isLocked ? activeNodeColumnSelections : nodeColumnSelections
  ), [isLocked, activeNodeColumnSelections, nodeColumnSelections]);

  const refreshCurrentConcordanceResult = useCallback(async (queryOverrides?: Record<string, unknown>) => {
    if (!currentWorkspaceId) {
      return null;
    }

    try {
      const headers = getAuthHeaders();
      const response = await httpRequest<ConcordanceAnalysisResponse>(
        `/workspaces/${currentWorkspaceId}/concordance/current-result`,
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
  }, [currentWorkspaceId, getAuthHeaders, setResults]);

  const updateStoredResult = useCallback(async (
    body: ConcordanceResultQuery
  ): Promise<ConcordanceAnalysisResponse | null> => {
    if (!currentWorkspaceId) {
      return null;
    }

    const headers = getAuthHeaders();
    const response = await textApi.postConcordanceCurrentResult(currentWorkspaceId, body, headers) as ConcordanceAnalysisResponse;
    if (response) {
      setResults(response);
    }
    return response;
  }, [currentWorkspaceId, getAuthHeaders, setResults]);

  const concordanceFallbackBanner = useCallback(
    (status: AnalysisTaskStatus) => {
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
    },
    [results, localConcordanceTaskId]
  );

  const handleTaskRefresh = useCallback(
    async (context: AnalysisTaskRefreshContext) => {
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
      }
    },
    [refreshCurrentConcordanceResult, setResults, setLocalConcordanceTaskId]
  );

  const {
    status: concordanceTaskStatus,
    banner: concordanceWaitingBanner,
  } = useAnalysisTaskLifecycle({
    taskType: 'concordance',
    workspaceId: currentWorkspaceId,
    manualActiveTaskId: localConcordanceTaskId,
    fallbackRunningBanner: concordanceFallbackBanner,
    pollWhileActive: true,
    onRefresh: handleTaskRefresh,
  });

  // Debug results changes
  useEffect(() => {
    if (!results || localStorage.getItem('debugConc') !== '1') {
      return;
    }

    console.debug('Concordance results updated:', results);
    console.debug('Results state:', results.state);
    console.debug('Results data:', results.data);

    if (results.data) {
      console.debug('Data entries:', Object.entries(results.data));
    }
  }, [results]);

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
  const selectedNodeIds = useMemo(() => selectedNodes.map(node => node.id).sort(), [selectedNodes]);
  const prevSelectedNodeIdsRef = React.useRef<string[] | null>(null);
  useEffect(() => {
    const prev = prevSelectedNodeIdsRef.current;
    const curr = selectedNodeIds;
    const changed = !prev || prev.length !== curr.length || prev.some((id, i) => id !== curr[i]);
    if (changed && !isLocked) {
      setResults(null);
    }
    prevSelectedNodeIdsRef.current = curr;
  }, [selectedNodeIds, isLocked]);

  useEffect(() => {
    if (!currentWorkspaceId) {
      setLocalConcordanceTaskId(null);
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
    lastPendingConcordanceRef.current = pendingConcordance.timestamp;

    if (localStorage.getItem('debugConc') === '1') {
      console.debug('Processing pending concordance search:', pendingConcordance);
    }

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
            if (localStorage.getItem('debugConc') === '1') {
              console.warn('Failed to sync workspace selection from pending concordance:', error);
            }
          }
        }
      }
    }

    if (pendingConcordance.nodeColumnSelections?.length) {
      setNodeColumnSelections(
        pendingConcordance.nodeColumnSelections.map((sel) => ({ ...sel })),
        { replace: true }
      );
    }

    if (pendingConcordance.nodeColors) {
      setNodeColors((prev) => ({ ...pendingConcordance.nodeColors, ...prev }));
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
        if (localStorage.getItem('debugConc') === '1') {
          console.debug(
            `Auto-triggering concordance search for: ${pendingConcordance.searchWord} (delay=${delay}ms, autoRun=${pendingConcordance.autoRun})`
          );
        }
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


  // Ensure every selected node has a color
  useEffect(() => {
    if (!activeNodeIds.length) return;
    setNodeColors(prev => {
      const updated = { ...prev };
      let paletteIndex = 0;
      activeNodeIds.slice(0, 2).forEach((nodeId) => {
        if (!updated[nodeId]) {
          while (Object.values(updated).includes(defaultPalette[paletteIndex % defaultPalette.length]) && paletteIndex < defaultPalette.length * 2) {
            paletteIndex++;
          }
          updated[nodeId] = defaultPalette[paletteIndex % defaultPalette.length];
          paletteIndex++;
        }
      });
      return updated;
    });
  }, [activeNodeIds, defaultPalette]);


  const handleColorChange = (nodeId: string, color: string) => setNodeColors(prev => ({ ...prev, [nodeId]: color }));

  const handleColumnChange = (nodeId: string, column: string) => setNodeColumnSelection(nodeId, column);

  const handleSearch = useCallback(async (
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
      alert('Please enter a search word.');
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
      alert('Please select a text column for all selected nodes.');
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

        response = await textApi.concordance(currentWorkspaceId, request, authHeaders);
        if (localStorage.getItem('debugConc') === '1') {
          console.debug('Multi-Node Concordance Response:', response);
        }
        setResults(response);
        const responseTaskId = (response as any)?.metadata?.task_id;
        if (typeof responseTaskId === 'string' && responseTaskId.trim().length > 0) {
          setLocalConcordanceTaskId(responseTaskId);
        }

        try {
          const snaps: Array<{ id: string; name: string; columns: string[] }> = [];
          for (const id of requestNodeIds) {
            try {
              const info = await getNodeInfo({ workspaceId: currentWorkspaceId!, nodeId: id, headers: authHeaders });
              const name = info?.name || info?.data?.name || id;
              const columns = Array.isArray(info?.columns)
                ? info.columns
                : (Array.isArray(info?.data?.columns) ? info.data.columns : []);
              snaps.push({ id, name: String(name), columns });
            } catch {
              snaps.push({ id, name: id, columns: [] });
            }
          }
          const normalizedSnapshots = applySelectedColumnsToSnapshots(snaps, nodeColumns);
          lockWithSnapshots(normalizedSnapshots);
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
  }, [
    currentWorkspaceId,
    isLocked,
    searchWord,
    activeNodeIds,
  effectiveNodeColumnSelections,
    nodePagination,
    globalPageSize,
    numLeftTokens,
    numRightTokens,
    regex,
    caseSensitive,
    getAuthHeaders,
    viewMode,
    combinedPage,
    combinedPageSize,
    lockWithSnapshots,
    updateStoredResult,
    setNodePagination,
    setViewMode,
    setCombinedPage,
    setIsSearching,
    setResults,
  ]);

  useEffect(() => {
    if (!shouldAutoSearch) {
      return;
    }
    setShouldAutoSearch(false);
    void handleSearch(true);
  }, [shouldAutoSearch, handleSearch]);

  // Hydrate from backend current-request/result once per mount
  const hydratedOnceRef = useRef<boolean>(false);
  useEffect(() => {
    (async () => {
      if (hydratedOnceRef.current) return;
      hydratedOnceRef.current = true;
      if (!currentWorkspaceId) return;
      try {
        // First check current-request; if null, don't request current-result
  const reqResp = await textApi.getConcordanceCurrentRequest(currentWorkspaceId, getAuthHeaders());
        if (!reqResp) {
          // No current request - fresh state
          return;
        }
        
        const req = (reqResp as any)?.data;
        if (req) {
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
          
          // Build snapshot and lock
          try {
            const snaps: Array<{ id: string; name: string; columns: string[] }> = [];
            for (const id of nodeIds) {
              try {
                const info = await getNodeInfo({ workspaceId: currentWorkspaceId!, nodeId: id, getAuthHeaders });
                const name = info?.name || info?.data?.name || id;
                const columns = Array.isArray(info?.columns)
                  ? info.columns
                  : (Array.isArray(info?.data?.columns) ? info.data.columns : []);
                snaps.push({ id, name: String(name), columns });
              } catch {
                snaps.push({ id, name: id, columns: [] });
              }
            }
            const normalizedSnapshots = applySelectedColumnsToSnapshots(
              snaps,
              node_columns
            );
            lockWithSnapshots(normalizedSnapshots);
          } catch { /* ignore */ }
        }
        
  // If no request data, don't attempt to fetch current-result
  if (!req) return;
  // Now get current-result
  const resResp = await textApi.getConcordanceCurrentResult(currentWorkspaceId, getAuthHeaders());
        if (!resResp) {
          // No result yet
          return;
        }
        
        const res = (resResp as any)?.data;
        if (res) {
          setResults(resResp as any);
        }
      } catch { /* ignore */ }
    })();
  }, [currentWorkspaceId, getAuthHeaders, setNodeColumnSelections, lockWithSnapshots, setViewMode]);

  const handleClearResults = async () => {
    if (currentWorkspaceId) {
      const headers = getAuthHeaders();
      try {
        await workspacesApi.cancelTasks(
          currentWorkspaceId,
          { task_type: 'concordance' },
          headers,
        );
      } catch (error) {
        console.warn('Failed to cancel concordance tasks before clearing', error);
      }
      try {
        await workspacesApi.clearTasks(
          currentWorkspaceId,
          { task_type: 'concordance' },
          headers,
        );
      } catch (error) {
        console.warn('Failed to clear concordance tasks from task manager', error);
      }
      try {
        await textApi.clearConcordance(currentWorkspaceId, headers);
      } catch (error) {
        console.error('Failed to clear backend analyses/cache:', error);
      }
    }
    setTasks((prev) =>
      Array.isArray(prev) ? prev.filter((task) => task?.task_type !== 'concordance') : prev
    );
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
  useEffect(() => {
    if (viewMode === 'combined' && results) {
      void updateStoredResult({ combined: true, page: combinedPage, page_size: combinedPageSize });
    }
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

  const persistResultPreferences = useCallback(async (partial: { pageSize?: number; showMetadata?: boolean }) => {
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
  }, [combinedPage, combinedPageSize, currentWorkspaceId, globalPageSize, updateStoredResult, viewMode]);

  const handleRowClick = (row: any, nodeId: string, column: string) => {
    if (!currentWorkspaceId || row.document_idx === undefined) return;

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

  const highlightMatchInText = useCallback(
    (
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
    },
    []
  );

  const detailFullTextInfo = useMemo(() => {
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
  }, [selectedDetail, highlightMatchInText, searchWord, caseSensitive]);

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
      alert(`Error detaching concordance: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

  const coreCols = useMemo(() => (
    [
      'document_idx','left_context','matched_text','right_context','start_idx','end_idx','l1','r1','l1_freq','r1_freq'
    ]
  ), []);

  const dedupeColumns = useCallback((cols: string[]): string[] => {
    const seen = new Set<string>();
    return cols.filter(col => {
      if (seen.has(col)) {
        return false;
      }
      seen.add(col);
      return true;
    });
  }, []);

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
      const combinedSorting = nodeData.sorting || { sort_by: '', sort_order: 'asc' };
      const handleCombinedSort = (col: string) => {
        const isSame = combinedSorting.sort_by === col;
        const nextOrder: 'asc'|'desc' = isSame && combinedSorting.sort_order === 'asc' ? 'desc' : 'asc';
        setCombinedPage(1);
        // Backend combined sorting via current-result POST
        void updateStoredResult({ combined: true, sort_by: col, sort_order: nextOrder, page: 1, page_size: combinedPageSize });
      };
      // Derive display columns: core first, then metadata (columns minus core and internal)
      const coreSet = new Set(coreCols);
      const metaCols = columns.filter(c => !coreSet.has(c) && c !== '__source_node');
      const rawDisplayColumns = showMetadata
        ? [...coreCols.filter(c => columns.includes(c)), ...metaCols]
        : coreCols.filter(c => columns.includes(c));
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
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <ScrollArea
              type="always"
              scrollbars="both"
              className="max-h-96"
              style={{ scrollbarGutter: 'stable both-edges' }}
            >
              <div className="min-w-max pb-4">
                <Table className="min-w-[720px]">
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    {displayColumns.map((c: string) => {
                      const lower = c.toLowerCase();
                      const neverSortable = ['left_context','matched_text','right_context'];
                      const sortable = !neverSortable.includes(lower);
                      const isSorted = sortable && combinedSorting.sort_by === c;
                      const icon = isSorted ? (combinedSorting.sort_order === 'asc' ? '▲' : '▼') : '▲▼';
                      return sortable ? (
                        <TableHead
                          key={c}
                          className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-wider cursor-pointer hover:bg-gray-100 ${isSorted ? 'text-blue-600' : 'text-gray-500'}`}
                          onClick={() => handleCombinedSort(c)}
                        >
                          <div className="flex items-center space-x-1">
                            <span>{c}</span>
                            <span className={`text-xs ${isSorted ? 'text-blue-600' : 'text-gray-400'}`}>{icon}</span>
                          </div>
                        </TableHead>
                      ) : (
                        <TableHead key={c} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{c}</TableHead>
                      );
                    })}
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
            {nodeData.pagination && (
              <div className="mt-2 text-sm text-gray-600 text-center p-2">{nodeData.pagination.total_matches} total matches</div>
            )}
            {nodeData.pagination && nodeData.pagination.total_pages > 1 && (
              <div className="mt-4 flex justify-center items-center space-x-2 p-4 pt-0">
                <Button
                  onClick={() => combinedPage > 1 && setCombinedPage(p => p-1)}
                  disabled={combinedPage <= 1}
                  variant="outline"
                  size="sm"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-sm text-gray-600">Page {combinedPage} of {nodeData.pagination.total_pages}</div>
                <Button
                  onClick={() => combinedPage < nodeData.pagination.total_pages && setCombinedPage(p => p+1)}
                  disabled={combinedPage >= nodeData.pagination.total_pages}
                  variant="outline"
                  size="sm"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      );
    }
    // Build per-node display columns using metadata
    const rows = nodeData.data || [];
    const allCols: string[] = (nodeData.columns || (rows.length ? Object.keys(rows[0]) : [])) as string[];
    const metaCols: string[] = (nodeData.metadata?.metadata_columns as string[] | undefined) ?? allCols.filter(c => !coreCols.includes(c));
    const rawDisplayColumns = showMetadata
      ? [...coreCols.filter(c => allCols.includes(c)), ...metaCols.filter(c => allCols.includes(c))]
      : coreCols.filter(c => allCols.includes(c));
    const displayColumns = dedupeColumns(rawDisplayColumns);

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
    const detachingKey = detachNodeId ?? "";
    const isDetaching = detachingKey ? Boolean(nodeDetaching[detachingKey]) : false;

    return (
      <div key={nodeKey} className="mb-6">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <ScrollArea
            type="always"
            scrollbars="both"
            className="max-h-96"
            style={{ scrollbarGutter: 'stable both-edges' }}
          >
            <div className="min-w-max pb-4">
              <Table className="min-w-[720px]">
              <TableHeader className="bg-gray-50">
                <TableRow>
                  {displayColumns.map(key => {
                    const neverSortable = ['left_context','matched_text','right_context'];
                    const keyLower = key.toLowerCase();
                    let isSortable: boolean;
                    if (neverSortable.includes(keyLower)) {
                      isSortable = false;
                    } else if (showMetadata) {
                      isSortable = true;
                    } else {
                      const allowed = ['l1','r1','l1_freq','r1_freq','document_idx'];
                      isSortable = allowed.includes(keyLower);
                    }
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
                      if (effectiveNodeId) {
                        handleRowClick(row, effectiveNodeId, column);
                      }
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

        {/* Pagination info for this node */}
        {nodeData.pagination && (
          <div className="mt-2 text-center text-sm text-muted-foreground">
            {nodeData.pagination.total_matches} total matches
          </div>
        )}

        {/* Individual pagination controls for this node */}
        {nodeData.pagination && nodeData.pagination.total_pages > 1 && (
          <div className="mt-4 flex justify-center items-center space-x-2">
            <Button
              onClick={() => handlePageChange(Math.max(1, currentPage - 1), paginationKey, requestNodeId)}
              disabled={currentPage <= 1 || nodeIsLoading}
              variant="outline"
              size="sm"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <div className="flex items-center text-sm text-muted-foreground">
              {nodeIsLoading && (
                <div className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-b border-muted-foreground"></div>
              )}
              Page {currentPage} of {nodeData.pagination.total_pages}
            </div>
            
            <Button
              onClick={() => handlePageChange(Math.min(nodeData.pagination.total_pages, currentPage + 1), paginationKey, requestNodeId)}
              disabled={currentPage >= nodeData.pagination.total_pages || nodeIsLoading}
              variant="outline"
              size="sm"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>

            {/* Detach button */}
            <Button
              onClick={() => {
                if (detachNodeId) {
                  handleDetach(detachNodeId, column);
                }
              }}
              disabled={nodeIsLoading || isDetaching || !searchWord.trim() || !canDetach || !detachNodeId}
              size="sm"
              className="bg-green-600 hover:bg-green-700 ml-2"
              title="Create a new node with concordance results joined to the original table"
            >
              {isDetaching ? (
                <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Detaching...</>
              ) : (
                <><LinkIcon className="mr-2 h-3 w-3" />Detach</>
              )}
            </Button>
          </div>
        )}

        {/* Pagination controls when only one page OR detach button for nodes without pagination */}
        {(!nodeData.pagination || nodeData.pagination.total_pages <= 1) && searchWord.trim() && (
          <div className="mt-4 flex justify-center">
            <Button
              onClick={() => {
                if (detachNodeId) {
                  handleDetach(detachNodeId, column);
                }
              }}
              disabled={nodeIsLoading || isDetaching || !canDetach || !detachNodeId}
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              title="Create a new node with concordance results joined to the original table"
            >
              {isDetaching ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Detaching...</>
              ) : (
                <><LinkIcon className="mr-2 h-4 w-4" />Detach Concordance</>
              )}
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Concordance Search</CardTitle>
              <CardDescription>Find keyword-in-context excerpts across up to two selected nodes.</CardDescription>
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
            lockedMessage={<AnalysisLockedNotice />}
          />

          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">Search word or phrase</label>
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
              panelSelectedNodes.length === 0 ||
              isSearching ||
              !currentWorkspaceId ||
              !searchWord.trim() ||
              effectiveNodeColumnSelections.some(sel => !sel.column) ||
              !!isLocked
            }
            className="w-full md:w-auto"
          >
            {isSearching ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Searching...</>
            ) : (
              <><Play className="mr-2 h-4 w-4" />Search</>
            )}
          </Button>

          {results && (
            <Button
              onClick={handleClearResults}
              variant="destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Results
            </Button>
          )}
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
                    <CardTitle>Search Results</CardTitle>
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
                  <div className="flex items-center gap-2">
                    <label htmlFor="concordance-page-size" className="text-sm font-medium text-foreground">
                      Results per page
                    </label>
                    <select
                      id="concordance-page-size"
                      value={globalPageSize}
                      onChange={(e) => {
                        const parsed = parseInt(e.target.value, 10);
                        if (!Number.isFinite(parsed) || parsed <= 0) {
                          return;
                        }
                        const newPageSize = parsed;
                        const previousPageSize = globalPageSize;
                        const previousPagination = Object.fromEntries(
                          Object.entries(nodePagination).map(([key, value]) => [key, { ...value }])
                        ) as typeof nodePagination;

                        setGlobalPageSize(newPageSize);
                        setNodePagination((prev) => {
                          const updated = { ...prev };
                          Object.keys(updated).forEach((nodeId) => {
                            updated[nodeId] = {
                              ...updated[nodeId],
                              pageSize: newPageSize,
                              currentPage: 1,
                            };
                          });
                          return updated;
                        });

                        void (async () => {
                          try {
                            await persistResultPreferences({ pageSize: newPageSize });
                          } catch (error) {
                            console.error('Failed to persist concordance page size preference', error);
                            setGlobalPageSize(previousPageSize);
                            setNodePagination(previousPagination);
                          }
                        })();
                      }}
                      className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>
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
                      if (localStorage.getItem('debugConc') === '1') {
                        console.debug('Trying to match nodeName:', nodeName);
                        console.debug('Available nodes:', selectedNodes.map(n => ({ id: n.id, name: n.data?.name, nodeName: n.name })));
                      }
                      
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
                      if (localStorage.getItem('debugConc') === '1') {
                        console.debug('Final match - nodeId:', resolvedNodeId, 'column:', column, 'paginationKey:', paginationKey);
                      }
                      
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
      {showDetailModal && selectedDetail && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowDetailModal(false)}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h3 className="text-lg font-medium text-gray-900">Concordance Detail</h3>
              <Button
                onClick={() => setShowDetailModal(false)}
                variant="ghost"
                size="icon"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
              <>
                {/* Metadata */}
                <div className="mb-6 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-gray-700">Document Index:</span>
                    <span className="ml-2">{selectedDetail.document_idx}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Search Word:</span>
                    <span className="ml-2 font-mono bg-yellow-100 px-1 rounded">{searchWord}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">L1 Word:</span>
                    <span className="ml-2">{selectedDetail.l1} (freq: {selectedDetail.l1_freq})</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">R1 Word:</span>
                    <span className="ml-2">{selectedDetail.r1} (freq: {selectedDetail.r1_freq})</span>
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
                                <div className="max-w-md break-words">
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
              </>
            </div>
          </div>
        </div>
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
