import React, { useState, useEffect, useMemo } from 'react';
import { useWorkspace } from '../hooks/useWorkspace';
import { useAuth } from '../hooks/useAuth';
import { ConcordanceRequest, getConcordanceDetail } from '../api';

const ConcordanceTab: React.FC = () => {
  const { 
    selectedNodeId, 
    selectedNode,
    nodeData,
    concordanceSearch,
    isLoading,
    currentWorkspaceId
  } = useWorkspace();

  const { getAuthHeaders } = useAuth();

  const [column, setColumn] = useState('');
  const [searchWord, setSearchWord] = useState('');
  const [numLeftTokens, setNumLeftTokens] = useState(10);
  const [numRightTokens, setNumRightTokens] = useState(10);
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<any>(null);
  
  // Pagination and sorting state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  
  // Detail view state
  const [selectedDetail, setSelectedDetail] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Get available columns from node data (which includes actual column names) - memoized to prevent useEffect dependency issues
  const availableColumns = useMemo(() => {
    // First try to get columns from nodeData (which includes actual column names)
    if (nodeData?.columns && Array.isArray(nodeData.columns)) {
      return nodeData.columns;
    }
    // Fallback to dtypes keys if available
    if (nodeData?.dtypes && typeof nodeData.dtypes === 'object') {
      return Object.keys(nodeData.dtypes);
    }
    // Last fallback to schema if available
    if (selectedNode?.data?.schema) {
      return Object.keys(selectedNode.data.schema);
    }
    return [];
  }, [nodeData?.columns, nodeData?.dtypes, selectedNode?.data?.schema]);

  // Auto-select first text-like column
  useEffect(() => {
    if (availableColumns.length > 0 && !column) {
      // Try to find a column that might contain text
      const textColumn = availableColumns.find((col: string) => 
        col.toLowerCase().includes('text') || 
        col.toLowerCase().includes('content') || 
        col.toLowerCase().includes('message') ||
        col.toLowerCase().includes('document')
      );
      setColumn(textColumn || availableColumns[0]);
    }
  }, [availableColumns, column]);

  const handleSearch = async (resetPage = true) => {
    if (!selectedNodeId) {
      alert('Please select a node first');
      return;
    }

    if (!column || !searchWord.trim()) {
      alert('Please select a column and enter a search word');
      return;
    }

    const page = resetPage ? 1 : currentPage;
    if (resetPage) {
      setCurrentPage(1);
    }

    const request: ConcordanceRequest = {
      column,
      search_word: searchWord.trim(),
      num_left_tokens: numLeftTokens,
      num_right_tokens: numRightTokens,
      regex,
      case_sensitive: caseSensitive,
      page,
      page_size: pageSize,
      sort_by: sortBy || undefined,
      sort_order: sortOrder
    };

    try {
      setIsSearching(true);
      const result = await concordanceSearch(selectedNodeId, request);
      setResults(result);
    } catch (error) {
      console.error('Concordance search error:', error);
      alert(`Error performing concordance search: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClearResults = () => {
    setResults(null);
    setCurrentPage(1);
    setSortBy('');
    setSortOrder('asc');
  };

  const handleSort = (columnName: string) => {
    if (sortBy === columnName) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(columnName);
      setSortOrder('asc');
    }
    // Trigger search with current page
    setTimeout(() => handleSearch(false), 0);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    // Trigger search with new page
    setTimeout(() => handleSearch(false), 0);
  };

  const handleRowClick = async (row: any) => {
    if (!selectedNodeId || !currentWorkspaceId || row.document_idx === undefined) return;
    
    setLoadingDetail(true);
    try {
      const authHeaders = getAuthHeaders();
      const headers = Object.keys(authHeaders).length > 0 ? authHeaders as Record<string, string> : {};
      const detail = await getConcordanceDetail(currentWorkspaceId, selectedNodeId, row.document_idx, column, headers);
      setSelectedDetail({ ...row, ...detail });
      setShowDetailModal(true);
    } catch (error) {
      console.error('Error fetching concordance detail:', error);
      alert('Error loading detail view');
    } finally {
      setLoadingDetail(false);
    }
  };

  const SortableHeader: React.FC<{ columnKey: string; label: string }> = ({ columnKey, label }) => {
    const isSorted = sortBy === columnKey;
    const sortIcon = isSorted ? (sortOrder === 'asc' ? '▲' : '▼') : '▲▼';
    
    return (
      <th 
        className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
        onClick={() => handleSort(columnKey)}
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

  if (!selectedNodeId) {
    return (
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="text-lg font-medium text-blue-800 mb-2">Concordance Search</h3>
        <p className="text-blue-700">
          Please select a node from the graph to perform concordance analysis.
        </p>
      </div>
    );
  }

  if (availableColumns.length === 0) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <h3 className="text-lg font-medium text-yellow-800 mb-2">Concordance Search</h3>
        <p className="text-yellow-700">
          Loading node schema... Please wait.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Concordance Search</h3>
      
      {/* Selected Node Info */}
      <div className="bg-gray-50 p-3 rounded-lg">
        <p className="text-sm text-gray-600">
          <strong>Selected Node:</strong> {selectedNode?.data?.name || selectedNodeId}
        </p>
        <p className="text-sm text-gray-600">
          <strong>Available Columns:</strong> {availableColumns.join(', ')}
        </p>
      </div>

      {/* Search Configuration */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Column Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Text Column
            </label>
            <select
              value={column}
              onChange={(e) => setColumn(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">Select Column</option>
              {availableColumns.map((col: string) => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </div>

          {/* Search Word */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Search Word/Phrase
            </label>
            <input
              type="text"
              value={searchWord}
              onChange={(e) => setSearchWord(e.target.value)}
              placeholder="Enter word or phrase to search for"
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Context Window */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Left Context (tokens)
            </label>
            <input
              type="number"
              value={numLeftTokens}
              onChange={(e) => setNumLeftTokens(parseInt(e.target.value) || 10)}
              min="1"
              max="50"
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Right Context (tokens)
            </label>
            <input
              type="number"
              value={numRightTokens}
              onChange={(e) => setNumRightTokens(parseInt(e.target.value) || 10)}
              min="1"
              max="50"
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
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
          disabled={isSearching || isLoading.operations}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
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

      {/* Results Display */}
      {results && (
        <div className="mt-6">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-lg font-medium text-gray-900">Search Results</h4>
            {results.pagination && (
              <div className="text-sm text-gray-600">
                Page {results.pagination.current_page} of {results.pagination.total_pages} 
                ({results.pagination.total_matches} total matches)
              </div>
            )}
          </div>
          
          {/* Page Size Selector */}
          <div className="mb-3 flex items-center space-x-2">
            <span className="text-sm text-gray-600">Results per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(parseInt(e.target.value));
                setCurrentPage(1);
                setTimeout(() => handleSearch(false), 0);
              }}
              className="px-2 py-1 border border-gray-300 rounded text-sm"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              {Array.isArray(results.data) && results.data.length > 0 ? (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      {Object.keys(results.data[0]).map(key => {
                        // Make L1, R1, L1_FREQ, R1_FREQ, document_idx sortable
                        const sortableColumns = ['l1', 'r1', 'l1_freq', 'r1_freq', 'document_idx'];
                        const isSortable = sortableColumns.includes(key.toLowerCase());
                        
                        return isSortable ? (
                          <SortableHeader key={key} columnKey={key} label={key} />
                        ) : (
                          <th key={key} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            {key}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {results.data.map((row: any, index: number) => (
                      <tr 
                        key={index} 
                        className={`cursor-pointer hover:bg-blue-50 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                        onClick={() => handleRowClick(row)}
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
              ) : (
                <div className="p-4 text-center text-gray-500">
                  No results found for "{searchWord}"
                </div>
              )}
            </div>
          </div>

          {/* Pagination Controls */}
          {results.pagination && results.pagination.total_pages > 1 && (
            <div className="mt-4 flex justify-center items-center space-x-2">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={!results.pagination.has_prev}
                className="px-3 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 disabled:text-gray-400 hover:bg-gray-50"
              >
                Previous
              </button>
              
              <div className="flex space-x-1">
                {Array.from({ length: Math.min(5, results.pagination.total_pages) }, (_, i) => {
                  const pageNum = Math.max(1, currentPage - 2) + i;
                  if (pageNum > results.pagination.total_pages) return null;
                  
                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      className={`px-3 py-1 border border-gray-300 rounded text-sm ${
                        pageNum === currentPage 
                          ? 'bg-blue-600 text-white border-blue-600' 
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={!results.pagination.has_next}
                className="px-3 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 disabled:text-gray-400 hover:bg-gray-50"
              >
                Next
              </button>
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
                <h4 className="font-medium text-gray-700 mb-2">Full Text from Column: {column}</h4>
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
                        if (key === column) {
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConcordanceTab;
