import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import NodeSelectionPanel from '../NodeSelectionPanel';
import SegmentedControl from '../ui/SegmentedControl';
import { useWorkspaceSelection } from '../../hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '../../hooks/useWorkspaceStatus';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceActions } from '../../hooks/useWorkspaceActions';
import { useAuth } from '../../hooks/useAuth';
import { ConcordanceAnalysisRequest, ConcordanceAnalysisResponse, textApi } from '../../api/text';
import { nodesApi } from '../../api/nodes';
import { workspacesApi } from '../../api/workspaces';
import useAutoNodeColumns from '../../hooks/useAutoNodeColumns';
import useNodeColumnInfos from '../../hooks/useNodeColumnInfos';

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
      return {
        state: incoming.state ?? prev.state,
        message: incoming.message ?? prev.message,
        data: mergedData,
        analysis_params: mergedParams,
        combinable: incoming.combinable ?? prev.combinable,
      };
    });
  }, []);
  // Color management & view mode
  const [nodeColors, setNodeColors] = useState<Record<string,string>>({});
  const defaultPalette = useMemo(() => [
    '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#d97706', '#0d9488', '#db2777', '#4f46e5', '#65a30d', '#0891b2', '#92400e', '#6b7280'
  ], []);
  // Track the last pair of node IDs used when results were generated
  const [lastCompareNodeIds, setLastCompareNodeIds] = useState<string[]>([]);
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
      if (results) {
      if (localStorage.getItem('debugConc') === '1') {
  console.log('Concordance results updated:', results);
	console.log('Results state:', (results as any)?.state);
        console.log('Results data:', (results as any)?.data);
      }
      if ((results as any)?.data) {
  if (localStorage.getItem('debugConc') === '1') console.log('Data entries:', Object.entries(results.data));
      }
    }
  }, [results]);

  useEffect(() => {
    if (viewMode === 'combined' && results && results.combinable === false) {
      setViewMode('separated');
    }
  }, [viewMode, results]);

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

  // Check for pending concordance search from TokenFrequencyTab.
  // When autoRun is true (set by token click), we trigger faster (50ms) instead of default 500ms hydration delay.
  useEffect(() => {
    const pendingSearch = localStorage.getItem('pendingConcordanceSearch');
    if (!pendingSearch) return;
    try {
      const params = JSON.parse(pendingSearch);
      if (localStorage.getItem('debugConc') === '1') console.log('Found pending concordance search:', params);

      // Set core state
      if (params.searchWord) setSearchWord(params.searchWord);

      if (params.nodeColumnSelections && params.selectedNodes) {
        const matchingSelections = params.nodeColumnSelections.filter((sel: any) =>
          selectedNodes.some((node: any) => node.id === sel.nodeId)
        );
  if (matchingSelections.length > 0) setNodeColumnSelectionsRaw(matchingSelections, { replace: true });
      }
      if (params.nodeColors) setNodeColors((prev) => ({ ...params.nodeColors, ...prev }));

      // Always clear immediately so we don't re-run repeatedly on re-renders
      localStorage.removeItem('pendingConcordanceSearch');

      // Decide trigger strategy. If explicit autoRun flag present, trigger ASAP (next tick)
      const delay = params.autoRun ? 50 : 500; // shorter delay when explicitly requested
      if (params.searchWord && selectedNodes.length > 0) {
        setTimeout(() => {
          if (localStorage.getItem('debugConc') === '1') console.log(`Auto-triggering concordance search for: ${params.searchWord} (delay=${delay}ms, autoRun=${params.autoRun})`);
          setShouldAutoSearch(true);
        }, delay);
      }
    } catch (error) {
      console.error('Error parsing pending concordance search:', error);
      localStorage.removeItem('pendingConcordanceSearch');
    }
  }, [selectedNodes]);

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

  // Removed old color popover logic (centralized in ColorSwatchPicker)

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
          page: firstNodePagination.currentPage,
          page_size: firstNodePagination.pageSize,
          sort_by: (overrideSortBy ?? firstNodePagination.sortBy) || undefined,
          sort_order: overrideSortOrder ?? firstNodePagination.sortOrder,
          combined: false,
        };
        response = await textApi.concordance(currentWorkspaceId, request, authHeaders);
        if (localStorage.getItem('debugConc') === '1') console.log('Multi-Node Concordance Response:', response);
        setResults(response);
        setLastCompareNodeIds(selectedNodes.slice(0, 2).map(n => n.id));
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
  }, [currentWorkspaceId, selectedNodes, searchWord, nodeColumnSelections, nodePagination, globalPageSize, numLeftTokens, numRightTokens, regex, caseSensitive, showMetadata, getAuthHeaders, viewMode, combinedPage, combinedPageSize, isLocked]);

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
          setLastCompareNodeIds(nodeIds);
          
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
      } catch (_) { /* ignore */ }
    })();
  }, [currentWorkspaceId, getAuthHeaders]);

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

  const handleSort = (columnName: string, nodeId: string) => {
    setNodePagination(prev => {
      const currentNodePagination = prev[nodeId] || {
        currentPage: 1,
        pageSize: globalPageSize,
        sortBy: '',
        sortOrder: 'asc' as 'asc' | 'desc'
      };

      const isSameColumn = currentNodePagination.sortBy === columnName;
      const newSortOrder = isSameColumn ? (currentNodePagination.sortOrder === 'asc' ? 'desc' : 'asc') : 'asc';

      // Trigger backend resort using current-result POST
      const pageSize = currentNodePagination.pageSize;
      void (async () => {
    if (!currentWorkspaceId) return;
    const overrides = { node_id: nodeId, sort_by: columnName, sort_order: newSortOrder, page: 1, page_size: pageSize } as any;
    const resp: any = await textApi.postConcordanceCurrentResult(currentWorkspaceId, overrides, getAuthHeaders());
    if (resp?.data) mergeConcordanceResults(resp as ConcordanceAnalysisResponse);
      })();

      return {
        ...prev,
        [nodeId]: {
          ...currentNodePagination,
          currentPage: 1, // reset to first page on new sort
          sortBy: columnName,
          sortOrder: newSortOrder
        }
      };
    });
  };

  const handlePageChange = (newPage: number, nodeId: string) => {
    setNodePagination(prev => {
      const currentNodePagination = prev[nodeId] || {
        currentPage: 1,
        pageSize: globalPageSize,
        sortBy: '',
        sortOrder: 'asc' as 'asc' | 'desc'
      };

      // Trigger backend page update using current-result POST
      void (async () => {
        if (!currentWorkspaceId) return;
        const overrides = {
          node_id: nodeId,
          page: newPage,
          page_size: currentNodePagination.pageSize,
          sort_by: currentNodePagination.sortBy || undefined,
          sort_order: currentNodePagination.sortOrder,
        } as any;
        const resp: any = await textApi.postConcordanceCurrentResult(currentWorkspaceId, overrides, getAuthHeaders());
        if (resp?.data) mergeConcordanceResults(resp as ConcordanceAnalysisResponse);
      })();

      return {
        ...prev,
        [nodeId]: {
          ...currentNodePagination,
          currentPage: newPage
        }
      };
    });
  };

  // New function to search a single node (for pagination and sorting)
  const handleSingleNodeSearch = async (nodeId: string, overridePage?: number, overrideSortBy?: string, overrideSortOrder?: 'asc'|'desc') => {
    if (!currentWorkspaceId || !searchWord.trim()) {
      return;
    }

    // Find the node and its column selection
    const node = selectedNodes.find(n => n.id === nodeId);
    if (!node) return;

    const selection = nodeColumnSelections.find(sel => sel.nodeId === nodeId);
    if (!selection?.column) return;

    const nodeState = nodePagination[nodeId] || {
      currentPage: 1,
      pageSize: globalPageSize,
      sortBy: '',
      sortOrder: 'asc' as 'asc' | 'desc'
    };

    // Use override page if provided, otherwise use state
  const currentPage = overridePage !== undefined ? overridePage : nodeState.currentPage;

    // Set loading for this specific node
    setNodeLoading(prev => ({ ...prev, [nodeId]: true }));
    
    try {
      const overrides = {
        node_id: nodeId,
        combined: false,
        page: currentPage,
        page_size: nodeState.pageSize,
        sort_by: (overrideSortBy ?? nodeState.sortBy) || undefined,
        sort_order: overrideSortOrder ?? nodeState.sortOrder,
      };

      const response = await textApi.postConcordanceCurrentResult(currentWorkspaceId, overrides, getAuthHeaders()) as ConcordanceAnalysisResponse;

      if (localStorage.getItem('debugConc') === '1') console.log('Single Node Concordance Response:', response);

      if (response?.data) {
        mergeConcordanceResults(response);
      } else if (response) {
        setResults(response);
      }
    } catch (error) {
      console.error('Error performing single node concordance search:', error);
    } finally {
      // Clear loading for this specific node
      setNodeLoading(prev => ({ ...prev, [nodeId]: false }));
    }
  };

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

  const SortableHeader: React.FC<{ columnKey: string; label: string; nodeId: string }> = ({ columnKey, label, nodeId }) => {
    const nodeState = nodePagination[nodeId] || { sortBy: '', sortOrder: 'asc' as 'asc' | 'desc' };
    const isSorted = nodeState.sortBy === columnKey;
    const sortIcon = isSorted ? (nodeState.sortOrder === 'asc' ? '▲' : '▼') : '▲▼';
    
    return (
      <th 
        className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
        onClick={() => handleSort(columnKey, nodeId)}
      >
        <div className="flex items-center space-x-1">
          <span>{label}</span>
          <span className={`text-xs ${isSorted ? 'text-blue-600' : 'text-gray-400'}`}>
            {sortIcon}
          </span>
        </div>
      </th>
    );
  };

  const coreCols = useMemo(() => (
    [
      'document_idx','left_context','matched_text','right_context','start_idx','end_idx','l1','r1','l1_freq','r1_freq'
    ]
  ), []);

  const renderConcordanceTable = (nodeName: string, nodeData: any, nodeId: string, column: string) => {
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
      const displayColumns = showMetadata ? [...coreCols.filter(c => columns.includes(c)), ...metaCols] : coreCols.filter(c => columns.includes(c));

      return (
        <div key="__COMBINED__" className="mb-6">
          <div className="flex items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Combined Results</h3>
            <div className="ml-auto flex items-center space-x-2">
              <span className="text-xs text-gray-500">Rows colored by source node</span>
              <button
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
                className="px-3 py-1 bg-green-600 text-white rounded text-sm disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-green-700 transition-colors"
              >Detach Both</button>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {displayColumns.map((c: string) => {
                      const lower = c.toLowerCase();
                      const neverSortable = ['left_context','matched_text','right_context'];
                      const sortable = !neverSortable.includes(lower);
                      const isSorted = sortable && combinedSorting.sort_by === c;
                      const icon = isSorted ? (combinedSorting.sort_order === 'asc' ? '▲' : '▼') : '▲▼';
                      return sortable ? (
                        <th
                          key={c}
                          className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => handleCombinedSort(c)}
                        >
                          <div className="flex items-center space-x-1">
                            <span>{c}</span>
                            <span className={`text-xs ${isSorted ? 'text-blue-600' : 'text-gray-400'}`}>{icon}</span>
                          </div>
                        </th>
                      ) : (
                        <th key={c} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{c}</th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
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
                      <tr key={idx} className="cursor-pointer hover:bg-blue-50" style={{ backgroundColor: bg }} onClick={() => {
                        if (rawSrc) {
                    const nodesForDetail = selectedNodes;
                    const nodeObj = nodesForDetail.find((n: any) => {
                            const candidates = [n.id, n.name, (n as any).name, n.data?.name, (n as any).label, n.data?.label].filter(Boolean).map(v=>v.toString().toLowerCase());
                            return candidates.includes(rawSrc.toString().toLowerCase());
                          });
                          const sel = nodeObj && nodeColumnSelections.find(s => s.nodeId === nodeObj.id);
                          if (nodeObj && sel) handleRowClick(row, nodeObj.id, sel.column);
                        }
                      }}>
                        {displayColumns.map((c: string, i: number) => <td key={i} className="px-4 py-2 text-sm text-gray-900">{row[c] !== undefined && row[c] !== null ? String(row[c]) : ''}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {nodeData.pagination && (
              <div className="mt-2 text-sm text-gray-600 text-center p-2">{nodeData.pagination.total_matches} total matches</div>
            )}
            {nodeData.pagination && nodeData.pagination.total_pages > 1 && (
              <div className="mt-4 flex justify-center items-center space-x-2 p-4 pt-0">
                <button onClick={() => combinedPage > 1 && setCombinedPage(p => p-1)} disabled={combinedPage <= 1} className="px-3 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 disabled:text-gray-400 hover:bg-gray-50">Previous</button>
                <div className="text-sm text-gray-600">Page {combinedPage} of {nodeData.pagination.total_pages}</div>
                <button onClick={() => combinedPage < nodeData.pagination.total_pages && setCombinedPage(p => p+1)} disabled={combinedPage >= nodeData.pagination.total_pages} className="px-3 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 disabled:text-gray-400 hover:bg-gray-50">Next</button>
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
    const displayColumns = showMetadata ? [...coreCols.filter(c => allCols.includes(c)), ...metaCols.filter(c => allCols.includes(c))] : coreCols.filter(c => allCols.includes(c));

    if (!nodeData.data || nodeData.data.length === 0) {
      return (
        <div key={nodeName} className="mb-6">
          <div className="h-16 mb-4 flex items-center">
            <h3 className="text-lg font-semibold text-gray-800 break-words leading-tight w-full">{nodeName}</h3>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-center text-gray-500">
              No results found for "{searchWord}"
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={nodeName} className="mb-6">
        <div className="h-16 mb-4 flex items-center">
          <h3 className="text-lg font-semibold text-gray-800 break-words leading-tight w-full">{nodeName}</h3>
        </div>
        
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="max-h-96 overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
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
                      <SortableHeader key={key} columnKey={key} label={key} nodeId={nodeId} />
                    ) : (
                      <th key={key} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {key}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {nodeData.data.map((row: any, index: number) => (
                  <tr 
                    key={index} 
                    className={`cursor-pointer hover:bg-blue-50 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                    onClick={() => handleRowClick(row, nodeId, column)}
                  >
                    {displayColumns.map((colKey: string, cellIndex) => (
                      <td key={cellIndex} className="px-4 py-2 text-sm text-gray-900">
                        {row[colKey] !== null && row[colKey] !== undefined ? String(row[colKey]) : ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination info for this node */}
        {nodeData.pagination && (
          <div className="mt-2 text-sm text-gray-600 text-center">
            {nodeData.pagination.total_matches} total matches
          </div>
        )}

        {/* Individual pagination controls for this node */}
        {nodeData.pagination && nodeData.pagination.total_pages > 1 && (
          <div className="mt-4 flex justify-center items-center space-x-2">
            <button
              onClick={() => handlePageChange((nodePagination[nodeId]?.currentPage || 1) - 1, nodeId)}
              disabled={(nodePagination[nodeId]?.currentPage || 1) <= 1 || nodeLoading[nodeId]}
              className="px-3 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 disabled:text-gray-400 hover:bg-gray-50"
            >
              Previous
            </button>
            
            <div className="text-sm text-gray-600 flex items-center">
              {nodeLoading[nodeId] && (
                <div className="inline-block animate-spin rounded-full h-3 w-3 border-b border-gray-400 mr-2"></div>
              )}
              Page {nodePagination[nodeId]?.currentPage || 1} of {nodeData.pagination.total_pages}
            </div>
            
            <button
              onClick={() => handlePageChange((nodePagination[nodeId]?.currentPage || 1) + 1, nodeId)}
              disabled={(nodePagination[nodeId]?.currentPage || 1) >= nodeData.pagination.total_pages || nodeLoading[nodeId]}
              className="px-3 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 disabled:text-gray-400 hover:bg-gray-50"
            >
              Next
            </button>

            {/* Detach button */}
            <button
              onClick={() => handleDetach(nodeId, column)}
              disabled={nodeLoading[nodeId] || nodeDetaching[nodeId] || !searchWord.trim()}
              className="px-3 py-1 bg-green-600 text-white rounded text-sm disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-green-700 transition-colors ml-2"
              title="Create a new node with concordance results joined to the original table"
            >
              {nodeDetaching[nodeId] ? (
                <span className="flex items-center">
                  <div className="inline-block animate-spin rounded-full h-3 w-3 border-b border-white mr-2"></div>
                  Detaching...
                </span>
              ) : (
                'Detach'
              )}
            </button>
          </div>
        )}

        {/* Pagination controls when only one page OR detach button for nodes without pagination */}
        {(!nodeData.pagination || nodeData.pagination.total_pages <= 1) && searchWord.trim() && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => handleDetach(nodeId, column)}
              disabled={nodeLoading[nodeId] || nodeDetaching[nodeId]}
              className="px-4 py-2 bg-green-600 text-white rounded text-sm disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-green-700 transition-colors"
              title="Create a new node with concordance results joined to the original table"
            >
              {nodeDetaching[nodeId] ? (
                <span className="flex items-center">
                  <div className="inline-block animate-spin rounded-full h-3 w-3 border-b border-white mr-2"></div>
                  Detaching...
                </span>
              ) : (
                'Detach Concordance'
              )}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-800">Concordance Search</h2>
{isLocked && (
            <div className="relative group flex items-center text-sm text-gray-600 cursor-default">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M5 8V6a5 5 0 1110 0v2h1a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1h1zm2-2a3 3 0 116 0v2H7V6zm-2 4h10v7H5v-7z" clipRule="evenodd" />
              </svg>
              Locked
              <div className="absolute right-0 mt-2 w-72 z-10 hidden group-hover:block bg-white border border-gray-200 shadow-lg rounded p-2 text-xs text-gray-700">
                <div className="font-semibold mb-1">Panel locked</div>
                <ul className="list-disc ml-4 space-y-1">
                  <li>Locked to current request/results.</li>
                  <li>Node selection and backend-used parameters are disabled.</li>
                  <li>Frontend-only options (e.g., Show Metadata) stay editable.</li>
                  <li>Clear results to unlock and resync with the graph selection.</li>
                </ul>
              </div>
            </div>
          )}
        </div>
        
        <div className="mb-6">
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
        </div>

        {/* Search Configuration */}
        <div className="mb-6">
          <div className={`space-y-4`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Search Word/Phrase
                </label>
                <input
                  type="text"
                  value={searchWord}
                  onChange={(e) => setSearchWord(e.target.value)}
                  placeholder="Enter word or phrase to search for"
                  disabled={!!isLocked}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              </div>

              <div className="md:flex-none">
                <label className="block text-sm font-medium text-gray-700 mb-2 leading-tight">
                  <span className="block">Left Context</span>
                  <span className="block">(tokens)</span>
                </label>
                <input
                  type="number"
                  value={numLeftTokens}
                  onChange={(e) => setNumLeftTokens(parseInt(e.target.value) || 10)}
                  min="1"
                  max="50"
                  disabled={!!isLocked}
                  className="w-full md:w-auto md:max-w-[7rem] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              </div>

              <div className="md:flex-none">
                <label className="block text-sm font-medium text-gray-700 mb-2 leading-tight">
                  <span className="block">Right Context</span>
                  <span className="block">(tokens)</span>
                </label>
                <input
                  type="number"
                  value={numRightTokens}
                  onChange={(e) => setNumRightTokens(parseInt(e.target.value) || 10)}
                  min="1"
                  max="50"
                  disabled={!!isLocked}
                  className="w-full md:w-auto md:max-w-[7rem] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              </div>

              <div className="md:flex-none">
                <label className="block text-sm font-medium text-gray-700 mb-2 leading-tight">
                  <span className="block">Results per</span>
                  <span className="block">page</span>
                </label>
                <select
                  value={globalPageSize}
                  onChange={(e) => {
                    const newPageSize = parseInt(e.target.value);
                    setGlobalPageSize(newPageSize);
                    // Update all node pagination to use new page size and reset to page 1
                    setNodePagination(prev => {
                      const updated = { ...prev };
                      Object.keys(updated).forEach(nodeId => {
                        updated[nodeId] = {
                          ...updated[nodeId],
                          pageSize: newPageSize,
                          currentPage: 1
                        };
                      });
                      return updated;
                    });
                    // Trigger search for all visible nodes with new page size
                    setTimeout(() => {
                      if (results && ((results as any).state === 'successful') && (results as any).data) {
                        Object.keys(results.data).forEach(nodeName => {
                          // Find the corresponding node ID from nodeName
                          let node = selectedNodes.find(n => n.id === nodeName);
                          if (!node) {
                            node = selectedNodes.find(n => n.name === nodeName);
                          }
                          if (!node) {
                            const nodeIndex = Object.keys(results.data!).indexOf(nodeName);
                            node = selectedNodes[nodeIndex];
                          }
                          if (node) {
                            handleSingleNodeSearch(node.id);
                          }
                        });
                      }
                    }, 100);
                  }}
                  className="w-full md:w-auto md:max-w-[7rem] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            {/* Options */}
            <div className="flex space-x-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={regex}
                  onChange={(e) => setRegex(e.target.checked)}
                  className="mr-2"
                  disabled={!!isLocked}
                />
                <span className="text-sm text-gray-700">Use Regular Expression</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                  className="mr-2"
                  disabled={!!isLocked}
                />
                <span className="text-sm text-gray-700">Case Sensitive</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={showMetadata}
                  onChange={(e) => setShowMetadata(e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700">Show Metadata</span>
              </label>
            </div>
          </div>
        </div>

        {/* Action Buttons (view mode toggle now in results section) */}
        <div className="flex flex-wrap gap-3 items-center">
          <button
            onClick={() => handleSearch(true)}
              disabled={
              selectedNodes.length === 0 || 
              isSearching || 
              !currentWorkspaceId ||
              !searchWord.trim() ||
              nodeColumnSelections.some(sel => !sel.column) ||
              !!isLocked
            }
            className="w-full md:w-auto px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {isSearching ? 'Searching...' : 'Search'}
          </button>

          {results && (
            <button
              onClick={handleClearResults}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
            >
              Clear Results
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {results && (
        <div ref={resultsRef} className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          {((results as any)?.state === 'successful') ? (
            <div>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Search Results</h3>
                <SegmentedControl
                  options={(() => {
                    const base: Array<{ value: 'separated' | 'combined'; label: string }> = [
                      { value: 'separated', label: 'Separated' },
                    ];
                    if (results?.combinable) {
                      base.push({ value: 'combined', label: 'Combined' });
                    }
                    return base;
                  })()}
                  value={viewMode}
                  onChange={(val) => {
                    if (val !== viewMode) {
                      const mode = val as 'separated'|'combined';
                      const anchorEl = resultsRef.current;
                      const prevTop = anchorEl ? anchorEl.getBoundingClientRect().top : 0;
                      const prevScrollY = window.scrollY;
                      setViewMode(mode);
                      setCombinedPage(1);
                      // Lock current height to reduce layout shift during async fetch
                      if (anchorEl) {
                        const h = anchorEl.getBoundingClientRect().height;
                        anchorEl.style.minHeight = h + 'px';
                      }
                      Promise.resolve(handleSearch(true, undefined, mode, undefined, undefined, true)).finally(() => {
                        // After results update and paint, compensate scroll so anchor stays put
                        requestAnimationFrame(() => {
                          requestAnimationFrame(() => {
                            const newAnchor = resultsRef.current;
                            if (newAnchor) {
                              const newTop = newAnchor.getBoundingClientRect().top;
                              const delta = newTop - prevTop;
                              if (Math.abs(delta) > 1) {
                                window.scrollTo({ top: prevScrollY + delta });
                              }
                              // Remove temporary minHeight lock
                              newAnchor.style.minHeight = '';
                            } else {
                              // Fallback to original position
                              window.scrollTo({ top: prevScrollY });
                            }
                          });
                        });
                      });
                    }
                  }}
                  ariaLabel="Concordance view mode"
                />
              </div>
              <div className="text-sm text-gray-600 mb-6">{results.message}</div>
              
              {results.data && Object.keys(results.data).length > 0 ? (
                <div className={`grid gap-6 ${viewMode==='combined' ? 'grid-cols-1' : 'grid-cols-1'}`}>
                  {Object.entries(results.data).filter(([k]) => viewMode==='combined' ? k==='__COMBINED__' : k !== '__COMBINED__').map(([nodeName, nodeData]) => {
                    // Find the corresponding node and column for detail view
                    // Try multiple ways to match the node
                    if (localStorage.getItem('debugConc') === '1') console.log('Trying to match nodeName:', nodeName);
                    if (localStorage.getItem('debugConc') === '1') console.log('Available nodes:', selectedNodes.map(n => ({ id: n.id, name: n.data?.name, nodeName: n.name })));
                    
                    const nodesForDetail = selectedNodes;
                    let node = nodesForDetail.find((n: any) => (n.data?.name || n.id) === nodeName);
                    if (!node) {
                      // Try matching by just the ID
                      node = nodesForDetail.find((n: any) => n.id === nodeName);
                    }
                    if (!node) {
                      // Try matching by node.name property (if it exists)
                      node = nodesForDetail.find((n: any) => n.name === nodeName);
                    }
                    if (!node) {
                      // Fallback: just use the first available node for this nodeName
                      // This is needed because the backend might be returning a different format
                      const nodeIndex = Object.keys(results.data).indexOf(nodeName);
                      node = (nodesForDetail as any)[nodeIndex];
                    }
                    
                    const nodeId = node?.id || '';
                    const selection = nodeColumnSelections.find(sel => sel.nodeId === nodeId);
                    const column = selection?.column || '';
                    
                    if (localStorage.getItem('debugConc') === '1') console.log('Final match - nodeId:', nodeId, 'column:', column);
                    
                    return renderConcordanceTable(nodeName, nodeData, nodeId, column);
                  })}
                </div>
              ) : (
                <div className="text-gray-500">No data available</div>
              )}
            </div>
          ) : (
            <div className="text-red-600">
              <h3 className="text-lg font-semibold mb-2">Error</h3>
              <p>{results.message}</p>
            </div>
          )}
        </div>
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
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-medium text-gray-900">Concordance Detail</h3>
              <button
                onClick={() => setShowDetailModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
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
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Field</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
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
                            <tr key={key} className="hover:bg-gray-50">
                              <td className="px-4 py-2 text-sm font-medium text-gray-900">{key}</td>
                              <td className="px-4 py-2 text-sm text-gray-700">
                                <div className="max-w-md break-words">
                                  {typeof value === 'object' && value !== null ? (
                                    <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                                      {displayValue}
                                    </pre>
                                  ) : (
                                    displayValue
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
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
