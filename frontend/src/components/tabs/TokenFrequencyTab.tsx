import React, { useState, useEffect, useMemo, useRef } from 'react';
import NodeSelectionPanel from '../NodeSelectionPanel';
import { useWorkspace } from '../../hooks/useWorkspace';
import { nodesApi } from '../../api/nodes';
import { useAuth } from '../../hooks/useAuth';
import { TokenFrequencyRequest, TokenFrequencyResponse, textApi } from '../../api/text';
import { Wordcloud } from '@visx/wordcloud';
import { Text } from '@visx/text';
import useAutoNodeColumns from '../../hooks/useAutoNodeColumns';
import useNodeColumnInfos from '../../hooks/useNodeColumnInfos';

interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

type FormatNumberOptions = {
  suffix?: string;
  multiplier?: number;
  fallback?: string;
};

const formatNumber = (value: unknown, decimals: number, options: FormatNumberOptions = {}): string => {
  const { suffix = '', multiplier = 1, fallback = '—' } = options;
  const numeric = toFiniteNumber(value);
  if (numeric === null) return fallback;
  const scaled = numeric * multiplier;
  if (!Number.isFinite(scaled)) return fallback;
  const formatted = scaled.toFixed(decimals);
  const sanitized = /^-0(?:\.0+)?$/.test(formatted) ? formatted.replace('-', '') : formatted;
  return `${sanitized}${suffix}`;
};

