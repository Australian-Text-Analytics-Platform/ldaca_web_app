import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import NodeSelectionPanel from '../NodeSelectionPanel';
import SegmentedControl from '../ui/SegmentedControl';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useAuth } from '../../hooks/useAuth';
import { MultiNodeConcordanceRequest, MultiNodeConcordanceResponse, textApi } from '../../api/text';
import { nodesApi } from '../../api/nodes';
import { workspacesApi } from '../../api/workspaces';

interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

const ConcordanceTab: React.FC = () => {
  // Anchor ref for results container to stabilize scroll on view mode toggle
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const { 
    selectedNodes,
    isLoading,
    currentWorkspaceId,
  detachConcordance,
  getNodeShape
  } = useWorkspace();

  const { getAuthHeaders } = useAuth();

  const [nodeColumnSelections, setNodeColumnSelections] = useState<NodeColumnSelection[]>([]);
  const [lockedNodeSelections, setLockedNodeSelections] = useState<NodeColumnSelection[] | null>(null);
  const [searchWord, setSearchWord] = useState('');
  const [numLeftTokens, setNumLeftTokens] = useState(10);
  const [numRightTokens, setNumRightTokens] = useState(10);
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<MultiNodeConcordanceResponse | null>(null);
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
  
  const [isLocked, setIsLocked] = useState(false);
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
  const [loadingDetail, setLoadingDetail] = useState(false);
  
  // State for auto-triggering search from TokenFrequencyTab
  const [shouldAutoSearch, setShouldAutoSearch] = useState(false);

  // Debug results changes
  useEffect(() => {
      if (results) {
      if (localStorage.getItem('debugConc') === '1') {
        console.log('Concordance results updated:', results);
  console.log('Results state:', (results as any)?.state || (results as any)?.status);
        console.log('Results data:', (results as any)?.data);
      }
      if ((results as any)?.data) {
  if (localStorage.getItem('debugConc') === '1') console.log('Data entries:', Object.entries(results.data));
      }
    }
  }, [results]);

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

  // Check for pending concordance search from TokenFrequencyTab
  useEffect(() => {
    const pendingSearch = localStorage.getItem('pendingConcordanceSearch');
    if (pendingSearch) {
      try {
        const params = JSON.parse(pendingSearch);
  if (localStorage.getItem('debugConc') === '1') console.log('Found pending concordance search:', params);
        
        // Set the search word
        setSearchWord(params.searchWord);
        
        // Set node column selections if they match current selected nodes
        if (params.nodeColumnSelections && params.selectedNodes) {
          const matchingSelections = params.nodeColumnSelections.filter((sel: any) =>
            selectedNodes.some((node: any) => node.id === sel.nodeId)
          );
          if (matchingSelections.length > 0) {
            setNodeColumnSelections(matchingSelections);
          }
        }

        if (params.nodeColors) {
          setNodeColors((prev) => ({ ...params.nodeColors, ...prev }));
        }
        
        // Clear the pending search
        localStorage.removeItem('pendingConcordanceSearch');
        
        // Auto-trigger search after a brief delay to ensure state is set
        setTimeout(() => {
          if (params.searchWord && selectedNodes.length > 0) {
            if (localStorage.getItem('debugConc') === '1') console.log('Auto-triggering concordance search for:', params.searchWord);
            // Trigger auto search
            setShouldAutoSearch(true);
          }
        }, 500);
        
      } catch (error) {
        console.error('Error parsing pending concordance search:', error);
        localStorage.removeItem('pendingConcordanceSearch');
      }
    }
  }, [selectedNodes]); // Re-run when selectedNodes changes

  // Memoize the getNodeColumns function to prevent re-renders
  const getNodeColumns = useMemo(() => {
    return (node: any) => {
      // Get available columns from node data
      if (node.data?.columns && Array.isArray(node.data.columns)) {
        return node.data.columns;
      }
      // Also check if columns are directly on the node object (for locked snapshots)
      if (node.columns && Array.isArray(node.columns)) {
        return node.columns;
      }
      if (node.data?.dtypes && typeof node.data.dtypes === 'object') {
        return Object.keys(node.data.dtypes);
      }
      if (node.data?.schema) {
        return Object.keys(node.data.schema);
      }
      return [];
    };
  }, []);

  // Update node column selections when selected nodes change
  useEffect(() => {
    if (isLocked) return;
    if (selectedNodes.length === 0) {
      setNodeColumnSelections([]);
      return;
    }

    // Keep existing selections for nodes that are still selected, add new ones for new nodes
    setNodeColumnSelections(prev => {
      const newSelections = selectedNodes.map(node => {
        const existing = prev.find(sel => sel.nodeId === node.id);
        if (existing) {
          return existing;
        }
        
        // Only auto-select for DocType nodes (with explicit documentColumn). No guessing for non DocTypes.
        const columns = getNodeColumns(node);
        let defaultColumn = '';
        const isDocType = !!(node.data?.nodeType && node.data.nodeType.includes('Doc'));
        const documentColumn = node.data?.documentColumn;
        if (isDocType && documentColumn && columns.includes(documentColumn)) {
          defaultColumn = documentColumn;
        }
        
        return {
          nodeId: node.id,
          column: defaultColumn
        };
      });

      // Only update if the selections actually changed
      if (JSON.stringify(newSelections) === JSON.stringify(prev)) {
        return prev;
      }
      return newSelections;
    });
  }, [selectedNodeIds, selectedNodes, getNodeColumns]); // Include all dependencies

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

  const handleColumnChange = (nodeId: string, column: string) => {
    setNodeColumnSelections(prev => 
      prev.map(sel => 
        sel.nodeId === nodeId ? { ...sel, column } : sel
      )
    );
  };

  const handleSearch = useCallback(async (
    resetPage = true,
    targetNodeId?: string,
    forceMode?: 'separated'|'combined',
    overrideSortBy?: string,
    overrideSortOrder?: 'asc'|'desc'
  ) => {
    if (isLocked) return;
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

    setIsSearching(true);
    try {
      // Create node_columns mapping
      const nodeColumns: Record<string, string> = {};
      nodeColumnSelections.forEach(sel => {
        nodeColumns[sel.nodeId] = sel.column;
      });

      // Use the first node's pagination settings for the API call
      // Note: This is a limitation of the current backend API that we'll work around
      const firstNodeId = selectedNodes[0].id;
  const firstNodePagination = updatedPagination[firstNodeId];

      const effectiveMode = forceMode || viewMode;
      const request: MultiNodeConcordanceRequest = {
        node_ids: selectedNodes.slice(0, 2).map(node => node.id), // Limit to 2 nodes
        node_columns: nodeColumns,
        search_word: searchWord.trim(),
        num_left_tokens: numLeftTokens,
        num_right_tokens: numRightTokens,
        regex: regex,
        case_sensitive: caseSensitive,
        page: effectiveMode === 'combined' ? combinedPage : firstNodePagination.currentPage,
        page_size: effectiveMode === 'combined' ? combinedPageSize : firstNodePagination.pageSize,
  sort_by: (overrideSortBy ?? firstNodePagination.sortBy) || undefined,
  sort_order: overrideSortOrder ?? firstNodePagination.sortOrder
      };
      if (effectiveMode === 'combined') request.combined = true;

  const response = await textApi.multiNodeConcordance(currentWorkspaceId, request, getAuthHeaders());

  if (localStorage.getItem('debugConc') === '1') console.log('Multi-Node Concordance Response:', response);
      setResults(response);
      setLastCompareNodeIds(selectedNodes.slice(0, 2).map(n => n.id));
      // Lock UI and snapshot nodes
      try {
        const ids = selectedNodes.slice(0,2).map(n=>n.id);
        const snaps: Array<{ id: string; name: string; columns: string[] }> = [];
        for (const id of ids) {
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
  }, [currentWorkspaceId, selectedNodes, searchWord, nodeColumnSelections, nodePagination, globalPageSize, numLeftTokens, numRightTokens, regex, caseSensitive, showMetadata, getAuthHeaders, viewMode, combinedPage, combinedPageSize]);

  // Hydrate from backend current-request/result once per mount
  const hydratedOnceRef = useRef<boolean>(false);
  useEffect(() => {
    (async () => {
      if (hydratedOnceRef.current) return;
      hydratedOnceRef.current = true;
      if (!currentWorkspaceId) return;
      try {
        // First check current-request; if null, don't request current-result
        const reqResp = await textApi.getMultiNodeConcordanceCurrentRequest(currentWorkspaceId, getAuthHeaders());
        if (!reqResp) {
          // No current request - fresh state
          return;
        }
        
        const req = (reqResp as any)?.data;
        if (req) {
          const nodeIds: string[] = Array.isArray(req.node_ids) ? req.node_ids.slice(0,2) : [];
          const node_columns: Record<string,string> = req.node_columns || {};
          const sels = nodeIds.map((id: string) => ({ nodeId: id, column: node_columns[id] || '' }));
          setNodeColumnSelections(sels);
          setLockedNodeSelections(sels);
          setSearchWord(String(req.search_word || ''));
          setNumLeftTokens(Number(req.num_left_tokens ?? 10));
          setNumRightTokens(Number(req.num_right_tokens ?? 10));
          setRegex(!!req.regex);
          setCaseSensitive(!!req.case_sensitive);
          setViewMode(req.combined ? 'combined' : 'separated');
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
        
        // Now get current-result
        const resResp = await textApi.getMultiNodeConcordanceCurrentResult(currentWorkspaceId, getAuthHeaders());
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
        await textApi.clearMultiNodeConcordance(currentWorkspaceId, getAuthHeaders());
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
        const resp: any = await textApi.postMultiNodeConcordanceCurrentResult(currentWorkspaceId, { combined: true, page: combinedPage, page_size: combinedPageSize }, getAuthHeaders());
        if (resp?.data) setResults(resp);
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
        const resp: any = await textApi.postMultiNodeConcordanceCurrentResult(currentWorkspaceId, overrides, getAuthHeaders());
        if (resp?.data) setResults(resp);
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
        const resp: any = await textApi.postMultiNodeConcordanceCurrentResult(currentWorkspaceId, overrides, getAuthHeaders());
        if (resp?.data) setResults(resp);
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
      // Use the single-node concordance API
      const request: any = {
        column: selection.column,
        search_word: searchWord.trim(),
        num_left_tokens: numLeftTokens,
        num_right_tokens: numRightTokens,
        regex: regex,
        case_sensitive: caseSensitive,
        page: currentPage,
        page_size: nodeState.pageSize,
  sort_by: (overrideSortBy ?? nodeState.sortBy) || undefined,
  sort_order: overrideSortOrder ?? nodeState.sortOrder
      };

      // Import the single-node concordance search function
  const response = await textApi.concordance(currentWorkspaceId, nodeId, request, getAuthHeaders());

  if (localStorage.getItem('debugConc') === '1') console.log('Single Node Concordance Response:', response);

      // Update results with this node's new data
      if (results && results.data) {
        // Find the existing key for this node in the results data
        // This ensures we update the same entry that was created by the initial multi-node search
        let existingKey: string | null = null;
        
        // Try to find the key by checking if any existing key corresponds to this nodeId
        for (const [key] of Object.entries(results.data)) {
          // Try multiple matching strategies
          if (key === nodeId || 
              key === (node.data?.name || nodeId) ||
              key === node.data?.name ||
              key === node.name) {
            existingKey = key;
            break;
          }
        }
        
        // If we still haven't found a match, use the first available key
        // This handles cases where backend returns different naming than expected
        if (!existingKey && Object.keys(results.data).length > 0) {
          const nodeIndex = selectedNodes.findIndex(n => n.id === nodeId);
          const availableKeys = Object.keys(results.data);
          if (nodeIndex >= 0 && nodeIndex < availableKeys.length) {
            existingKey = availableKeys[nodeIndex];
          } else {
            existingKey = availableKeys[0]; // fallback to first key
          }
        }
        
  if (localStorage.getItem('debugConc') === '1') console.log('Updating existing key:', existingKey, 'for nodeId:', nodeId);
        
        if (existingKey) {
          const updatedResults = {
            ...results,
            data: {
              ...results.data,
              [existingKey]: {
                data: response.data || [],
                columns: response.columns || [],
                metadata: response.metadata || {
                  concordance_columns: [],
                  metadata_columns: [],
                  all_columns: response.columns || [],
                },
                total_matches: response.total_matches || 0,
                pagination: response.pagination || {
                  page: currentPage,
                  page_size: nodeState.pageSize,
                  total_pages: 1,
                  has_next: false,
                  has_prev: false,
                },
                sorting: response.sorting || {
                  sort_by: nodeState.sortBy,
                  sort_order: nodeState.sortOrder,
                },
              }
            }
          };
          setResults(updatedResults);
        }
      }
    } catch (error) {
      console.error('Error performing single node concordance search:', error);
    } finally {
      // Clear loading for this specific node
      setNodeLoading(prev => ({ ...prev, [nodeId]: false }));
    }
  };

  const handleRowClick = async (row: any, nodeId: string, column: string) => {
    if (!currentWorkspaceId || row.document_idx === undefined) return;
    
    setLoadingDetail(true);
    try {
      const authHeaders = getAuthHeaders();
      const headers = Object.keys(authHeaders).length > 0 ? authHeaders as Record<string, string> : {};
  const detail = await textApi.concordanceDetail(currentWorkspaceId, nodeId, row.document_idx, column, headers);
      setSelectedDetail({ ...row, ...detail, nodeId, column });
      setShowDetailModal(true);
    } catch (error) {
      console.error('Error fetching concordance detail:', error);
      alert('Error loading detail view');
    } finally {
      setLoadingDetail(false);
    }
  };

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
          const resp: any = await textApi.postMultiNodeConcordanceCurrentResult(currentWorkspaceId, { combined: true, sort_by: col, sort_order: nextOrder, page: 1, page_size: combinedPageSize }, getAuthHeaders());
          if (resp?.data) setResults(resp);
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
            getNodeColumns={getNodeColumns}
            defaultPalette={defaultPalette}
            maxCompare={2}
            showShape
            getNodeShapeFn={getNodeShape}
            disabled={!!isLocked}
            showColorPicker={true}
          />
        </div>

        {/* Search Configuration */}
        <div className="mb-6">
          <div className={`space-y-4`}>
            <div>
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Left Context (tokens)
                </label>
                <input
                  type="number"
                  value={numLeftTokens}
                  onChange={(e) => setNumLeftTokens(parseInt(e.target.value) || 10)}
                  min="1"
                  max="50"
                  disabled={!!isLocked}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Right Context (tokens)
                </label>
                <input
                  type="number"
                  value={numRightTokens}
                  onChange={(e) => setNumRightTokens(parseInt(e.target.value) || 10)}
                  min="1"
                  max="50"
                  disabled={!!isLocked}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Results per page
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
                    if (results && ((results as any).state === 'successful' || (results as any).status === 'successful') && (results as any).data) {
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
                className="w-full md:w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
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
          {((results as any)?.state === 'successful') || ((results as any)?.status === 'successful') ? (
            <div>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Search Results</h3>
                <SegmentedControl
                  options={(() => {
                    const base = [{ value: 'separated', label: 'Separated' }];
                    // Gate combined option when showMetadata is on and schemas differ
                    let canCombined = true;
                    if (showMetadata && results && results.data) {
                      const keys = Object.keys(results.data).filter(k => k !== '__COMBINED__');
                      if (keys.length >= 2) {
                        const colsA = (results.data as any)[keys[0]]?.columns || [];
                        const colsB = (results.data as any)[keys[1]]?.columns || [];
                        canCombined = JSON.stringify(colsA) === JSON.stringify(colsB);
                      }
                    }
                    if (canCombined) base.push({ value: 'combined', label: 'Combined' } as const);
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
                      Promise.resolve(handleSearch(true, undefined, mode)).finally(() => {
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
              {loadingDetail ? (
                <div className="text-center py-12">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <p className="text-gray-600 mt-2">Loading detail...</p>
                </div>
              ) : (
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
                        {selectedDetail.full_text || selectedDetail.text || 'Text not available'}
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
                            // Skip the text column since it's already displayed above
                            if (key === selectedDetail.column) {
                              return null;
                            }
                            
                            // Format the value properly
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
              )}
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
