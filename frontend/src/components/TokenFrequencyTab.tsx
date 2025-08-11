import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
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
  // Dynamic color management for selected nodes
  const [nodeColors, setNodeColors] = useState<Record<string, string>>({});
  const [lastCompareNodeIds, setLastCompareNodeIds] = useState<string[]>([]); // preserves order used in last analysis
  const defaultPalette = useMemo(
    () => [
      '#2563eb', // vivid blue
      '#dc2626', // vivid red
      '#16a34a', // green
      '#9333ea', // purple
      '#d97706', // orange/amber
      '#0d9488', // teal
      '#db2777', // pink
      '#4f46e5', // indigo
      '#65a30d', // lime
      '#0891b2', // cyan
      '#92400e', // brown
      '#6b7280', // gray
    ],
    []
  );
  const [openColorPickerNode, setOpenColorPickerNode] = useState<string | null>(null);
  const colorPopoverRef = useRef<HTMLDivElement | null>(null);
  const colorAnchorRef = useRef<HTMLElement | null>(null);
  const [colorPopoverPos, setColorPopoverPos] = useState<{top:number; left:number} | null>(null);

  // Ensure every currently selected node has a color
  useEffect(() => {
    if (!selectedNodes.length) return;
    setNodeColors(prev => {
      const updated = { ...prev };
      let paletteIndex = 0;
      selectedNodes.forEach(n => {
        if (!updated[n.id]) {
          // find first palette color not already used (simple pass)
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

  const handleColorChange = (nodeId: string, color: string) => {
    setNodeColors(prev => ({ ...prev, [nodeId]: color }));
  };

  // Close popover when clicking outside
  useEffect(() => {
    if (!openColorPickerNode) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (colorPopoverRef.current?.contains(target)) return;
      if (colorAnchorRef.current?.contains(target as Node)) return;
      setOpenColorPickerNode(null);
    };
    window.addEventListener('mousedown', handler);
    window.addEventListener('scroll', () => setOpenColorPickerNode(null), true);
    return () => {
      window.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', () => setOpenColorPickerNode(null), true);
    };
  }, [openColorPickerNode]);

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
  setLastCompareNodeIds(request.node_ids);
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

  const getColorForNodeId = (nodeId: string, idx: number) => nodeColors[nodeId] || defaultPalette[idx % defaultPalette.length];

  const renderWordCloud = (data: any[], width: number = 400, height: number = 200, color: string) => {
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
                  fill={color}
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

  const renderChart = (nodeName: string, data: any[], color: string) => {
    // Find max frequency for bar width calculation
    const maxFreq = Math.max(...data.map(item => item.frequency));

    return (
      <div key={nodeName} className="mb-6">
        <div className="h-16 mb-4 flex items-center">
          <h3 className="text-lg font-semibold text-gray-800 break-words leading-tight w-full">{nodeName}</h3>
        </div>
        
  {/* Word Cloud */}
  {renderWordCloud(data, 400, 200, color)}
        
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
                      className="h-full rounded-full transition-all duration-300"
                      style={{ 
                        width: `${(item.frequency / maxFreq) * 100}%`,
                        minWidth: '2px', // Ensure small bars are still visible
                        backgroundColor: color
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
            <>
            {/* Horizontal list; enable horizontal scroll only when >2 nodes */}
            <div className={`flex space-x-3 pb-2 ${selectedNodes.length > 2 ? 'overflow-x-auto' : 'overflow-x-hidden'}`}>
              {selectedNodes.map((node: any, idx: number) => {
                const columns = getNodeColumns(node);
                const selection = nodeColumnSelections.find(sel => sel.nodeId === node.id);
                const nodeDisplayName = node.name || node.data?.name || (node as any).label || node.data?.label || node.id;
                const nodeColor = getColorForNodeId(node.id, idx);
                return (
                  <div
                    key={node.id}
                    className={`bg-gray-50 p-3 rounded-md ${selectedNodes.length > 2 ? 'flex-none min-w-[50%]' : 'flex-1 min-w-0'}`}
                  >
                    <div className="mb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium break-words pr-2" style={{ color: nodeColor }}>
                          {nodeDisplayName}
                        </div>
                        <div className="relative">
                          <button
                            type="button"
                            aria-label="Select color"
                            ref={el => { if (el && openColorPickerNode === node.id) colorAnchorRef.current = el; }}
                            onClick={(e) => {
                              if (openColorPickerNode === node.id) {
                                setOpenColorPickerNode(null);
                                return;
                              }
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              const bodyWidth = window.innerWidth;
                              const desiredWidth = 180;
                              let left = rect.left + rect.width / 2 - desiredWidth / 2;
                              left = Math.max(8, Math.min(bodyWidth - desiredWidth - 8, left));
                              const top = rect.bottom + 8 + window.scrollY;
                              setColorPopoverPos({ top, left });
                              setOpenColorPickerNode(node.id);
                            }}
                            className="w-8 h-8 rounded-full ring-2 ring-offset-1 ring-gray-300 hover:ring-blue-400 focus:outline-none focus:ring-blue-500 transition-shadow shadow-sm"
                            style={{ backgroundColor: nodeColor }}
                          />
                        </div>
                        {openColorPickerNode === node.id && colorPopoverPos && ReactDOM.createPortal(
                          <div
                            ref={colorPopoverRef}
                            className="z-[9999] w-56 p-3 rounded-lg border border-gray-200 bg-white shadow-xl animate-fade-in"
                            style={{ position: 'absolute', top: colorPopoverPos.top, left: colorPopoverPos.left }}
                          >
                            <div className="text-xs font-medium text-gray-600 mb-2 flex items-center justify-between">
                              <span>Pick Color</span>
                              <button
                                type="button"
                                onClick={() => setOpenColorPickerNode(null)}
                                className="text-gray-400 hover:text-gray-600"
                                aria-label="Close color picker"
                              >×</button>
                            </div>
                            <div className="grid grid-cols-6 gap-1 mb-3">
                              {defaultPalette.map(p => (
                                <button
                                  key={p}
                                  type="button"
                                  className={`w-6 h-6 rounded-full border border-white shadow-sm hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 transition-transform ${p === nodeColor ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
                                  style={{ backgroundColor: p }}
                                  onClick={() => handleColorChange(node.id, p)}
                                  aria-label={`Set color ${p}`}
                                />
                              ))}
                            </div>
                            <div className="flex items-stretch gap-2 mt-1">
                              <div className="flex flex-col items-center">
                                <input
                                  type="color"
                                  value={nodeColor}
                                  onChange={(e) => handleColorChange(node.id, e.target.value)}
                                  className="w-9 h-9 p-0 border border-gray-300 rounded cursor-pointer bg-transparent"
                                  aria-label="Custom color"
                                />
                              </div>
                              <input
                                type="text"
                                value={nodeColor.toUpperCase()}
                                onChange={(e) => {
                                  const val = e.target.value.trim();
                                  if (/^#?[0-9A-Fa-f]{0,7}$/.test(val)) { // allow # and up to 6 hex chars while typing
                                    const normalized = val.startsWith('#') ? val : `#${val}`;
                                    if (/^#[0-9A-Fa-f]{6}$/.test(normalized)) handleColorChange(node.id, normalized);
                                  }
                                }}
                                className="flex-1 px-2 py-2 text-xs border border-gray-300 rounded font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                                aria-label="Hex color"
                                placeholder="#000000"
                                maxLength={7}
                              />
                            </div>
                          </div>, document.body
                        )}
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
                <div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {Object.entries(results.data).map(([nodeName, frequencies], idx) => {
                      const nodeId = lastCompareNodeIds[idx];
                      const color = getColorForNodeId(nodeId, idx);
                      return renderChart(nodeName, frequencies, color);
                    })}
                  </div>

                  {/* Unified Comparative Word Cloud */}
                  {Object.keys(results.data).length === 2 && lastCompareNodeIds.length === 2 && (() => {
                    const entries = Object.entries(results.data);
                    const [nodeAName, dataA] = entries[0];
                    const [nodeBName, dataB] = entries[1];
                    const nodeAId = lastCompareNodeIds[0];
                    const nodeBId = lastCompareNodeIds[1];
                    const nodeAColor = getColorForNodeId(nodeAId, 0);
                    const nodeBColor = getColorForNodeId(nodeBId, 1);
                    const freqMap: Record<string, { a: number; b: number }> = {};
                    for (const item of dataA) {
                      freqMap[item.token] = { a: item.frequency, b: 0 };
                    }
                    for (const item of dataB) {
                      if (!freqMap[item.token]) freqMap[item.token] = { a: 0, b: 0 };
                      freqMap[item.token].b = item.frequency;
                    }
                    const combined = Object.entries(freqMap).map(([token, vals]) => ({
                      token,
                      freqA: vals.a,
                      freqB: vals.b,
                      total: vals.a + vals.b
                    })).filter(w => w.total > 0);
                    if (combined.length === 0) return null;
                    const maxTotal = Math.max(...combined.map(w => w.total));

                    // Simple hex interpolation
                    const hexToRgb = (hex: string) => {
                      const h = hex.replace('#', '');
                      return {
                        r: parseInt(h.substring(0, 2), 16),
                        g: parseInt(h.substring(2, 4), 16),
                        b: parseInt(h.substring(4, 6), 16)
                      };
                    };
                    const rgbToHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
                    const colorA = hexToRgb(nodeAColor);
                    const colorB = hexToRgb(nodeBColor);
                    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
                    const blend = (t: number) => {
                      const r = Math.round(lerp(colorB.r, colorA.r, t)); // t=1 -> nodeA
                      const g = Math.round(lerp(colorB.g, colorA.g, t));
                      const b = Math.round(lerp(colorB.b, colorA.b, t));
                      return rgbToHex(r, g, b);
                    };

                    // Index statistics for percentage-based coloring (avoid corpus size bias)
                    const statIndex = new Map((results.statistics || []).map(s => [s.token, s]));
                    // Prepare words list; size = raw combined frequency; color proportion = relative percentage share
                    const words = combined.map(w => {
                      const stat = statIndex.get(w.token);
                      if (stat) {
                        const pA = stat.percent_corpus_0; // already percentage 0-100
                        const pB = stat.percent_corpus_1;
                        const denom = pA + pB;
                        return {
                          text: w.token,
                          value: w.total,
                          proportion: denom > 0 ? (pA / denom) : 0.5,
                        };
                      }
                      // Fallback to frequency-based proportion if no stats entry
                      return {
                        text: w.token,
                        value: w.total,
                        proportion: w.total > 0 ? (w.freqA / w.total) : 0.5,
                      };
                    });

                    const fontScale = (datum: any) => Math.max(12, Math.min(54, datum.value / maxTotal * 42 + 12));
                    const fontSizeSetter = (datum: any) => fontScale(datum);

                    return (
                      <div className="mb-10">
                        <div className="flex items-center justify-between mb-3 flex-wrap gap-4">
                          <h3 className="text-lg font-semibold text-gray-800">Unified Word Cloud</h3>
                          <div className="flex items-center space-x-4 text-sm">
                            <div className="flex items-center space-x-1"><span className="w-4 h-4 inline-block rounded" style={{ background: nodeAColor }}></span><span className="text-gray-700 truncate max-w-[140px]" title={nodeAName}>{nodeAName}</span></div>
                            <div className="flex items-center space-x-1"><span className="w-4 h-4 inline-block rounded" style={{ background: nodeBColor }}></span><span className="text-gray-700 truncate max-w-[140px]" title={nodeBName}>{nodeBName}</span></div>
                            <div className="flex items-center space-x-2">
                              <span className="text-gray-500">Gradient:</span>
                              <div className="h-3 w-32 rounded bg-gradient-to-r" style={{ background: `linear-gradient(to right, ${nodeAColor}, ${nodeBColor})` }}></div>
                              <span className="text-gray-500">A → B</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex justify-center">
                          <svg width={860} height={260}>
                            <Wordcloud
                              words={words}
                              width={860}
                              height={260}
                              fontSize={fontSizeSetter}
                              font="Segoe UI, Roboto, sans-serif"
                              padding={2}
                              spiral="archimedean"
                              rotate={0}
                              random={() => 0.5}
                            >
                              {(cloudWords) =>
                                cloudWords.map((w: any) => (
                                  <Text
                                    key={w.text}
                                    fill={blend(w.proportion)}
                                    textAnchor="middle"
                                    transform={`translate(${w.x}, ${w.y})`}
                                    fontSize={w.size}
                                    fontFamily={w.font}
                                    className="cursor-pointer transition-colors"
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
                        <p className="text-xs text-gray-500 mt-2 text-center">Size = sum of raw frequencies. Color uses relative percentage share (%1 vs %2) so differing corpus sizes don't bias color; shifts toward {nodeAName} (left) or {nodeBName} (right).</p>
                      </div>
                    );
                  })()}
                  
                  {/* Statistical Measures Table */}
                  {results.statistics && results.statistics.length > 0 && (
                    <div className="mt-8">
                      <h3 className="text-lg font-semibold text-gray-800 mb-4">Statistical Measures</h3>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                        <div className="text-sm text-gray-700">
                          <strong>Statistical Analysis Key:</strong>
                          <br />
                          <strong>O1/O2:</strong> Observed frequencies in each dataset &nbsp;&nbsp;
                          <strong>%1/%2:</strong> Percentage of total tokens in each dataset
                          <br />
                          <strong>LL:</strong> Log Likelihood G2 statistic (higher = more significant difference) &nbsp;&nbsp;
                          <strong>%DIFF:</strong> Percentage point difference between datasets
                          <br />
                          <strong>Bayes:</strong> Bayes Factor (BIC) &nbsp;&nbsp;
                          <strong>ELL:</strong> Effect Size for Log Likelihood &nbsp;&nbsp;
                          <strong>RRisk:</strong> Relative Risk ratio
                          <br />
                          <strong>LogRatio:</strong> Log of relative frequencies &nbsp;&nbsp;
                          <strong>OddsRatio:</strong> Odds ratio between datasets
                          <br />
                          <strong>Significance:</strong> **** p&lt;0.0001, *** p&lt;0.001, ** p&lt;0.01, * p&lt;0.05
                        </div>
                      </div>
                      
                      <div className="overflow-x-auto">
                        <table className="min-w-full bg-white border border-gray-200 rounded-lg">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleTokenClick(results.statistics?.[0]?.token || '')}>
                                Token
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                O1
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                %1
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                O2
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                %2
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                LL
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                %DIFF
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Bayes
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                ELL
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                RRisk
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                LogRatio
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                OddsRatio
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Significance
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {results.statistics
                              .filter(stat => stat.log_likelihood_llv > 0) // Only show tokens with actual differences
                              .sort((a, b) => b.log_likelihood_llv - a.log_likelihood_llv) // Sort by log likelihood descending
                              .map((stat, index) => (
                              <tr key={stat.token} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="px-3 py-2 text-sm font-medium text-blue-600 cursor-pointer hover:text-blue-800 hover:bg-blue-50" onClick={() => handleTokenClick(stat.token)}>
                                  {stat.token}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-900 font-mono text-center">
                                  {stat.freq_corpus_0}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-900 font-mono text-center">
                                  {stat.percent_corpus_0.toFixed(2)}%
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-900 font-mono text-center">
                                  {stat.freq_corpus_1}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-900 font-mono text-center">
                                  {stat.percent_corpus_1.toFixed(2)}%
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-900 font-mono text-center">
                                  {stat.log_likelihood_llv.toFixed(2)}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-900 font-mono text-center">
                                  {(stat.percent_diff * 100).toFixed(2)}%
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-900 font-mono text-center">
                                  {stat.bayes_factor_bic.toFixed(2)}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-900 font-mono text-center">
                                  {stat.effect_size_ell !== null ? stat.effect_size_ell.toFixed(4) : 'N/A'}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-900 font-mono text-center">
                                  {stat.relative_risk !== null ? stat.relative_risk.toFixed(2) : '∞'}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-900 font-mono text-center">
                                  {stat.log_ratio !== null ? stat.log_ratio.toFixed(4) : 'N/A'}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-900 font-mono text-center">
                                  {stat.odds_ratio !== null ? stat.odds_ratio.toFixed(2) : '∞'}
                                </td>
                                <td className="px-3 py-2 text-sm text-center">
                                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                    stat.significance === '****' ? 'bg-red-100 text-red-800' :
                                    stat.significance === '***' ? 'bg-orange-100 text-orange-800' :
                                    stat.significance === '**' ? 'bg-yellow-100 text-yellow-800' :
                                    stat.significance === '*' ? 'bg-green-100 text-green-800' :
                                    'bg-gray-100 text-gray-800'
                                  }`}>
                                    {stat.significance || 'n.s.'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      
                      {results.statistics.filter(stat => stat.log_likelihood_llv > 0).length === 0 && (
                        <div className="text-center py-8 text-gray-500">
                          No significant differences found between the selected datasets.
                        </div>
                      )}
                    </div>
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