const TokenFrequencyTab: React.FC = () => {
  const {
    selectedNodes,
    isLoading,
    currentWorkspaceId,
    getNodeShape,
  } = useWorkspace();

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
  });

  const nodeIdToName = useMemo(() => {
    const map: Record<string,string> = {};
    selectedNodes.forEach(n => {
      const name = (n.name || n.data?.name || (n as any).label || n.data?.label || n.data?.nodeName || n.id);
      map[n.id] = String(name);
    });
    return map;
  }, [selectedNodes]);

  const { getAuthHeaders } = useAuth();

  const [stopWords, setStopWords] = useState<string>('');
  // Default display limit (frontend-only)
  const [limit, setLimit] = useState<number>(10);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  // Shared auto column selection hook (shared scope with Concordance via undefined storageScope)
  const { selections: nodeColumnSelections, setSelection: setNodeColumnSelection, setSelections: setNodeColumnSelectionsRaw, recompute: recomputeAutoColumns } = useAutoNodeColumns({
    selectedNodes,
    getNodeColumns: getColumnInfos,
    allowedDataTypes: ['string'],
  }, { workspaceId: currentWorkspaceId, maxNodes: 2, isLocked, docTypeOnly: true, enableHeuristicGuess: false });
  const [lockedNodesSnapshot, setLockedNodesSnapshot] = useState<Array<{ id: string; name: string; columns: string[] }>>([]);
  const [isLoadingStopWords, setIsLoadingStopWords] = useState(false);
  const [results, setResults] = useState<TokenFrequencyResponse | null>(null);
  // Statistical table head/tail preview & sorting
  const [headTailN, setHeadTailN] = useState<number>(10);
  // Sorting state (supports tri-state: none -> desc -> asc -> none)
  const [statsSortColumn, setStatsSortColumn] = useState<string>('log_likelihood_llv');
  const [statsSortDirection, setStatsSortDirection] = useState<'asc'|'desc'>('desc');
  const [showFullStatsModal, setShowFullStatsModal] = useState(false);
  // Modal pagination (number_of_columns) and page state
  const [modalPageSize, setModalPageSize] = useState<number>(50); // number_of_columns
  const [modalPage, setModalPage] = useState<number>(1);
  // Dynamic color management for selected nodes
  const [nodeColors, setNodeColors] = useState<Record<string, string>>({});
  const [lastCompareNodeIds, setLastCompareNodeIds] = useState<string[]>([]); // preserves order used in last analysis
  // Locally-applied stop word filter (no recomputation)
  const [appliedStopSet, setAppliedStopSet] = useState<Set<string>>(new Set());

  // Helper to compute and apply stop set from a comma-separated string
  const saveStopWordsToBackend = async (words: string[]) => {
    try {
      if (currentWorkspaceId) {
        await textApi.postTokenFrequenciesCurrentRequest(currentWorkspaceId, { stop_words: words }, getAuthHeaders());
      }
    } catch (e) {
      // non-fatal
      if (localStorage.getItem('debugTF') === '1') console.warn('Failed to save stop words', e);
    }
  };
  const applyStopSetFromText = (text: string) => {
    const words = text
      .split(',')
      .map(w => w.trim().toLowerCase())
      .filter(Boolean);
    setAppliedStopSet(new Set(words));
    // Persist stop words (UI preference) to backend; calculation does not use them
    void saveStopWordsToBackend(words);
  };
  const defaultPalette = useMemo(
    () => [
      '#2563eb', // vivid blue
      '#dc2626', // vivid red
      '#16a34a', // green
      '#9333ea', // purple
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
  // Color picker handled by shared component now

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

  // Removed legacy popover logic

  // Hydrate from backend on mount and whenever the tab becomes visible again or we lack statistics
  const hydratingRef = useRef<boolean>(false);
  const performHydration = async () => {
    if (hydratingRef.current) return;
    if (!currentWorkspaceId) return;
    hydratingRef.current = true;
    try {
      const reqResp = await textApi.getTokenFrequenciesCurrentRequest(currentWorkspaceId, getAuthHeaders());
      if (!reqResp) {
        // No current request: clear local persisted state and DO NOT fetch current-result
        setStopWords('');
        setAppliedStopSet(new Set());
        setNodeColumnSelectionsRaw([], { replace: true });
        setLastCompareNodeIds([]);
        return;
      }
      const req = (reqResp as any)?.data;
      if (req) {
        if (Array.isArray(req.stop_words)) {
          const joined = req.stop_words.join(', ');
          setStopWords(joined);
          setAppliedStopSet(new Set(req.stop_words.map((w: any) => String(w).toLowerCase())));
        } else {
          setStopWords('');
          setAppliedStopSet(new Set());
        }
        const nodeIds: string[] = Array.isArray(req.node_ids) ? req.node_ids.slice(0, 2) : [];
  const node_columns: Record<string, string> = req.node_columns || {};
  const sels = nodeIds.map((id: string) => ({ nodeId: id, column: node_columns[id] || '' }));
  setNodeColumnSelectionsRaw(sels, { replace: true });
        setLastCompareNodeIds(nodeIds);
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
          if (snaps.length) {
            setLockedNodesSnapshot(snaps);
            setIsLocked(true);
          }
        } catch { /* ignore */ }
      }
      // Only fetch current-result if a request existed
      const resResp = await textApi.getTokenFrequenciesCurrentResult(currentWorkspaceId, getAuthHeaders());
      if (resResp) setResults(resResp as any);
    } catch { /* ignore */ }
    finally {
      hydratingRef.current = false;
    }
  };
  useEffect(() => { void performHydration(); }, [currentWorkspaceId, getAuthHeaders]);
  useEffect(() => {
    const handleVisibility = () => {
      const shouldRehydrate = document.visibilityState === 'visible' && currentWorkspaceId && (!results || (Array.isArray(results.statistics) && results.statistics.length === 0 && lastCompareNodeIds.length === 2));
      if (shouldRehydrate) void performHydration();
    };
    window.addEventListener('focus', handleVisibility);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleVisibility);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [results, currentWorkspaceId, lastCompareNodeIds]);


  // Debug results changes
  useEffect(() => {
      if (results) {
      if (localStorage.getItem('debugTF') === '1') {
        console.log('Results updated:', results);
  console.log('Results state:', (results as any).state);
        console.log('Results data:', results.data);
      }
      if (results.data) {
  if (localStorage.getItem('debugTF') === '1') console.log('Data entries:', Object.entries(results.data));
      }
    }
  }, [results]);

  // Reset modal page when sort/filter state changes or modal opens
  useEffect(() => {
    if (showFullStatsModal) {
      setModalPage(1);
    }
  }, [showFullStatsModal, statsSortColumn, statsSortDirection, appliedStopSet]);

  // Clear results when node selection changes  
  // Use a more stable dependency by checking the actual node IDs
  const selectedNodeIds = useMemo(() => selectedNodes.map(node => node.id).sort(), [selectedNodes]);
  useEffect(() => {
    if (!isLocked) setResults(null);
  }, [selectedNodeIds, isLocked]);

  // Recompute auto columns if we become unlocked and selections empty while nodes exist
  useEffect(() => {
    if (!isLocked && selectedNodes.length > 0 && nodeColumnSelections.length === 0) {
      recomputeAutoColumns();
    }
  }, [isLocked, selectedNodes, nodeColumnSelections, recomputeAutoColumns]);

  const handleColumnChange = (nodeId: string, column: string) => setNodeColumnSelection(nodeId, column);

  const handleFillDefaultStopWords = async () => {
    setIsLoadingStopWords(true);
    try {
    const response = await textApi.defaultStopWords(getAuthHeaders());
    if (response.state === 'successful' && response.data) {
        const joined = response.data.join(', ');
        setStopWords(joined);
        // Auto-apply on fill default and persist
        applyStopSetFromText(joined);
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

  // Fetch a larger pool so client-side stop-word filtering can supplement to the UI limit without recomputation
  const fetchLimit = Math.min(1000, Math.max(200, (limit || 20) * 5));

      // Create node_columns mapping
      const nodeColumns: Record<string, string> = {};
      nodeColumnSelections.forEach(sel => {
        nodeColumns[sel.nodeId] = sel.column;
      });

      const request: TokenFrequencyRequest = {
        node_ids: selectedNodes.slice(0, 2).map(node => node.id), // Limit to 2 nodes
        node_columns: nodeColumns,
        stop_words: stopWordsArray,
        limit: fetchLimit,
      };

  const response = await textApi.tokenFrequencies(currentWorkspaceId, request, getAuthHeaders());

  if (localStorage.getItem('debugTF') === '1') console.log('Token Frequency Response:', response);
  setResults(response);
  setLastCompareNodeIds(request.node_ids);
      // Lock panel with snapshot
      try {
        const snaps: Array<{ id: string; name: string; columns: string[] }> = [];
        for (const id of request.node_ids) {
          try {
            const info = await nodesApi.info(currentWorkspaceId!, id, getAuthHeaders());
            const name = (info as any)?.name || (info as any)?.data?.name || id;
            const columns = Array.isArray((info as any)?.columns) ? (info as any).columns : (Array.isArray((info as any)?.data?.columns) ? (info as any).data.columns : []);
            snaps.push({ id, name: String(name), columns });
          } catch { snaps.push({ id, name: id, columns: [] }); }
        }
        setLockedNodesSnapshot(snaps);
        setIsLocked(true);
      } catch { /* ignore */ }
    } catch (error) {
      console.error('Error calculating token frequencies:', error);
      setResults({
        state: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        data: null
      } as any);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleClearResults = async () => {
    try {
      if (currentWorkspaceId) {
        await textApi.clearTokenFrequencies(currentWorkspaceId, getAuthHeaders());
      }
    } catch (e) {
      console.error('Failed to clear backend analyses/cache:', e);
    }
    setResults(null);
    setLastCompareNodeIds([]);
    setLockedNodesSnapshot([]);
    setIsLocked(false);
  };

  const handleTokenClick = async (token: string) => {
    // Build a backend concordance request first so Concordance tab hydrates instantly
    try {
      if (currentWorkspaceId && selectedNodes.length > 0) {
        const nodeColumns: Record<string, string> = {};
        selectedNodes.slice(0, 2).forEach(n => {
          const sel = nodeColumnSelections.find(s => s.nodeId === n.id);
          if (sel?.column) nodeColumns[n.id] = sel.column;
        });
        const nodeIds = Object.keys(nodeColumns);
        if (nodeIds.length > 0) {
          const request = {
            node_ids: nodeIds,
            node_columns: nodeColumns,
            search_word: token,
            num_left_tokens: 10,
            num_right_tokens: 10,
            regex: false,
            case_sensitive: false,
            page: 1,
            page_size: 20,
            combined: false,
          };
          await textApi.concordance(currentWorkspaceId, request, getAuthHeaders());
        }
      }
    } catch (e) {
      // Non-fatal if pre-trigger fails; Concordance tab can still run via UI
      if (localStorage.getItem('debugTF') === '1') console.warn('Pre-trigger concordance failed:', e);
    }

    // Store parameters as a fallback and for UI hints
  // Persist parameters so ConcordanceTab can hydrate & auto-run without user clicking 'Run'.
  // autoRun flag triggers a short-delay (50ms) immediate execution in ConcordanceTab.
  const concordanceParams = {
      searchWord: token,
      nodeColumnSelections: nodeColumnSelections,
      selectedNodes: selectedNodes.map(node => ({
        id: node.id,
        name: node.data?.name || node.id
      })),
      nodeColors,
      timestamp: Date.now(),
      autoRun: true, // New flag to force auto execution in Concordance tab
    };
    try { localStorage.setItem('pendingConcordanceSearch', JSON.stringify(concordanceParams)); } catch (_) {}

    // Navigate to concordance tab
    window.dispatchEvent(new CustomEvent('navigateToConcordance', { detail: { token } }));

    if (localStorage.getItem('debugTF') === '1') console.log(`Navigating to concordance with token: "${token}"`);
  };

  // Right-click handler: add token to stop word list if not present
  const handleTokenRightClick = (token: string, e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    const tokenNorm = token.trim().toLowerCase();
    const current = stopWords
      .split(',')
      .map(w => w.trim())
      .filter(Boolean);
    if (!current.map(w => w.toLowerCase()).includes(tokenNorm)) {
      const updated = [...current, token].join(', ');
      setStopWords(updated);
      // Auto-apply when a word is added via right-click
      applyStopSetFromText(updated);
    }
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
                  onContextMenu={e => w.text && handleTokenRightClick(w.text, e)}
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

  // Derive filtered results data according to the applied stop-word set
  const filteredResultsData = useMemo(() => {
    if (!results?.data) return null;
    if (!appliedStopSet || appliedStopSet.size === 0) return results.data as any;
    const out: Record<string, any[]> = {};
    for (const [nodeName, freqValue] of Object.entries(results.data as any)) {
      const rows = Array.isArray(freqValue) ? (freqValue as any[]) : ((freqValue as any)?.data ?? []);
      out[nodeName] = rows.filter((item: any) => !appliedStopSet.has(String(item.token || '').toLowerCase()));
    }
    return out;
  }, [results, appliedStopSet]);

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
                {/* Token label - now clickable and right-clickable */}
                <div 
                  className="w-20 text-right text-sm text-gray-700 font-medium cursor-pointer hover:bg-blue-100 hover:text-blue-700 px-2 py-1 rounded-md transition-colors"
                  onClick={() => handleTokenClick(item.token)}
                  onContextMenu={e => handleTokenRightClick(item.token, e)}
                  title={`Left click: concordance; Right click: add to stop words`}
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-800">Token Frequency Analysis</h2>
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
                  <li>Frontend-only options (e.g., Stop words, Token Limit) stay editable.</li>
                  <li>Clear results to unlock and resync with the graph selection.</li>
                </ul>
              </div>
            </div>
          )}
        </div>
        
        <NodeSelectionPanel
          selectedNodes={(isLocked && lockedNodesSnapshot.length) ? lockedNodesSnapshot.map(s=>({ id: s.id, name: s.name, data: { name: s.name, nodeName: s.name, label: s.name, columns: s.columns }, columns: s.columns })) : selectedNodes}
          nodeColumnSelections={nodeColumnSelections}
          onColumnChange={handleColumnChange}
          nodeColors={nodeColors}
          onColorChange={handleColorChange}
          defaultPalette={defaultPalette}
          maxCompare={2}
          className="mb-6"
          showShape
          getNodeShapeFn={getNodeShape}
          disabled={!!isLocked}
          showColorPicker={true}
          getNodeColumns={getColumnInfos}
          allowedDataTypes={['string']}
        />

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
              onBlur={() => applyStopSetFromText(stopWords)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyStopSetFromText(stopWords);
                }
              }}
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

  {/* Action Buttons */}
  <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleAnalyze}
            disabled={
              selectedNodes.length === 0 || 
              isAnalyzing || 
              !currentWorkspaceId ||
              nodeColumnSelections.some(sel => !sel.column) ||
              !!isLocked
            }
            className="w-full md:w-auto px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {isAnalyzing ? 'Analyzing...' : 'Calculate Token Frequencies'}
          </button>
          {results && (
            <button
              onClick={handleClearResults}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
            >
              Clear Results
            </button>
          )}
          {appliedStopSet.size > 0 && (
            <span className="text-xs text-gray-500">Active filter: {appliedStopSet.size} word{appliedStopSet.size === 1 ? '' : 's'}</span>
          )}
        </div>
      </div>

      {/* Results */}
      {results && (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          {results && (results as any).state === 'successful' ? (
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
                    {Object.entries((filteredResultsData ?? (results.data as any))).map(([nodeName, freqValue], idx) => {
                      const nodeId = lastCompareNodeIds[idx];
                      const color = getColorForNodeId(nodeId, idx);
                      const rows = Array.isArray(freqValue) ? (freqValue as any[]) : ((freqValue as any)?.data ?? []);
                      // Cap to UI limit after filtering to maintain a stable count
                      const display = rows.slice(0, Math.max(1, limit || 1));
                      return renderChart(nodeName, display, color);
                    })}
                  </div>

                  {/* Unified Comparative Word Cloud */}
                  {Object.keys(results.data).length === 2 && lastCompareNodeIds.length === 2 && (() => {
                    const entries = Object.entries(results.data);
                    const [nodeAName] = entries[0];
                    const [nodeBName] = entries[1];
                    const nodeAId = lastCompareNodeIds[0];
                    const nodeBId = lastCompareNodeIds[1];
                    const nodeAColor = getColorForNodeId(nodeAId, 0);
                    const nodeBColor = getColorForNodeId(nodeBId, 1);
                    // Build from statistics table with requested juxRank selection
                    const stats = (results.statistics || [])
                    .filter((s: any) => !appliedStopSet.has(String(s.token || '').toLowerCase()))
                    .map((s: any) => ({
                      token: s.token,
                      o1: s.freq_corpus_0,
                      o2: s.freq_corpus_1,
                      p1: s.percent_corpus_0,
                      p2: s.percent_corpus_1,
                      logratio: s.log_ratio ?? 0,
                    }))
                    .map((s: any) => ({
                      ...s,
                      total: s.o1 + s.o2,
                      juxRank: ((s.o1 + s.o2) > 0 ? Math.log10(s.o1 + s.o2) : 0) * (s.logratio || 0)
                    }))
                    .filter((s: any) => s.total > 10);

                    if (stats.length === 0) return null;

                    const sortedAsc = [...stats].sort((a, b) => a.juxRank - b.juxRank);
                    // Use 2 * limit for unified word cloud
                    const cloudLimit = 2 * limit;
                    const half = Math.floor(cloudLimit / 2);
                    const low = sortedAsc.slice(0, Math.min(half, sortedAsc.length));
                    const high = sortedAsc.slice(Math.max(sortedAsc.length - half, 0));
                    let selected = [...low, ...high];

                    // If cloudLimit is odd, add one more from the side with larger absolute extremum not already picked
                    const remaining = Math.max(0, cloudLimit - selected.length);
                    if (remaining > 0 && sortedAsc.length > selected.length) {
                      const nextLow = sortedAsc[low.length] || null;
                      const nextHigh = sortedAsc[sortedAsc.length - high.length - 1] || null;
                      const pick = (() => {
                        const al = nextLow ? Math.abs(nextLow.juxRank) : -1;
                        const ah = nextHigh ? Math.abs(nextHigh.juxRank) : -1;
                        return ah >= al ? nextHigh : nextLow;
                      })();
                      if (pick) selected.push(pick);
                    }

                    // De-duplicate in case of overlap (when cloudLimit > unique items etc.)
                    const seen = new Set<string>();
                    selected = selected.filter(s => (seen.has(s.token) ? false : (seen.add(s.token), true)));

                    // Ensure we don't exceed cloudLimit
                    selected = selected.slice(0, Math.min(cloudLimit, selected.length));

                    // // Debug print of selected tokens with juxRank
                    // const debugOn = (typeof window !== 'undefined') && localStorage.getItem('debugTF') === '1';
                    // if (debugOn) {
                    //   const dbg = [...selected]
                    //     .sort((a, b) => a.juxRank - b.juxRank)
                    //     .map(s => ({ token: s.token, juxRank: Number.isFinite(s.juxRank) ? Number(s.juxRank.toFixed(6)) : s.juxRank, O1: s.o1, O2: s.o2, LogRatio: Number(s.logratio.toFixed(6)) }));
                    //   // eslint-disable-next-line no-console
                    //   console.log('Unified Word Cloud selected tokens (by juxRank low→high):', dbg);
                    // }

                    const maxTotal = Math.max(...selected.map(w => w.total));

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

                    // Prepare words list from selected stats; size = total (O1+O2); color proportion by percentage share
                    const words = selected.map(s => {
                      const pA = s.p1; // percent 0-100
                      const pB = s.p2;
                      const denom = pA + pB;
                      return {
                        text: s.token,
                        value: s.total,
                        proportion: denom > 0 ? (pA / denom) : 0.5,
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
                                    onContextMenu={e => w.text && handleTokenRightClick(w.text, e)}
                                    style={{ cursor: 'pointer' }}
                                  >
                                    {w.text || ''}
                                  </Text>
                                ))
                              }
                            </Wordcloud>
                          </svg>
                        </div>
                        <p className="text-xs text-gray-500 mt-2 text-center">Selection uses juxRank = log10(O1+O2) × LogRatio: 50% lowest and 50% highest by juxRank (2× token limit = {2 * limit} tokens). Size = (O1+O2). Color uses relative percentage share (%1 vs %2) so differing corpus sizes don't bias color; shifts toward {nodeAName} (left) or {nodeBName} (right).</p>
                        {/* {debugOn && (
                          <div className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded">
                            <div className="text-[11px] text-gray-600 font-mono whitespace-pre-wrap">
                              {selected
                                .slice()
                                .sort((a,b) => a.juxRank - b.juxRank)
                                .map(s => `${s.token}\t${(Number.isFinite(s.juxRank) ? s.juxRank.toFixed(6) : s.juxRank)}\t(O1:${s.o1}, O2:${s.o2}, LR:${s.logratio.toFixed(6)})`) // eslint-disable-line @typescript-eslint/restrict-plus-operands
                                .join('\n')}
                            </div>
                          </div>
                        )} */}
                      </div>
                    );
                  })()}
                  
                  {/* Statistical Measures Table */}
                  {results.statistics && results.statistics.length > 0 && (
                    <div className="mt-8">
                      <h3 className="text-lg font-semibold text-gray-800 mb-4">Statistical Measures</h3>
                      <div className="flex flex-wrap items-center gap-4 mb-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Head/Tail Rows (N)</label>
                          <input
                            type="number"
                            min={1}
                            max={200}
                            value={headTailN}
                            onChange={e => setHeadTailN(Math.max(1, Math.min(200, parseInt(e.target.value) || 1)))}
                            className="w-28 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                          />
                        </div>
                        <div className="text-xs text-gray-500 max-w-xl">
                          Showing first N and last N rows of the sorted table (with ellipsis if truncated). Sorting always applies to the full set before trimming.
                        </div>
                      </div>
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
                      
                      {(() => {
                        // Column definitions for sorting
                        const columns: { key: string; label: string; accessor: (s: any) => any; isNumeric?: boolean; formatter?: (v: any, s: any) => React.ReactNode }[] = [
                          { key: 'token', label: 'Token', accessor: s => s.token },
                          { key: 'freq_corpus_0', label: 'O1', accessor: s => s.freq_corpus_0, isNumeric: true },
                          { key: 'percent_corpus_0', label: '%1', accessor: s => s.percent_corpus_0, isNumeric: true, formatter: v => formatNumber(v, 2, { suffix: '%' }) },
                          { key: 'freq_corpus_1', label: 'O2', accessor: s => s.freq_corpus_1, isNumeric: true },
                          { key: 'percent_corpus_1', label: '%2', accessor: s => s.percent_corpus_1, isNumeric: true, formatter: v => formatNumber(v, 2, { suffix: '%' }) },
                          { key: 'log_likelihood_llv', label: 'LL', accessor: s => s.log_likelihood_llv, isNumeric: true, formatter: v => formatNumber(v, 2) },
                          { key: 'percent_diff', label: '%DIFF', accessor: s => s.percent_diff, isNumeric: true, formatter: v => formatNumber(v, 2, { suffix: '%', multiplier: 100 }) },
                          { key: 'bayes_factor_bic', label: 'Bayes', accessor: s => s.bayes_factor_bic, isNumeric: true, formatter: v => formatNumber(v, 2) },
                          { key: 'effect_size_ell', label: 'ELL', accessor: s => s.effect_size_ell, isNumeric: true, formatter: v => formatNumber(v, 4, { fallback: 'N/A' }) },
                          { key: 'relative_risk', label: 'RRisk', accessor: s => s.relative_risk, isNumeric: true, formatter: v => formatNumber(v, 2, { fallback: '∞' }) },
                          { key: 'log_ratio', label: 'LogRatio', accessor: s => s.log_ratio, isNumeric: true, formatter: v => formatNumber(v, 4, { fallback: 'N/A' }) },
                          { key: 'odds_ratio', label: 'OddsRatio', accessor: s => s.odds_ratio, isNumeric: true, formatter: v => formatNumber(v, 2, { fallback: '∞' }) },
                          { key: 'significance', label: 'Significance', accessor: s => s.significance || '', formatter: (_: any, s: any) => (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              s.significance === '****' ? 'bg-red-100 text-red-800' :
                              s.significance === '***' ? 'bg-orange-100 text-orange-800' :
                              s.significance === '**' ? 'bg-yellow-100 text-yellow-800' :
                              s.significance === '*' ? 'bg-green-100 text-green-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {s.significance || 'n.s.'}
                            </span>) }
                        ];

                        const handleSort = (col: string) => {
                          if (statsSortColumn === col) {
                            setStatsSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                          } else {
                            setStatsSortColumn(col);
                            setStatsSortDirection(col === 'token' ? 'asc' : 'desc');
                          }
                        };

                        const raw = results.statistics
                          .filter((stat: any) => !appliedStopSet.has(String(stat.token || '').toLowerCase()))
                          .filter((stat: any) => stat.log_likelihood_llv > 0);

                        const sorted = (() => {
                          const colActive = statsSortColumn || 'log_likelihood_llv';
                          return [...raw].sort((a, b) => {
                            const col = statsSortColumn;
                            if (col === 'significance') {
                              const rank = (s: any) => (s.significance || '').length; // more * = higher
                              const va = rank(a); const vb = rank(b);
                              return statsSortDirection === 'asc' ? va - vb : vb - va;
                            }
                            const def = columns.find(c => c.key === colActive);
                            if (!def) return 0;
                            const va = def.accessor(a);
                            const vb = def.accessor(b);
                            if (typeof va === 'string' || typeof vb === 'string') {
                              const sa = (va ?? '').toString();
                              const sb = (vb ?? '').toString();
                              if (sa < sb) return statsSortDirection === 'asc' ? -1 : 1;
                              if (sa > sb) return statsSortDirection === 'asc' ? 1 : -1;
                              return 0;
                            }
                            const na = (va === null || va === undefined || Number.isNaN(va)) ? -Infinity : va;
                            const nb = (vb === null || vb === undefined || Number.isNaN(vb)) ? -Infinity : vb;
                            return statsSortDirection === 'asc' ? na - nb : nb - na;
                          });
                        })();

                        const total = sorted.length;
                        const n = headTailN;
                        let display: any[] = [];
                        let truncated = false;
                        if (total <= n * 2) {
                          display = sorted; // no truncation
                        } else {
                          truncated = true;
                          const head = sorted.slice(0, n);
                          const tail = sorted.slice(total - n);
                          // Insert placeholder object to render a middle button instead of ellipsis
                          display = [...head, { __showAllButton: true, key: '__showAllButton' }, ...tail];
                        }

                        // We'll return the truncated table; full modal redefines its own columns
                        return (
                          <div className="overflow-x-auto">
                            <table className="min-w-full bg-white border border-gray-200 rounded-lg">
                              <thead className="bg-gray-50">
                                <tr>
                                  {columns.map(col => {
                                    const active = statsSortColumn === col.key;
                                    const dir = active ? (statsSortDirection === 'asc' ? '▲' : '▼') : '';
                                    return (
                                      <th
                                        key={col.key}
                                        className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-wider cursor-pointer select-none hover:bg-gray-100 ${active ? 'text-blue-600' : 'text-gray-500'}`}
                                        onClick={() => handleSort(col.key)}
                                      >
                                        <div className="flex items-center gap-1">
                                          <span>{col.label}</span>
                                          {dir && <span className="text-[10px]">{dir}</span>}
                                        </div>
                                      </th>
                                    );
                                  })}
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {display.map((stat, index) => {
                                  if (stat.__showAllButton) {
                                    return (
                                      <tr key={`showall-${index}`}>
                                        <td colSpan={columns.length} className="px-3 py-6">
                                          <div className="w-full flex items-center justify-center">
                                            <button
                                              onClick={() => setShowFullStatsModal(true)}
                                              className="px-5 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                                            >
                                              Show complete table ({total} rows)
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  }
                                  return (
                                    <tr key={stat.token} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                      {columns.map(col => {
                                        const rawVal = col.accessor(stat);
                                        const content = col.formatter ? col.formatter(rawVal, stat) : rawVal;
                                        const cellClasses = `px-3 py-2 text-sm ${col.key === 'token' ? 'font-medium text-blue-600 cursor-pointer hover:text-blue-800 hover:bg-blue-50' : 'text-gray-900 font-mono text-center'} `;
                                        if (col.key === 'token') {
                                          return (
                                            <td key={col.key} className={cellClasses} onClick={() => handleTokenClick(stat.token)}>
                                              {content}
                                            </td>
                                          );
                                        }
                                        return (
                                          <td key={col.key} className={cellClasses}>{content}</td>
                                        );
                                      })}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            {truncated && (
                              <div className="text-xs text-gray-500 mt-2">Showing first {n} and last {n} of {total} rows. Click a header to toggle descending/ascending.</div>
                            )}
                          </div>
                        );
                      })()}
                      {showFullStatsModal && (() => {
                        // Reuse same filtering + sorting to show full table live
                        const modalRaw = results.statistics
                          .filter((stat: any) => !appliedStopSet.has(String(stat.token || '').toLowerCase()))
                          .filter((stat: any) => stat.log_likelihood_llv > 0);
                        // Rebuild columns with labels & formatters (duplicate of earlier definition to keep scope simple)
                        const columns = [
                          { key: 'token', label: 'Token', accessor: (s: any) => s.token },
                          { key: 'freq_corpus_0', label: 'O1', accessor: (s: any) => s.freq_corpus_0, formatter: (v: any) => formatNumber(v, 0) },
                          { key: 'percent_corpus_0', label: '%1', accessor: (s: any) => s.percent_corpus_0, formatter: (v: any) => formatNumber(v, 2, { suffix: '%' }) },
                          { key: 'freq_corpus_1', label: 'O2', accessor: (s: any) => s.freq_corpus_1, formatter: (v: any) => formatNumber(v, 0) },
                          { key: 'percent_corpus_1', label: '%2', accessor: (s: any) => s.percent_corpus_1, formatter: (v: any) => formatNumber(v, 2, { suffix: '%' }) },
                          { key: 'log_likelihood_llv', label: 'LL', accessor: (s: any) => s.log_likelihood_llv, formatter: (v: any) => formatNumber(v, 2) },
                          { key: 'percent_diff', label: '%DIFF', accessor: (s: any) => s.percent_diff, formatter: (v: any) => formatNumber(v, 2, { suffix: '%', multiplier: 100 }) },
                          { key: 'bayes_factor_bic', label: 'Bayes', accessor: (s: any) => s.bayes_factor_bic, formatter: (v: any) => formatNumber(v, 2) },
                          { key: 'effect_size_ell', label: 'ELL', accessor: (s: any) => s.effect_size_ell, formatter: (v: any) => formatNumber(v, 4, { fallback: 'N/A' }) },
                          { key: 'relative_risk', label: 'RRisk', accessor: (s: any) => s.relative_risk, formatter: (v: any) => formatNumber(v, 2, { fallback: '∞' }) },
                          { key: 'log_ratio', label: 'LogRatio', accessor: (s: any) => s.log_ratio, formatter: (v: any) => formatNumber(v, 4, { fallback: 'N/A' }) },
                          { key: 'odds_ratio', label: 'OddsRatio', accessor: (s: any) => s.odds_ratio, formatter: (v: any) => formatNumber(v, 2, { fallback: '∞' }) },
                          { key: 'significance', label: 'Significance', accessor: (s: any) => s.significance || '', formatter: (_: any, s: any) => (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              s.significance === '****' ? 'bg-red-100 text-red-800' :
                              s.significance === '***' ? 'bg-orange-100 text-orange-800' :
                              s.significance === '**' ? 'bg-yellow-100 text-yellow-800' :
                              s.significance === '*' ? 'bg-green-100 text-green-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {s.significance || 'n.s.'}
                            </span>) }
                        ];
                        // Re-create columns definition to access inside this closure
                        const modalColumns = [
                          { key: 'token', accessor: (s: any) => s.token },
                          { key: 'freq_corpus_0', accessor: (s: any) => s.freq_corpus_0 },
                          { key: 'percent_corpus_0', accessor: (s: any) => s.percent_corpus_0 },
                          { key: 'freq_corpus_1', accessor: (s: any) => s.freq_corpus_1 },
                          { key: 'percent_corpus_1', accessor: (s: any) => s.percent_corpus_1 },
                          { key: 'log_likelihood_llv', accessor: (s: any) => s.log_likelihood_llv },
                          { key: 'percent_diff', accessor: (s: any) => s.percent_diff },
                          { key: 'bayes_factor_bic', accessor: (s: any) => s.bayes_factor_bic },
                          { key: 'effect_size_ell', accessor: (s: any) => s.effect_size_ell },
                          { key: 'relative_risk', accessor: (s: any) => s.relative_risk },
                          { key: 'log_ratio', accessor: (s: any) => s.log_ratio },
                          { key: 'odds_ratio', accessor: (s: any) => s.odds_ratio },
                          { key: 'significance', accessor: (s: any) => s.significance || '' }
                        ];
                        const modalSorted = (() => {
                          const colActive = statsSortColumn || 'log_likelihood_llv';
                          return [...modalRaw].sort((a, b) => {
                            const col = statsSortColumn;
                            if (col === 'significance') {
                              const rank = (s: any) => (s.significance || '').length;
                              const va = rank(a); const vb = rank(b);
                              return statsSortDirection === 'asc' ? va - vb : vb - va;
                            }
                            const def = modalColumns.find(c => c.key === colActive);
                            if (!def) return 0;
                            const va = def.accessor(a);
                            const vb = def.accessor(b);
                            if (typeof va === 'string' || typeof vb === 'string') {
                              const sa = (va ?? '').toString();
                              const sb = (vb ?? '').toString();
                              if (sa < sb) return statsSortDirection === 'asc' ? -1 : 1;
                              if (sa > sb) return statsSortDirection === 'asc' ? 1 : -1;
                              return 0;
                            }
                            const na = (va === null || va === undefined || Number.isNaN(va)) ? -Infinity : va;
                            const nb = (vb === null || vb === undefined || Number.isNaN(vb)) ? -Infinity : vb;
                            return statsSortDirection === 'asc' ? na - nb : nb - na;
                          });
                        })();

                        // Pagination over sorted rows (number_of_columns)
                        const totalRows = modalSorted.length;
                        const totalPages = Math.max(1, Math.ceil(totalRows / modalPageSize));
                        const currentPage = Math.min(modalPage, totalPages);
                        const startIndex = (currentPage - 1) * modalPageSize;
                        const pageRows = modalSorted.slice(startIndex, startIndex + modalPageSize);

                        // CSV download for full sorted table
                        const handleDownloadCSV = () => {
                          const headers = columns.map(c => c.label);
                          const csvEscape = (val: any) => {
                            const s = (val === null || val === undefined) ? '' : String(val);
                            const needsQuotes = /[",\n]/.test(s);
                            const escaped = s.replace(/"/g, '""');
                            return needsQuotes ? `"${escaped}"` : escaped;
                          };
              const toCSVVal = (colKey: string, stat: any) => {
                            switch (colKey) {
                              case 'token':
                                return stat.token;
                              case 'freq_corpus_0':
                                return formatNumber(stat.freq_corpus_0, 0, { fallback: '' });
                              case 'percent_corpus_0':
                                return formatNumber(stat.percent_corpus_0, 2, { suffix: '%', fallback: '' });
                              case 'freq_corpus_1':
                                return formatNumber(stat.freq_corpus_1, 0, { fallback: '' });
                              case 'percent_corpus_1':
                                return formatNumber(stat.percent_corpus_1, 2, { suffix: '%', fallback: '' });
                              case 'log_likelihood_llv':
                                return formatNumber(stat.log_likelihood_llv, 2, { fallback: '' });
                              case 'percent_diff':
                                return formatNumber(stat.percent_diff, 2, { suffix: '%', multiplier: 100, fallback: '' });
                              case 'bayes_factor_bic':
                                return formatNumber(stat.bayes_factor_bic, 2, { fallback: '' });
                              case 'effect_size_ell':
                                return formatNumber(stat.effect_size_ell, 4, { fallback: '' });
                              case 'relative_risk':
                                return formatNumber(stat.relative_risk, 2, { fallback: 'inf' });
                              case 'log_ratio':
                                return formatNumber(stat.log_ratio, 4, { fallback: '' });
                              case 'odds_ratio':
                                return formatNumber(stat.odds_ratio, 2, { fallback: 'inf' });
                              case 'significance':
                                return stat.significance || 'n.s.';
                              default:
                                return '';
                            }
                          };
                          const rows = modalSorted.map(stat => columns.map(c => csvEscape(toCSVVal(c.key, stat))).join(','));
                          const csv = [headers.join(','), ...rows].join('\n');
                          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          const ts = new Date().toISOString().replace(/[:.]/g, '-');
                          link.href = url;
                          link.download = `token_frequency_table_${ts}.csv`;
                          link.click();
                          URL.revokeObjectURL(url);
                        };
                        return (
                          <div className="fixed inset-0 z-50 flex items-center justify-center">
                            <div className="absolute inset-0 bg-black/40" onClick={() => setShowFullStatsModal(false)}></div>
                            <div className="relative bg-white rounded-lg shadow-xl max-w-[95vw] max-h-[90vh] w-full p-6 flex flex-col">
                              <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                  <h4 className="text-lg font-semibold text-gray-800">Complete Statistical Table ({modalSorted.length} rows)</h4>
                                  <label className="text-sm text-gray-600 flex items-center gap-2">
                                    <span className="font-mono">number_of_columns</span>
                                    <select
                                      className="border rounded px-2 py-1 text-sm"
                                      value={modalPageSize}
                                      onChange={(e) => { setModalPageSize(parseInt(e.target.value, 10)); setModalPage(1); }}
                                    >
                                      <option value={10}>10</option>
                                      <option value={20}>20</option>
                                      <option value={50}>50</option>
                                      <option value={100}>100</option>
                                      <option value={200}>200</option>
                                    </select>
                                  </label>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={handleDownloadCSV}
                                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                                  >Download CSV</button>
                                  <button
                                    onClick={() => setShowFullStatsModal(false)}
                                    className="px-3 py-1 text-sm bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
                                  >Close</button>
                                </div>
                              </div>
                              <div className="overflow-auto border border-gray-200 rounded">
                                <table className="min-w-full text-sm">
                                  <thead className="bg-gray-50">
                                    <tr>
                                      {columns.map((col: any) => {
                                        const active = statsSortColumn === col.key;
                                        const dir = active ? (statsSortDirection === 'asc' ? '▲' : '▼') : '';
                                        return (
                                          <th
                                            key={col.key}
                                            className={`px-3 py-2 text-left font-medium uppercase tracking-wider cursor-pointer select-none whitespace-nowrap ${active ? 'text-blue-600' : 'text-gray-500'} hover:bg-gray-100`}
                                            onClick={() => {
                                              if (statsSortColumn === col.key) {
                                                setStatsSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                                              } else {
                                                setStatsSortColumn(col.key);
                                                setStatsSortDirection(col.key === 'token' ? 'asc' : 'desc');
                                              }
                                              setModalPage(1);
                                            }}
                                          >
                                            <div className="flex items-center gap-1"><span>{col.label}</span>{dir && <span className="text-[10px]">{dir}</span>}</div>
                                          </th>
                                        );
                                      })}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {pageRows.map((stat, i) => (
                                      <tr key={stat.token + i} className={((startIndex + i) % 2 === 0) ? 'bg-white' : 'bg-gray-50'}>
                                        {columns.map((col: any) => {
                                          const rawVal = col.accessor(stat);
                                          const content = col.formatter ? col.formatter(rawVal, stat) : rawVal;
                                          const cellClasses = `px-3 py-1.5 ${col.key === 'token' ? 'font-medium text-blue-600 cursor-pointer hover:text-blue-800 hover:bg-blue-50' : 'font-mono text-gray-900 text-center'} whitespace-nowrap`;
                                          if (col.key === 'token') {
                                            return <td key={col.key} className={cellClasses} onClick={() => handleTokenClick(stat.token)}>{content}</td>;
                                          }
                                          return <td key={col.key} className={cellClasses}>{content}</td>;
                                        })}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <div className="mt-3 flex items-center justify-between">
                                <div className="text-xs text-gray-500">Click headers to sort; table updates live.</div>
                                <div className="flex items-center gap-2">
                                  <button
                                    className={`px-2 py-1 text-xs rounded ${currentPage <= 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
                                    onClick={() => currentPage > 1 && setModalPage(currentPage - 1)}
                                    disabled={currentPage <= 1}
                                  >Prev</button>
                                  <span className="text-xs text-gray-700">Page {currentPage} of {totalPages}</span>
                                  <button
                                    className={`px-2 py-1 text-xs rounded ${currentPage >= totalPages ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
                                    onClick={() => currentPage < totalPages && setModalPage(currentPage + 1)}
                                    disabled={currentPage >= totalPages}
                                  >Next</button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                      
                      {(results.statistics
                        .filter((stat: any) => !appliedStopSet.has(String(stat.token || '').toLowerCase()))
                        .filter((stat: any) => stat.log_likelihood_llv > 0).length === 0) && (
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
