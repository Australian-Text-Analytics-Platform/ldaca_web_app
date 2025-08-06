import React, { useState, useEffect, useMemo } from 'react';
import { useWorkspace } from '../hooks/useWorkspace';
import { useAuth } from '../hooks/useAuth';
import { 
  TokenFrequencyRequest, 
  TokenFrequencyResponse, 
  calculateTokenFrequencies,
  getDefaultStopWords
} from '../api';
import { Wordcloud } from '@visx/wordcloud';
import { Text } from '@visx/text';

interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

const TokenFrequencyTab: React.FC = () => {
  const { 
    selectedNodes,
    isLoading,
    currentWorkspaceId
  } = useWorkspace();

  const { getAuthHeaders } = useAuth();

  const [nodeColumnSelections, setNodeColumnSelections] = useState<NodeColumnSelection[]>([]);
  const [stopWords, setStopWords] = useState<string>('');
  const [limit, setLimit] = useState<number>(20);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingStopWords, setIsLoadingStopWords] = useState(false);
  const [results, setResults] = useState<TokenFrequencyResponse | null>(null);

  // Debug results changes
  useEffect(() => {
    if (results) {
      console.log('Results updated:', results);
      console.log('Results success:', results.success);
      console.log('Results data:', results.data);
      if (results.data) {
        console.log('Data entries:', Object.entries(results.data));
      }
    }
  }, [results]);

  // Clear results when node selection changes  
  // Use a more stable dependency by checking the actual node IDs
  const selectedNodeIds = useMemo(() => selectedNodes.map(node => node.id).sort(), [selectedNodes]);
  useEffect(() => {
    setResults(null);
  }, [selectedNodeIds]);

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
          col.toLowerCase().includes('content')
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

  const handleFillDefaultStopWords = async () => {
    setIsLoadingStopWords(true);
    try {
      const response = await getDefaultStopWords(getAuthHeaders());
      if (response.success && response.data) {
        setStopWords(response.data.join(', '));
      } else {
        console.error('Failed to get default stop words:', response.message);
      }
    } catch (error) {
      console.error('Error getting default stop words:', error);
    } finally {
      setIsLoadingStopWords(false);
    }
  };

  const handleAnalyze = async () => {
    if (!currentWorkspaceId || selectedNodes.length === 0) {
      return;
    }

    // Validate that all nodes have columns selected
    const incompleteSelections = nodeColumnSelections.filter(sel => !sel.column);
    if (incompleteSelections.length > 0) {
      alert('Please select a text column for all selected nodes.');
      return;
    }

    setIsAnalyzing(true);
    try {
      const stopWordsArray = stopWords.trim() ? 
        stopWords.split(',').map(word => word.trim()).filter(word => word) : 
        undefined;

      // Create node_columns mapping
      const nodeColumns: Record<string, string> = {};
      nodeColumnSelections.forEach(sel => {
        nodeColumns[sel.nodeId] = sel.column;
      });

      const request: TokenFrequencyRequest = {
        node_ids: selectedNodes.slice(0, 2).map(node => node.id), // Limit to 2 nodes
        node_columns: nodeColumns,
        stop_words: stopWordsArray,
        limit: limit
      };

      const response = await calculateTokenFrequencies(
        currentWorkspaceId,
        request,
        getAuthHeaders()
      );

      console.log('Token Frequency Response:', response);
      setResults(response);
    } catch (error) {
      console.error('Error calculating token frequencies:', error);
      setResults({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        data: null
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleTokenClick = (token: string) => {
    // Store concordance search parameters in localStorage for cross-tab communication
    const concordanceParams = {
      searchWord: token,
      nodeColumnSelections: nodeColumnSelections,
      selectedNodes: selectedNodes.map(node => ({
        id: node.id,
        name: node.data?.name || node.id
      })),
      timestamp: Date.now()
    };
    
    localStorage.setItem('pendingConcordanceSearch', JSON.stringify(concordanceParams));
    
    // Navigate to concordance tab by dispatching a custom event
    // The App component will need to listen for this event
    window.dispatchEvent(new CustomEvent('navigateToConcordance', { 
      detail: { token } 
    }));
    
    // Also show a temporary notification
    console.log(`Navigating to concordance with token: "${token}"`);
  };

  const renderWordCloud = (data: any[], width: number = 400, height: number = 200) => {
    // Transform data for word cloud format
    const words = data.map(item => ({
      text: item.token,
      value: item.frequency
    }));

    const fontScale = (datum: any) => Math.max(12, Math.min(48, datum.value / Math.max(...data.map(d => d.frequency)) * 36 + 12));
    const fontSizeSetter = (datum: any) => fontScale(datum);

    return (
      <div className="flex justify-center mb-4">
        <svg width={width} height={height}>
          <Wordcloud
            words={words}
            width={width}
            height={height}
            fontSize={fontSizeSetter}
            font="Segoe UI, Roboto, sans-serif"
            padding={2}
            spiral="archimedean"
            rotate={0}
            random={() => 0.5}
          >
            {(cloudWords) =>
              cloudWords.map((w, i) => (
                <Text
                  key={w.text}
                  fill="#3b82f6"
                  textAnchor="middle"
                  transform={`translate(${w.x}, ${w.y})`}
                  fontSize={w.size}
                  fontFamily={w.font}
                  className="cursor-pointer hover:fill-blue-800 transition-colors"
                  onClick={() => w.text && handleTokenClick(w.text)}
                  style={{ cursor: 'pointer' }}
                >
                  {w.text || ''}
                </Text>
              ))
            }
          </Wordcloud>
        </svg>
      </div>
    );
  };

  const renderChart = (nodeName: string, data: any[]) => {
    // Find max frequency for bar width calculation
    const maxFreq = Math.max(...data.map(item => item.frequency));

    return (
      <div key={nodeName} className="mb-6">
        <div className="h-16 mb-4 flex items-center">
          <h3 className="text-lg font-semibold text-gray-800 break-words leading-tight w-full">{nodeName}</h3>
        </div>
        
        {/* Word Cloud */}
        {renderWordCloud(data)}
        
        <div className="bg-white p-4 rounded-lg border">
          <div className="space-y-2">
            {data.map((item, index) => (
              <div key={index} className="flex items-center space-x-3">
                {/* Token label - now clickable */}
                <div 
                  className="w-20 text-right text-sm text-gray-700 font-medium cursor-pointer hover:bg-blue-100 hover:text-blue-700 px-2 py-1 rounded-md transition-colors"
                  onClick={() => handleTokenClick(item.token)}
                  title={`Click to search "${item.token}" in concordance`}
                >
                  {item.token}
                </div>
                
                {/* Bar container */}
                <div className="flex-1 relative">
                  <div className="h-6 bg-gray-100 rounded-full relative overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${(item.frequency / maxFreq) * 100}%`,
                        minWidth: '2px' // Ensure small bars are still visible
                      }}
                    />
                  </div>
                </div>
                
                {/* Frequency value */}
                <div className="w-16 text-left text-sm text-gray-600 font-mono">
                  {item.frequency}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Token Frequency Analysis</h2>
        
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
            <div className="space-y-3">
              {selectedNodes.map((node: any) => {
                const columns = getNodeColumns(node);
                const selection = nodeColumnSelections.find(sel => sel.nodeId === node.id);
                
                return (
                  <div key={node.id} className="bg-gray-50 p-3 rounded-md">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-700">
                        {node.data?.name || node.id}
                      </span>
                      <span className="text-xs text-gray-500">
                        {node.data?.shape && `${node.data.shape.rows} rows`}
                      </span>
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
          )}
          
          {selectedNodes.length > 2 && (
            <div className="text-sm text-orange-600 mt-2">
              ⚠️ Only the first 2 selected nodes will be used for comparison.
            </div>
          )}
        </div>

        {/* Configuration */}
        <div className="space-y-4 mb-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Stop Words (comma-separated)
              </label>
              <button
                onClick={handleFillDefaultStopWords}
                disabled={isLoadingStopWords}
                className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 transition-colors"
              >
                {isLoadingStopWords ? 'Loading...' : 'Fill Default'}
              </button>
            </div>
            <textarea
              value={stopWords}
              onChange={(e) => setStopWords(e.target.value)}
              placeholder="the, and, or, but..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
            />
            <div className="text-xs text-gray-500 mt-1">
              Optional: Enter words to exclude from analysis. Click "Fill Default" to load common English stop words.
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Token Limit
            </label>
            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value) || 20)}
              min="1"
              max="100"
              className="w-full md:w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <div className="text-xs text-gray-500 mt-1">
              Number of top tokens to display (1-100)
            </div>
          </div>
        </div>

        {/* Analyze Button */}
        <button
          onClick={handleAnalyze}
          disabled={
            selectedNodes.length === 0 || 
            isAnalyzing || 
            !currentWorkspaceId ||
            nodeColumnSelections.some(sel => !sel.column)
          }
          className="w-full md:w-auto px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {isAnalyzing ? 'Analyzing...' : 'Calculate Token Frequencies'}
        </button>
      </div>

      {/* Results */}
      {results && (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          {results.success ? (
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Results</h3>
              <div className="text-sm text-gray-600 mb-4">{results.message}</div>
              
              {/* Instructions for clickable tokens */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
                <div className="flex items-start">
                  <div className="text-blue-600 mr-2">💡</div>
                  <div className="text-sm text-blue-800">
                    <strong>Tip:</strong> Click on any token below to automatically search for it in the concordance tab. 
                    This will switch to the concordance view and perform a search using the same node selections.
                  </div>
                </div>
              </div>
              
              {results.data ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {Object.entries(results.data).map(([nodeName, frequencies]) => 
                    renderChart(nodeName, frequencies)
                  )}
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

export default TokenFrequencyTab;
