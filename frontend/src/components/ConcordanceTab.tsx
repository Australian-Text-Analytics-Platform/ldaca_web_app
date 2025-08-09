import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWorkspace } from '../hooks/useWorkspace';
import { useAuth } from '../hooks/useAuth';
import { 
  MultiNodeConcordanceRequest, 
  MultiNodeConcordanceResponse, 
  multiNodeConcordanceSearch,
  getConcordanceDetail 
} from '../api';

interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

const ConcordanceTab: React.FC = () => {
  const { 
    selectedNodes,
    isLoading,
    currentWorkspaceId,
    detachConcordance
  } = useWorkspace();

  const { getAuthHeaders } = useAuth();

  const [nodeColumnSelections, setNodeColumnSelections] = useState<NodeColumnSelection[]>([]);
  const [searchWord, setSearchWord] = useState('');
  const [numLeftTokens, setNumLeftTokens] = useState(10);
  const [numRightTokens, setNumRightTokens] = useState(10);
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<MultiNodeConcordanceResponse | null>(null);
  
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
      console.log('Concordance results updated:', results);
      console.log('Results success:', results.success);
      console.log('Results data:', results.data);
      if (results.data) {
        console.log('Data entries:', Object.entries(results.data));
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
    if (changed) {
      // Only clear if selection truly changed; keep tables if selection is stable
      setResults(null);
    }
    prevSelectedNodeIdsRef.current = curr;
  }, [selectedNodeIds]);

  // Check for pending concordance search from TokenFrequencyTab
  useEffect(() => {
    const pendingSearch = localStorage.getItem('pendingConcordanceSearch');
    if (pendingSearch) {
      try {
        const params = JSON.parse(pendingSearch);
        console.log('Found pending concordance search:', params);
        
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
        
        // Clear the pending search
        localStorage.removeItem('pendingConcordanceSearch');
        
        // Auto-trigger search after a brief delay to ensure state is set
        setTimeout(() => {
          if (params.searchWord && selectedNodes.length > 0) {
            console.log('Auto-triggering concordance search for:', params.searchWord);
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
        
        // Auto-select document column if available, otherwise first column
        const columns = getNodeColumns(node);
        const defaultColumn = columns.find((col: string) => 
          col.toLowerCase().includes('document') || 
          col.toLowerCase().includes('text') ||
          col.toLowerCase().includes('content') ||
          col.toLowerCase().includes('message')
        ) || columns[0] || '';
        
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

  const handleColumnChange = (nodeId: string, column: string) => {
    setNodeColumnSelections(prev => 
      prev.map(sel => 
        sel.nodeId === nodeId ? { ...sel, column } : sel
      )
    );
  };

  const handleSearch = useCallback(async (resetPage = true, targetNodeId?: string) => {
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

      const request: MultiNodeConcordanceRequest = {
        node_ids: selectedNodes.slice(0, 2).map(node => node.id), // Limit to 2 nodes
        node_columns: nodeColumns,
        search_word: searchWord.trim(),
        num_left_tokens: numLeftTokens,
        num_right_tokens: numRightTokens,
        regex: regex,
        case_sensitive: caseSensitive,
        page: firstNodePagination.currentPage,
        page_size: firstNodePagination.pageSize,
        sort_by: firstNodePagination.sortBy || undefined,
        sort_order: firstNodePagination.sortOrder
      };

      const response = await multiNodeConcordanceSearch(
        currentWorkspaceId,
        request,
        getAuthHeaders()
      );

      console.log('Multi-Node Concordance Response:', response);
      setResults(response);
    } catch (error) {
      console.error('Error performing concordance search:', error);
      setResults({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        data: {}
      });
    } finally {
      setIsSearching(false);
    }
  }, [currentWorkspaceId, selectedNodes, searchWord, nodeColumnSelections, nodePagination, globalPageSize, numLeftTokens, numRightTokens, regex, caseSensitive, getAuthHeaders]);

  // Effect to handle auto-search trigger from TokenFrequencyTab
  useEffect(() => {
    if (shouldAutoSearch && searchWord.trim() && selectedNodes.length > 0) {
      console.log('Executing auto-search for:', searchWord);
      handleSearch(true);
      setShouldAutoSearch(false); // Reset the flag
    }
  }, [shouldAutoSearch, searchWord, selectedNodes, handleSearch]);

  const handleClearResults = () => {
    setResults(null);
    setNodePagination({});
  };

  const handleSort = (columnName: string, nodeId: string) => {
    setNodePagination(prev => {
      const currentNodePagination = prev[nodeId] || {
        currentPage: 1,
        pageSize: globalPageSize,
        sortBy: '',
        sortOrder: 'asc' as 'asc' | 'desc'
      };

      const newSortOrder = currentNodePagination.sortBy === columnName ? 
        (currentNodePagination.sortOrder === 'asc' ? 'desc' : 'asc') : 'asc';

      return {
        ...prev,
        [nodeId]: {
          ...currentNodePagination,
          sortBy: columnName,
          sortOrder: newSortOrder
        }
      };
    });
    
    // For sorting, we'll search only this specific node
    setTimeout(() => handleSingleNodeSearch(nodeId), 0);
  };

  const handlePageChange = (newPage: number, nodeId: string) => {
    setNodePagination(prev => {
      const currentNodePagination = prev[nodeId] || {
        currentPage: 1,
        pageSize: globalPageSize,
        sortBy: '',
        sortOrder: 'asc' as 'asc' | 'desc'
      };

      return {
        ...prev,
        [nodeId]: {
          ...currentNodePagination,
          currentPage: newPage
        }
      };
    });
    
    // For pagination, we'll search only this specific node with the new page number
    handleSingleNodeSearch(nodeId, newPage);
  };

  // New function to search a single node (for pagination and sorting)
  const handleSingleNodeSearch = async (nodeId: string, overridePage?: number) => {
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
        sort_by: nodeState.sortBy || undefined,
        sort_order: nodeState.sortOrder
      };

      // Import the single-node concordance search function
      const { concordanceSearch } = await import('../api');
      const response = await concordanceSearch(
        currentWorkspaceId,
        nodeId,
        request,
        getAuthHeaders()
      );

      console.log('Single Node Concordance Response:', response);

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
        
        console.log('Updating existing key:', existingKey, 'for nodeId:', nodeId);
        
        if (existingKey) {
          const updatedResults = {
            ...results,
            data: {
              ...results.data,
              [existingKey]: {
                data: response.data || [],
                columns: response.columns || [],
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
      const detail = await getConcordanceDetail(currentWorkspaceId, nodeId, row.document_idx, column, headers);
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

    const node = selectedNodes.find(n => n.id === nodeId);
    if (!node) {
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

  const renderConcordanceTable = (nodeName: string, nodeData: any, nodeId: string, column: string) => {
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
                  {Object.keys(nodeData.data[0]).map(key => {
                    // Make L1, R1, L1_FREQ, R1_FREQ, document_idx sortable
                    const sortableColumns = ['l1', 'r1', 'l1_freq', 'r1_freq', 'document_idx'];
                    const isSortable = sortableColumns.includes(key.toLowerCase());
                    
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
                    {Object.values(row).map((value: any, cellIndex) => (
                      <td key={cellIndex} className="px-4 py-2 text-sm text-gray-900">
                        {value !== null && value !== undefined ? String(value) : ''}
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
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Concordance Search</h2>
        
        {/* Node Selection Status */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Selected Nodes ({selectedNodes.length}/2)
          </label>
          
          {selectedNodes.length === 0 ? (
            <div className="text-sm text-gray-500 italic bg-gray-50 p-3 rounded-md">
              No nodes selected. Click on nodes in the workspace view to select them (max 2 for comparison).
              Hold Cmd/Ctrl to select multiple nodes.
            </div>
          ) : (
            <>
            {/* Horizontal list; enable horizontal scroll only when >2 nodes */}
            <div className={`flex space-x-3 pb-2 ${selectedNodes.length > 2 ? 'overflow-x-auto' : 'overflow-x-hidden'}`}>
              {selectedNodes.map((node: any) => {
                const columns = getNodeColumns(node);
                const selection = nodeColumnSelections.find(sel => sel.nodeId === node.id);
                const nodeDisplayName = node.name || node.data?.name || (node as any).label || node.data?.label || node.id;
                return (
                  <div
                    key={node.id}
                    className={`bg-gray-50 p-3 rounded-md ${selectedNodes.length > 2 ? 'flex-none min-w-[50%]' : 'flex-1 min-w-0'}`}
                  >
                    <div className="mb-2">
                      <div className="font-medium text-gray-800 break-words">
                        {nodeDisplayName}
                      </div>
                      <div className="text-xs text-gray-500 break-all">{node.id}</div>
                    </div>
                    
                    {columns.length > 0 ? (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Text Column:
                        </label>
                        <select
                          value={selection?.column || ''}
                          onChange={(e) => handleColumnChange(node.id, e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">Select a column...</option>
                          {columns.map((column: string) => (
                            <option key={column} value={column}>
                              {column}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="text-xs text-red-500">
                        No columns available for this node
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </>
          )}
          
          {selectedNodes.length > 2 && (
            <div className="text-sm text-orange-600 mt-2">
              ⚠️ Only the first 2 selected nodes will be used for comparison.
            </div>
          )}
        </div>

        {/* Search Configuration */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search Word/Phrase
            </label>
            <input
              type="text"
              value={searchWord}
              onChange={(e) => setSearchWord(e.target.value)}
              placeholder="Enter word or phrase to search for"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                  if (results && results.success && results.data) {
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
              className="w-full md:w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
              />
              <span className="text-sm text-gray-700">Use Regular Expression</span>
            </label>

            <label className="flex items-center">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                className="mr-2"
              />
              <span className="text-sm text-gray-700">Case Sensitive</span>
            </label>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-2">
          <button
            onClick={() => handleSearch(true)}
            disabled={
              selectedNodes.length === 0 || 
              isSearching || 
              !currentWorkspaceId ||
              !searchWord.trim() ||
              nodeColumnSelections.some(sel => !sel.column)
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
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          {results.success ? (
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Search Results</h3>
              <div className="text-sm text-gray-600 mb-6">{results.message}</div>
              
              {results.data && Object.keys(results.data).length > 0 ? (
                <div className={`grid gap-6 ${Object.keys(results.data).length === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
                  {Object.entries(results.data).map(([nodeName, nodeData]) => {
                    // Find the corresponding node and column for detail view
                    // Try multiple ways to match the node
                    console.log('Trying to match nodeName:', nodeName);
                    console.log('Available nodes:', selectedNodes.map(n => ({ id: n.id, name: n.data?.name, nodeName: n.name })));
                    
                    let node = selectedNodes.find(n => (n.data?.name || n.id) === nodeName);
                    if (!node) {
                      // Try matching by just the ID
                      node = selectedNodes.find(n => n.id === nodeName);
                    }
                    if (!node) {
                      // Try matching by node.name property (if it exists)
                      node = selectedNodes.find(n => n.name === nodeName);
                    }
                    if (!node) {
                      // Fallback: just use the first available node for this nodeName
                      // This is needed because the backend might be returning a different format
                      const nodeIndex = Object.keys(results.data).indexOf(nodeName);
                      node = selectedNodes[nodeIndex];
                    }
                    
                    const nodeId = node?.id || '';
                    const selection = nodeColumnSelections.find(sel => sel.nodeId === nodeId);
                    const column = selection?.column || '';
                    
                    console.log('Final match - nodeId:', nodeId, 'column:', column);
                    
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
