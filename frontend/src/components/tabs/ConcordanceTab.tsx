/* eslint-disable @typescript-eslint/no-explicit-any */
// NodeSelectionPanel now handles color selection UI inline
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import NodeSelectionPanel from '../NodeSelectionPanel';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { useWorkspaceSelection } from '../../hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '../../hooks/useWorkspaceStatus';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceActions } from '../../hooks/useWorkspaceActions';
import { useAuth } from '../../hooks/useAuth';
import { ConcordanceAnalysisRequest, ConcordanceAnalysisResponse, textApi } from '../../api/text';
import { httpRequest } from '../../api/http';
import { nodesApi } from '../../api/nodes';
import { useAnalysisStore } from '../../stores/analysisStore';
import useAutoNodeColumns from '../../hooks/useAutoNodeColumns';
import useNodeColumnInfos from '../../hooks/useNodeColumnInfos';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Play, Loader2, Trash2, Link as LinkIcon, X, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';

interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

const ConcordanceTab: React.FC = () => {
  // Anchor ref for results container to stabilize scroll on view mode toggle
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const { selectedNodes } = useWorkspaceSelection();
  const { isLoading } = useWorkspaceStatus();
  const { currentWorkspaceId, getNodeShape } = useWorkspaceData();
  const { detachConcordance } = useWorkspaceActions();

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
  });

  const { getAuthHeaders } = useAuth();
  const pendingConcordance = useAnalysisStore((state) => state.pendingConcordance);
  const clearPendingConcordance = useAnalysisStore((state) => state.clearPendingConcordance);

  const [isLocked, setIsLocked] = useState(false);
  // Shared auto column selection (shared with TokenFrequencyTab via undefined storageScope)
  const { selections: nodeColumnSelections, setSelection: setNodeColumnSelection, setSelections: setNodeColumnSelectionsRaw, recompute: recomputeAutoColumns } = useAutoNodeColumns({
    selectedNodes,
    getNodeColumns: getColumnInfos,
    allowedDataTypes: ['string']
  }, { workspaceId: currentWorkspaceId, maxNodes: 2, isLocked, docTypeOnly: true, enableHeuristicGuess: false });
  const [lockedNodeSelections, setLockedNodeSelections] = useState<NodeColumnSelection[] | null>(null);
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

  const mergeConcordanceResults = useCallback((incoming: ConcordanceAnalysisResponse | null) => {
    if (!incoming) return;
    setResults(prev => {
      if (!prev || !prev.data) {
        return incoming;
      }
      if (!incoming.data) {
        return prev;
      }
      const mergedData = { ...prev.data };
      Object.entries(incoming.data).forEach(([key, value]) => {
        mergedData[key] = value;
      });
      const mergedParams = incoming.analysis_params
        ? { ...(prev.analysis_params || {}), ...incoming.analysis_params }
        : prev.analysis_params;
      const mergedPreferences = incoming.preferences
        ? { ...(prev.preferences || {}), ...incoming.preferences }
        : prev.preferences;
      return {
        ...prev,
        state: incoming.state ?? prev.state,
        message: incoming.message ?? prev.message,
        data: mergedData,
        analysis_params: mergedParams,
        preferences: mergedPreferences,
        combinable: incoming.combinable ?? prev.combinable,
      };
    });
  }, []);
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
    // Build a CASE-INSENSITIVE lookup of every plausible identifier for a node
    const map: Record<string,string> = {};
    selectedNodes.forEach((n, idx) => {
      const assigned = nodeColors[n.id] || defaultPalette[idx % defaultPalette.length];
      const variants = new Set<string>();
      if (n.id) variants.add(n.id);
      if ((n as any).name) variants.add((n as any).name);
      if (n.name) variants.add(n.name);
      if (n.data?.name) variants.add(n.data.name);
      if ((n as any).label) variants.add((n as any).label);
      if (n.data?.label) variants.add(n.data.label);
      variants.forEach(v => { if (v) map[v.toString().toLowerCase()] = assigned; });
    });
    return map;
  }, [selectedNodes, nodeColors, defaultPalette]);
  
  const [lockedNodesSnapshot, setLockedNodesSnapshot] = useState<Array<{ id: string; name: string; columns: string[] }>>([]);
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

    if (pendingConcordance.nodeColumnSelections?.length) {
      const matchingSelections = pendingConcordance.nodeColumnSelections.filter((sel) =>
        selectedNodes.some((node: any) => node.id === sel.nodeId)
      );
      if (matchingSelections.length > 0) {
        setNodeColumnSelectionsRaw(matchingSelections, { replace: true });
      }
    }

    if (pendingConcordance.nodeColors) {
      setNodeColors((prev) => ({ ...pendingConcordance.nodeColors, ...prev }));
    }

    const delay = pendingConcordance.autoRun ? 50 : 500;
    let timeoutId: number | null = null;
    if (pendingConcordance.searchWord && selectedNodes.length > 0) {
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
  }, [pendingConcordance, selectedNodes, setNodeColumnSelectionsRaw, clearPendingConcordance]);

  // Recompute auto columns if unlocked and selections empty but nodes exist
  useEffect(() => {
    if (!isLocked && selectedNodes.length > 0 && nodeColumnSelections.length === 0) {
      recomputeAutoColumns();
    }
  }, [isLocked, selectedNodes, nodeColumnSelections, recomputeAutoColumns]);


  // Ensure every selected node has a color
  useEffect(() => {
    if (!selectedNodes.length) return;
    setNodeColors(prev => {
      const updated = { ...prev };
      let paletteIndex = 0;
      selectedNodes.forEach(n => {
        if (!updated[n.id]) {
          while (Object.values(updated).includes(defaultPalette[paletteIndex % defaultPalette.length]) && paletteIndex < defaultPalette.length * 2) {
            paletteIndex++;
          }
          updated[n.id] = defaultPalette[paletteIndex % defaultPalette.length];
          paletteIndex++;
        }
      });
      return updated;
    });
  }, [selectedNodes, defaultPalette]);


  const handleColorChange = (nodeId: string, color: string) => setNodeColors(prev => ({ ...prev, [nodeId]: color }));
  // Color assignments now handled by NodeSelectionPanel; retain helper for any future use
  const getColorForNodeId = (nodeId: string, idx: number) => nodeColors[nodeId] || defaultPalette[idx % defaultPalette.length]; // eslint-disable-line @typescript-eslint/no-unused-vars

  // Stabilize the selectedNodes passed to NodeSelectionPanel to avoid repeated shape fetches
  const displayedNodes = useMemo(() => {
    if (isLocked && lockedNodesSnapshot.length) {
      return lockedNodesSnapshot.map(s => ({ id: s.id, name: s.name, data: { name: s.name, nodeName: s.name, label: s.name, columns: s.columns }, columns: s.columns }));
    }
    return selectedNodes;
  }, [isLocked, lockedNodesSnapshot, selectedNodes]);

  const handleColumnChange = (nodeId: string, column: string) => setNodeColumnSelection(nodeId, column);

  const handleSearch = useCallback(async (
    resetPage = true,
    targetNodeId?: string,
    forceMode?: 'separated'|'combined',
    overrideSortBy?: string,
    overrideSortOrder?: 'asc'|'desc',
    allowWhenLocked: boolean = false
  ) => {
    if (isLocked && !allowWhenLocked) return;
    if (!currentWorkspaceId || selectedNodes.length === 0) {
      return;
    }

    if (!searchWord.trim()) {
      alert('Please enter a search word.');
      return;
    }

    // Validate that all nodes have columns selected
    const incompleteSelections = nodeColumnSelections.filter(sel => !sel.column);
    if (incompleteSelections.length > 0) {
      alert('Please select a text column for all selected nodes.');
      return;
    }

    // Reset or update pagination
    const updatedPagination = { ...nodePagination };
    selectedNodes.forEach(node => {
      const nodeId = node.id;
      if (!updatedPagination[nodeId]) {
        updatedPagination[nodeId] = {
          currentPage: 1,
          pageSize: globalPageSize,
          sortBy: '',
          sortOrder: 'asc' as 'asc' | 'desc'
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

    setIsSearching(true);
    try {
      // Create node_columns mapping
      const nodeColumns: Record<string, string> = {};
      nodeColumnSelections.forEach(sel => {
        nodeColumns[sel.nodeId] = sel.column;
      });

      const firstNodeId = selectedNodes[0].id;
      const firstNodePagination = updatedPagination[firstNodeId];
      const authHeaders = getAuthHeaders();
      const isCombinedQuery = effectiveMode === 'combined';
      const useStoredResult = forceMode !== undefined || (isLocked && allowWhenLocked);
      let response: ConcordanceAnalysisResponse | null = null;

      if (useStoredResult) {
        const overrides: Record<string, any> = {
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

        response = await textApi.postConcordanceCurrentResult(currentWorkspaceId, overrides, authHeaders) as ConcordanceAnalysisResponse;
        if (response?.data) {
          mergeConcordanceResults(response);
        } else if (response) {
          setResults(response);
        }

        if (isCombinedQuery && response && response.combinable === false) {
          setViewMode('separated');
        }
      } else {
        const request: ConcordanceAnalysisRequest = {
          node_ids: selectedNodes.slice(0, 2).map(node => node.id),
          node_columns: nodeColumns,
          search_word: searchWord.trim(),
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
        // Lock UI and snapshot nodes
        try {
          const ids = selectedNodes.slice(0, 2).map(n => n.id);
          const snaps: Array<{ id: string; name: string; columns: string[] }> = [];
          for (const id of ids) {
            try {
              const info = await nodesApi.info(currentWorkspaceId!, id, authHeaders);
              const name = (info as any)?.name || (info as any)?.data?.name || id;
              const columns = Array.isArray((info as any)?.columns) ? (info as any).columns : (Array.isArray((info as any)?.data?.columns) ? (info as any).data.columns : []);
              snaps.push({ id, name: String(name), columns });
            } catch {
              snaps.push({ id, name: id, columns: [] });
            }
          }
          setLockedNodesSnapshot(snaps);
          setIsLocked(true);
        } catch { /* ignore */ }

        if (response?.combinable === false && viewMode === 'combined') {
          setViewMode('separated');
        }
      }
    } catch (error) {
      console.error('Error performing concordance search:', error);
      setResults({
        state: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        data: {}
      } as any);
    } finally {
      setIsSearching(false);
    }
  }, [currentWorkspaceId, selectedNodes, searchWord, nodeColumnSelections, nodePagination, globalPageSize, numLeftTokens, numRightTokens, regex, caseSensitive, getAuthHeaders, viewMode, combinedPage, combinedPageSize, isLocked, mergeConcordanceResults]);

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
          setNodeColumnSelectionsRaw(sels, { replace: true });
          setLockedNodeSelections(sels);
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
                const info = await nodesApi.info(currentWorkspaceId!, id, getAuthHeaders());
                const name = (info as any)?.name || (info as any)?.data?.name || id;
                const columns = Array.isArray((info as any)?.columns) ? (info as any).columns : (Array.isArray((info as any)?.data?.columns) ? (info as any).data.columns : []);
                snaps.push({ id, name: String(name), columns });
              } catch {
                snaps.push({ id, name: id, columns: [] });
              }
            }
            setLockedNodesSnapshot(snaps);
            setIsLocked(true);
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
  }, [currentWorkspaceId, getAuthHeaders, setNodeColumnSelectionsRaw]);

  const handleClearResults = async () => {
    try {
      if (currentWorkspaceId) {
  await textApi.clearConcordance(currentWorkspaceId, getAuthHeaders());
      }
    } catch (e) {
      console.error('Failed to clear backend analyses/cache:', e);
    }
    setResults(null);
    setNodePagination({});
    setCombinedPage(1);
    setLockedNodesSnapshot([]);
    setIsLocked(false);
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
      // Request combined page via current-result POST
      void (async () => {
        if (!currentWorkspaceId) return;
        const resp: any = await textApi.postConcordanceCurrentResult(currentWorkspaceId, { combined: true, page: combinedPage, page_size: combinedPageSize }, getAuthHeaders());
        if (resp?.data) mergeConcordanceResults(resp as ConcordanceAnalysisResponse);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedPage]);

  const handleSort = (columnName: string, nodeKey: string, requestNodeId?: string) => {
    setNodePagination(prev => {
      const currentNodePagination = prev[nodeKey] || {
        currentPage: 1,
        pageSize: globalPageSize,
        sortBy: '',
        sortOrder: 'asc' as 'asc' | 'desc'
      };

      const isSameColumn = currentNodePagination.sortBy === columnName;
      const newSortOrder = isSameColumn ? (currentNodePagination.sortOrder === 'asc' ? 'desc' : 'asc') : 'asc';

      // Trigger backend resort using current-result POST
      const pageSize = currentNodePagination.pageSize;
      const workspaceId = currentWorkspaceId;
      if (!workspaceId) {
        return prev;
      }
      const targetNodeId = requestNodeId ?? nodeKey;
      void (async (wid: string) => {
        setNodeLoading(prev => ({ ...prev, [nodeKey]: true }));
        try {
          const overrides = { node_id: targetNodeId, sort_by: columnName, sort_order: newSortOrder, page: 1, page_size: pageSize } as any;
          const resp: any = await textApi.postConcordanceCurrentResult(wid, overrides, getAuthHeaders());
          if (resp?.data) mergeConcordanceResults(resp as ConcordanceAnalysisResponse);
        } finally {
          setNodeLoading(prev => ({ ...prev, [nodeKey]: false }));
        }
      })(workspaceId);

      return {
        ...prev,
        [nodeKey]: {
          ...currentNodePagination,
          currentPage: 1, // reset to first page on new sort
          sortBy: columnName,
          sortOrder: newSortOrder
        }
      };
    });
  };

  const handlePageChange = (newPage: number, nodeKey: string, requestNodeId?: string) => {
    setNodePagination(prev => {
      const currentNodePagination = prev[nodeKey] || {
        currentPage: 1,
        pageSize: globalPageSize,
        sortBy: '',
        sortOrder: 'asc' as 'asc' | 'desc'
      };

      // Trigger backend page update using current-result POST
      const workspaceId = currentWorkspaceId;
      if (!workspaceId) {
        return prev;
      }
      const targetNodeId = requestNodeId ?? nodeKey;
      void (async (wid: string) => {
        setNodeLoading(prev => ({ ...prev, [nodeKey]: true }));
        try {
          const overrides = {
            node_id: targetNodeId,
            page: newPage,
            page_size: currentNodePagination.pageSize,
            sort_by: currentNodePagination.sortBy || undefined,
            sort_order: currentNodePagination.sortOrder,
          } as any;
          const resp: any = await textApi.postConcordanceCurrentResult(wid, overrides, getAuthHeaders());
          if (resp?.data) mergeConcordanceResults(resp as ConcordanceAnalysisResponse);
        } finally {
          setNodeLoading(prev => ({ ...prev, [nodeKey]: false }));
        }
      })(workspaceId);

      return {
        ...prev,
        [nodeKey]: {
          ...currentNodePagination,
          currentPage: newPage
        }
      };
    });
  };

  const persistResultPreferences = useCallback(async (partial: { pageSize?: number; showMetadata?: boolean }) => {
    const workspaceId = currentWorkspaceId;
    if (!workspaceId) {
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

    const headers = getAuthHeaders();

    try {
      await textApi.postConcordanceCurrentResult(
        workspaceId,
        { ...preferenceUpdates, update_only: true } as any,
        headers,
      );

      const params: Record<string, unknown> = { combined: viewMode === 'combined' };
      if (viewMode === 'combined') {
        params.page = combinedPage;
        params.page_size = partial.pageSize ?? combinedPageSize;
      } else {
        params.page = 1;
        params.page_size = partial.pageSize ?? globalPageSize;
      }

      const refreshed = await httpRequest<ConcordanceAnalysisResponse>(
        `/workspaces/${workspaceId}/concordance/current-result`,
        { method: 'GET', headers, params },
      );

      mergeConcordanceResults(refreshed);
      return refreshed;
    } catch (error) {
      console.error('Failed to persist concordance preferences', error);
      throw error;
    }
  }, [combinedPage, combinedPageSize, currentWorkspaceId, getAuthHeaders, globalPageSize, mergeConcordanceResults, viewMode]);

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
    nodeName: string,
    nodeData: any,
    context: { nodeId: string; paginationKey: string; requestNodeId: string; column: string }
  ) => {
    const { nodeId: actualNodeId, paginationKey, requestNodeId, column } = context;
    const effectiveNodeId = actualNodeId || requestNodeId;
    const detachNodeId = actualNodeId || (labelToNodeId?.[nodeName] ?? requestNodeId);
    const canDetach = Boolean(detachNodeId) && detachNodeId !== '__COMBINED__';
    if (nodeName === '__COMBINED__') {
      const rows = nodeData.data || [];
      const columns: string[] = nodeData.columns || [];
      const combinedSorting = nodeData.sorting || { sort_by: '', sort_order: 'asc' };
      const handleCombinedSort = (col: string) => {
        const isSame = combinedSorting.sort_by === col;
        const nextOrder: 'asc'|'desc' = isSame && combinedSorting.sort_order === 'asc' ? 'desc' : 'asc';
        setCombinedPage(1);
        // Backend combined sorting via current-result POST
        void (async () => {
          if (!currentWorkspaceId) return;
          const resp: any = await textApi.postConcordanceCurrentResult(currentWorkspaceId, { combined: true, sort_by: col, sort_order: nextOrder, page: 1, page_size: combinedPageSize }, getAuthHeaders());
          if (resp?.data) mergeConcordanceResults(resp as ConcordanceAnalysisResponse);
        })();
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
                      const col = (nodeColumnSelections.find(s => s.nodeId === nid)?.column || '');
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
            <div className="max-h-96 overflow-y-auto">
              <Table>
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
                  const nodesForDetail = displayedNodes;
                    const nodeObj = nodesForDetail.find((n: any) => {
                            const candidates = [n.id, n.name, (n as any).name, n.data?.name, (n as any).label, n.data?.label].filter(Boolean).map(v=>v.toString().toLowerCase());
                            return candidates.includes(rawSrc.toString().toLowerCase());
                          });
                          const sel = nodeObj && nodeColumnSelections.find(s => s.nodeId === nodeObj.id);
                          if (nodeObj && sel) handleRowClick(row, nodeObj.id, sel.column);
                        }
                      }}>
                        {displayColumns.map((c: string, i: number) => <TableCell key={i}>{row[c] !== undefined && row[c] !== null ? String(row[c]) : ''}</TableCell>)}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
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
        <div key={nodeName} className="mb-6">
          <div className="h-16 mb-4 flex items-center">
            <h3 className="text-lg font-semibold text-gray-800 break-words leading-tight w-full">{nodeName}</h3>
          </div>
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
      <div key={nodeName} className="mb-6">
        <div className="h-16 mb-4 flex items-center">
          <h3 className="text-lg font-semibold text-gray-800 break-words leading-tight w-full">{nodeName}</h3>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="max-h-96 overflow-y-auto">
            <Table>
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
{isLocked && (
              <div className="relative group flex items-center text-sm text-muted-foreground">
                <svg className="mr-1 h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M5 8V6a5 5 0 1110 0v2h1a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1h1zm2-2a3 3 0 116 0v2H7V6zm-2 4h10v7H5v-7z" clipRule="evenodd" />
                </svg>
                Locked
                <div className="absolute right-0 top-full z-10 mt-2 hidden w-72 rounded border border-border bg-popover p-2 text-xs text-popover-foreground shadow-lg group-hover:block">
                  <div className="mb-1 font-semibold">Panel locked</div>
                  <ul className="ml-4 space-y-1 list-disc">
                    <li>Locked to current request/results.</li>
                    <li>Node selection and backend-used parameters are disabled.</li>
                    <li>Frontend-only options (e.g., Show Metadata) stay editable.</li>
                    <li>Clear results to unlock and resync with the graph selection.</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          <NodeSelectionPanel
            selectedNodes={displayedNodes}
            nodeColumnSelections={isLocked && lockedNodeSelections ? lockedNodeSelections : nodeColumnSelections}
            onColumnChange={handleColumnChange}
            nodeColors={nodeColors}
            onColorChange={handleColorChange}
            defaultPalette={defaultPalette}
            maxCompare={2}
            showShape
            getNodeShapeFn={getNodeShape}
            disabled={!!isLocked}
            showColorPicker={true}
            getNodeColumns={getColumnInfos}
            allowedDataTypes={['string']}
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
              selectedNodes.length === 0 ||
              isSearching ||
              !currentWorkspaceId ||
              !searchWord.trim() ||
              nodeColumnSelections.some(sel => !sel.column) ||
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

      {/* Results */}
      {results && (
        <Card ref={resultsRef}>
          {((results as any)?.state === 'successful') ? (
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
                      
                      const nodesForDetail = displayedNodes;
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
                        const nodeIndex = Object.keys(results.data).indexOf(nodeName);
                        node = (nodesForDetail as any)[nodeIndex];
                      }
                      
                      const resolvedNodeId = node?.id || mappedNodeId || '';
                      const paginationKey = resolvedNodeId || nodeName;
                      const requestNodeId = resolvedNodeId || nodeName;
                      const selection = nodeColumnSelections.find(sel => sel.nodeId === resolvedNodeId);
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
          ) : (
            <CardContent>
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {results?.message ?? 'The search failed. Please try again.'}
              </div>
            </CardContent>
          )}
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

export default ConcordanceTab;
