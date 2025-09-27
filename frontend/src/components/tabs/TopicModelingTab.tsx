import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import NodeSelectionPanel from '../NodeSelectionPanel';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../hooks/useWorkspaceSelection';
import { useAuth } from '../../hooks/useAuth';
// Updated to use modular API object pattern
import { textApi } from '../../api/text';
import type { TopicModelingRequest } from '../../api/text';
import { workspacesApi } from '../../api/workspaces';
import { nodesApi } from '../../api/nodes';
import { useAnalysisStore } from '../../stores/analysisStore';
import useAutoNodeColumns from '../../hooks/useAutoNodeColumns';
import useNodeColumnInfos from '../../hooks/useNodeColumnInfos';
// Define local lightweight response/topic interfaces if not exported (legacy code referenced these)
interface TopicModelingTopic { id: number; label: string; size: number[]; total_size: number; x: number; y: number; }
interface TopicModelingResponse { state?: 'running' | 'successful' | 'failed' | 'cancelled'; message?: string; data?: { topics: TopicModelingTopic[]; corpus_sizes?: number[] }; metadata?: { task_id?: string; [k: string]: any } }

interface NodeColumnSelection { nodeId: string; column: string; }

// Simple linear gradient between two colors given t in [0,1]
function interpolateColor(c1: string, c2: string, t: number) {
  const parse = (c: string) => c.replace('#','').match(/.{2}/g)!.map(x=>parseInt(x,16));
  const [r1,g1,b1] = parse(c1); const [r2,g2,b2] = parse(c2);
  const r = Math.round(r1 + (r2-r1)*t); const g = Math.round(g1 + (g2-g1)*t); const b = Math.round(b1 + (b2-b1)*t);
  return `rgb(${r}, ${g}, ${b})`;
}

const TopicModelingTab: React.FC = () => {
  const { selectedNodes } = useWorkspaceSelection();
  const { currentWorkspaceId, getNodeShape } = useWorkspaceData();
  const { getAuthHeaders } = useAuth();
  const tasks = useAnalysisStore((state: any) => state.tasks);
  const topicModelingReadyTaskId = useAnalysisStore((state: any) => state.topicModelingReadyTaskId);
  const topicModelingReadyTimestamp = useAnalysisStore((state: any) => state.topicModelingReadyTimestamp);
  const resetTopicModelingReady = useAnalysisStore((state: any) => state.resetTopicModelingReady);
  const [isRunning, setIsRunning] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const runningRef = useRef<boolean>(false);
  const [lockedNodesSnapshot, setLockedNodesSnapshot] = useState<Array<{ id: string; name: string; columns: string[] }>>([]);
  const [lockedNodeSelections, setLockedNodeSelections] = useState<NodeColumnSelection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TopicModelingResponse | null>(null);
  const resultRef = useRef<TopicModelingResponse | null>(null); // Track result to prevent downgrades
  
  // Safe setResult wrapper that prevents downgrades from successful to running
  const setResultSafely = useCallback((newResult: TopicModelingResponse | null) => {
    // Prevent downgrading from successful to running (race condition fix)
    if (resultRef.current?.state === 'successful' && newResult?.state === 'running') {
      console.log('TopicModelingTab: Ignoring stale running update that would hide successful results');
      return;
    }

    setResult(newResult);
    resultRef.current = newResult;
  }, []);
  
  const [minTopicSize, setMinTopicSize] = useState(5);
  const [useCtTfidf, setUseCtTfidf] = useState(false);
  const [nodeColors, setNodeColors] = useState<Record<string,string>>({});
  const [isClearing, setIsClearing] = useState(false);
  const [hoveredTopicId, setHoveredTopicId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{x:number;y:number; topic: TopicModelingTopic | null}>({x:0,y:0,topic:null});
  const containerRef = useRef<HTMLDivElement | null>(null); // overall card
  const chartRef = useRef<HTMLDivElement | null>(null); // chart area
  const [chartWidth, setChartWidth] = useState<number>(800);
  const lastFetchedRef = useRef<{ taskId: string | null; state: 'successful' | 'failed' | null }>({ taskId: null, state: null });

  useEffect(() => {
    lastFetchedRef.current = { taskId: null, state: null };
    resetTopicModelingReady();
  }, [currentWorkspaceId, resetTopicModelingReady]);

  const fetchTopicModelingResult = useCallback(
    async (taskId: string | null, expectedState: 'successful' | 'failed') => {
      if (!currentWorkspaceId) return;
      if (
        taskId &&
        lastFetchedRef.current.taskId === taskId &&
        lastFetchedRef.current.state === expectedState
      ) {
        return;
      }

      try {
        const rr = await textApi.getTopicModelingCurrentResult(currentWorkspaceId, getAuthHeaders());
        if (!rr) return;

        setResultSafely(rr as any);

        if (rr.state === 'successful') {
          setIsLocked(true);
          setIsRunning(false);
          runningRef.current = false;
          setError(null);
          lastFetchedRef.current = { taskId: taskId ?? null, state: 'successful' };
        } else if (rr.state === 'failed') {
          setIsLocked(true);
          setIsRunning(false);
          runningRef.current = false;
          setError(rr.message || 'Topic modeling failed');
          lastFetchedRef.current = { taskId: taskId ?? null, state: 'failed' };
        }
      } catch (error) {
        console.warn('Failed to fetch topic modeling result', error);
      }
    },
    [currentWorkspaceId, getAuthHeaders, setResultSafely]
  );

  // Observe container width for responsive sizing
  useEffect(()=>{
    const el = chartRef.current;
    if(!el) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w) setChartWidth(w);
      }
    });
    observer.observe(el);
    setChartWidth(el.getBoundingClientRect().width);
    return ()=> observer.disconnect();
  },[]);

  const defaultPalette = useMemo(()=>['#2563eb','#dc2626','#16a34a','#9333ea','#0d9488','#db2777'],[]);

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
  });

  const { selections: nodeColumnSelections, setSelection: setNodeColumnSelection, setSelections: setNodeColumnSelectionsRaw, recompute: recomputeAutoColumns } = useAutoNodeColumns({
    selectedNodes,
    getNodeColumns: getColumnInfos,
    allowedDataTypes: ['string'],
  }, { workspaceId: currentWorkspaceId, maxNodes: 2, isLocked, docTypeOnly: true, enableHeuristicGuess: false });

  // Ensure colors assigned
  useEffect(()=>{
    setNodeColors(prev=>{
      const out = { ...prev };
      let i=0; selectedNodes.forEach(n=>{ if(!out[n.id]) { out[n.id] = defaultPalette[i % defaultPalette.length]; i++; } });
      return out;
    });
  },[selectedNodes, defaultPalette]);

  useEffect(() => {
    if (!isLocked && selectedNodes.length > 0 && nodeColumnSelections.length === 0) {
      recomputeAutoColumns();
    }
  }, [isLocked, selectedNodes, nodeColumnSelections, recomputeAutoColumns]);

  const handleColumnChange = (nodeId: string, column: string) => {
    if (isLocked) return;
    setNodeColumnSelection(nodeId, column);
  };
  const handleColorChange = (nodeId: string, color: string) => setNodeColors(p=>({...p,[nodeId]:color}));

  const handleRun = async () => {
    if (!currentWorkspaceId || !selectedNodes.length) return;
    if (runningRef.current) return; // guard double click
    const firstTwo = selectedNodes.slice(0,2);
    if (firstTwo.some(n=> !nodeColumnSelections.find(s=>s.nodeId===n.id)?.column)) {
      alert('Select a text column for all selected nodes'); return;
    }
    lastFetchedRef.current = { taskId: null, state: null };
    resetTopicModelingReady();
    // Optimistically enter running state immediately
    setIsRunning(true);
    runningRef.current = true;
    setError(null);
    setResultSafely(null);
    try {
  const node_columns: Record<string,string> = {};
  nodeColumnSelections.forEach(s=>{ if(s.column) node_columns[s.nodeId]=s.column; });
      const req: TopicModelingRequest = {
        node_ids: firstTwo.map(n=>n.id),
        node_columns,
        min_topic_size: minTopicSize,
        use_ctfidf: useCtTfidf
      };
      const res = await textApi.topicModeling(currentWorkspaceId, req, getAuthHeaders());
      setResultSafely(res);
  if (res.state === 'running') {
        // lock immediately while task is running
        setIsLocked(true);
        // SSE will provide task updates automatically, no need to manually fetch
  } else if (res.state === 'failed') {
        // Immediate failure (validation etc.)
        setIsRunning(false);
        runningRef.current = false;
        setIsLocked(false);
      }
  if (res.state !== 'successful' && res.state !== 'running') setError(res.message || 'Topic modeling failed');
      // Lock with snapshot
      try {
        const ids = firstTwo.map(n=>n.id);
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
        const lockedSelections = nodeColumnSelections.filter(sel => ids.includes(sel.nodeId));
        setLockedNodeSelections(lockedSelections);
        setIsLocked(true);
      } catch { /* ignore */ }
    } catch (e:any) {
      setError(e?.message || 'Error running topic modeling');
      // Exit running state on error
      setIsRunning(false);
      runningRef.current = false;
    }
  };

  const topics: TopicModelingTopic[] = useMemo(()=> result?.data?.topics || [], [result]);
  const corpusCount = result?.data?.corpus_sizes?.length || 0;

  // Helpers to render colored size boxes
  const getReadableTextColor = (hex: string) => {
    if(!hex) return '#ffffff';
    const c = hex.replace('#','');
    if (c.length !== 6) return '#ffffff';
    const r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16);
    // luminance
    const l = 0.2126*r + 0.7152*g + 0.0722*b;
    return l > 160 ? '#1e293b' : '#ffffff';
  };
  const renderSizeComposition = (sizes: number[], total: number) => {
    if (corpusCount === 0) return null;
    if (sizes.length === 1) {
      const color = selectedNodes[0] ? nodeColors[selectedNodes[0].id] : '#2563eb';
      const fg = getReadableTextColor(color);
      return (
        <span className="inline-flex items-center gap-1">
          <span style={{ background: color, color: fg }} className="px-1.5 py-0.5 rounded text-[10px] font-medium">{sizes[0]}</span>
          <span className="text-[10px] text-gray-500">= {total}</span>
        </span>
      );
    }
    // Two corpora: show N + M = Z boxes with colors
    const colorA = selectedNodes[0] ? nodeColors[selectedNodes[0].id] : '#2563eb';
    const colorB = selectedNodes[1] ? nodeColors[selectedNodes[1].id] : '#dc2626';
    const fgA = getReadableTextColor(colorA);
    const fgB = getReadableTextColor(colorB);
    return (
      <span className="inline-flex items-center gap-1 flex-wrap">
        <span style={{ background: colorA, color: fgA }} className="px-1.5 py-0.5 rounded text-[10px] font-medium">{sizes[0]}</span>
        <span className="text-[10px] text-gray-500">+</span>
        <span style={{ background: colorB, color: fgB }} className="px-1.5 py-0.5 rounded text-[10px] font-medium">{sizes[1]}</span>
        <span className="text-[10px] text-gray-500">= {total}</span>
      </span>
    );
  };

  // Layout bubbles simply using returned coordinates scaled
  const bubbleElements = useMemo(()=>{
    if(!topics.length) return null;
    const xs = topics.map(t=>t.x); const ys = topics.map(t=>t.y);
    const xMin=Math.min(...xs), xMax=Math.max(...xs), yMin=Math.min(...ys), yMax=Math.max(...ys);
    const pad = 40; const width=chartWidth; const height=Math.min(520, Math.max(320, Math.round(width * 0.55)));
    const scaleX = (x:number)=> ( (x - xMin)/(xMax-xMin || 1) )*(width-2*pad)+pad;
    const scaleY = (y:number)=> ( (y - yMin)/(yMax-yMin || 1) )*(height-2*pad)+pad;
    const maxSize = Math.max(...topics.map(t=>t.total_size));
    return (
      <svg
        width={width}
        height={height}
        className="border rounded bg-white block w-full"
        role="img"
        aria-label="Topic bubble chart"
        onMouseLeave={()=>{ setHoveredTopicId(null); setTooltip(t=>({...t,topic:null})); }}
      >
        {topics.map((t)=>{
          const sizes = t.size || [];
            const prop = (corpusCount===2 && (t.total_size>0)) ? (sizes[0]/t.total_size) : 0.5;
            const colorA = selectedNodes[0] ? nodeColors[selectedNodes[0].id] : '#2563eb';
            const colorB = selectedNodes[1] ? nodeColors[selectedNodes[1].id] : '#dc2626';
            const fill = interpolateColor(colorA, colorB, prop);
            const r = 10 + 40 * Math.sqrt(t.total_size / (maxSize || 1));
            const cx = scaleX(t.x); const cy = scaleY(t.y);
            const isHovered = hoveredTopicId === t.id;
            return (
              <g
                key={t.id}
                transform={`translate(${cx},${cy})`}
                onMouseEnter={(e)=>{
                  setHoveredTopicId(t.id);
                  const bbox = (chartRef.current?.getBoundingClientRect());
                  if (bbox) {
                    setTooltip({
                      x: e.clientX - bbox.left + 12,
                      y: e.clientY - bbox.top + 12,
                      topic: t
                    });
                  }
                }}
                onMouseMove={(e)=>{
                  if(!chartRef.current) return;
                  const bbox = chartRef.current.getBoundingClientRect();
                  setTooltip(tp=> tp.topic && tp.topic.id===t.id ? { x: e.clientX - bbox.left + 12, y: e.clientY - bbox.top + 12, topic: t } : tp);
                }}
                onMouseLeave={()=>{ setHoveredTopicId(null); setTooltip(tp=> ({...tp, topic:null})); }}
              >
                <circle r={r} fill={fill} fillOpacity={isHovered?0.92:0.7} stroke={isHovered? '#1d4ed8':'#334155'} strokeWidth={isHovered?2:1} />
                <text textAnchor="middle" dy={4} fontSize={12} className="pointer-events-none select-none" fill="#1e293b">
                  {`T${t.id}`}
                </text>
              </g>
            );
        })}
      </svg>
    );
  },[topics, corpusCount, selectedNodes, nodeColors, chartWidth, hoveredTopicId]);

// Hydration from backend once per mount - simplified to avoid race conditions
  const hydratedOnceRef = useRef<boolean>(false);
  useEffect(() => {
    (async () => {
      if (hydratedOnceRef.current || !currentWorkspaceId) return;
      hydratedOnceRef.current = true;
      
      try {
        // First check current-request to restore UI state
        const reqResp = await textApi.getTopicModelingCurrentRequest(currentWorkspaceId, getAuthHeaders());
        if (!reqResp) return; // No current request - fresh state
        
        // Restore request parameters to UI
        const req = (reqResp as any)?.data;
        if (req) {
          const nodeIds: string[] = Array.isArray(req.node_ids) ? req.node_ids.slice(0,2) : [];
          const node_columns: Record<string,string> = req.node_columns || {};
          const sels = nodeIds.map((id: string) => ({ nodeId: id, column: node_columns[id] || '' }));
          setNodeColumnSelectionsRaw(sels, { replace: true });
          setLockedNodeSelections(sels);
          setMinTopicSize(Number(req.min_topic_size ?? 5));
          setUseCtTfidf(!!req.use_ctfidf);
          
          // Create locked node snapshots for UI display
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
          if (snaps.length) setLockedNodesSnapshot(snaps);
        }
        
        // Now get current result state
        const resResp = await textApi.getTopicModelingCurrentResult(currentWorkspaceId, getAuthHeaders());
        if (resResp) {
          const resStatus = (resResp as any)?.state;
          if (resStatus === 'successful') {
            setResultSafely(resResp as any);
            setIsLocked(true);
          } else if (resStatus === 'failed') {
            setResultSafely(resResp as any);
            setIsLocked(true);
            setIsRunning(false);
            runningRef.current = false;
          } else if (resStatus === 'running') {
            // Only set running if no successful result exists yet
            if (!resultRef.current || resultRef.current.state !== 'successful') {
              setResultSafely({ state: 'running', message: 'Task running', metadata: (resResp as any)?.metadata } as any);
              setIsLocked(true);
              runningRef.current = true;
              setIsRunning(true);
            }
          }
        }
      } catch (error) {
        console.warn('TopicModelingTab hydration failed:', error);
      }
    })();
  }, [currentWorkspaceId, getAuthHeaders]);

  // React to task state changes for running state management
  useEffect(() => {
    if (!tasks || !tasks.length) {
      if (runningRef.current) {
        setIsRunning(false);
        runningRef.current = false;
      }
      return;
    }

    const tmTasks = tasks.filter((t: any) => t.task_type === 'topic_modeling');
    if (!tmTasks.length) {
      if (runningRef.current) {
        setIsRunning(false);
        runningRef.current = false;
      }
      return;
    }

    const hasRunningTM = tmTasks.some((t: any) => t.state === 'running');
    const failedTask = tmTasks.find((t: any) => t.state === 'failed');
    const successfulTask = tmTasks.find((t: any) => t.state === 'successful' && t.result_persisted);

    if (hasRunningTM) {
      setIsLocked(true);
      setIsRunning(true);
      runningRef.current = true;
    } else if (!failedTask) {
      if (runningRef.current) {
        setIsRunning(false);
        runningRef.current = false;
      }
    }

    if (successfulTask?.task_id) {
      setIsLocked(true);
      setIsRunning(false);
      runningRef.current = false;
      void fetchTopicModelingResult(successfulTask.task_id, 'successful');
    } else if (failedTask?.task_id) {
      setIsLocked(true);
      setIsRunning(false);
      runningRef.current = false;
      void fetchTopicModelingResult(failedTask.task_id, 'failed');
    }
  }, [tasks, fetchTopicModelingResult]);

  // React to explicit ready markers from task stream (covers persisted results without state change yet)
  useEffect(() => {
    if (!topicModelingReadyTaskId) return;

    (async () => {
      await fetchTopicModelingResult(topicModelingReadyTaskId, 'successful');
      resetTopicModelingReady();
    })();
  }, [topicModelingReadyTaskId, topicModelingReadyTimestamp, fetchTopicModelingResult, resetTopicModelingReady]);

  // If result failed, keep the panel locked and run disabled until cleared
  useEffect(() => {
  if (result && result.state === 'failed') {
      setIsLocked(true);
      setIsRunning(false);
      runningRef.current = false;
    }
  }, [result]);

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-800">Topic Modeling (BERTopic)</h2>
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
                  <li>Clear results to unlock and resync with the graph selection.</li>
                </ul>
              </div>
            </div>
          )}
        </div>
        <div className="mb-6">
          <NodeSelectionPanel
            selectedNodes={(isLocked && lockedNodesSnapshot.length)
              ? lockedNodesSnapshot.map(s=>({ id: s.id, name: s.name, data: { name: s.name, nodeName: s.name, label: s.name, columns: s.columns }, columns: s.columns }))
              : selectedNodes}
            nodeColumnSelections={(isLocked && lockedNodeSelections) ? lockedNodeSelections : nodeColumnSelections}
            onColumnChange={handleColumnChange}
            nodeColors={nodeColors}
            onColorChange={handleColorChange}
            getNodeColumns={getColumnInfos}
            defaultPalette={defaultPalette}
            maxCompare={2}
            disabled={!!isLocked}
            showShape
            getNodeShapeFn={getNodeShape}
            showColorPicker
            locked={!!isLocked}
            allowedDataTypes={['string']}
          />
        </div>

        {/* Configuration */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Min Topic Size</label>
            <input
              type="number"
              min={2}
              value={minTopicSize}
              onChange={e=>setMinTopicSize(parseInt(e.target.value)||5)}
              disabled={!!isLocked}
              className="w-full md:w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
          </div>
          <div>
            <label className="flex items-center">
              <input id="useCtTfidf" type="checkbox" checked={useCtTfidf} onChange={e=>setUseCtTfidf(e.target.checked)} disabled={!!isLocked} className="mr-2" />
              <span className="text-sm text-gray-700">Use c-TF-IDF embeddings</span>
            </label>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 items-center">
          <button
            onClick={handleRun}
            disabled={isRunning || !!isLocked || !!result || !selectedNodes.length || selectedNodes.slice(0,2).some(n=> !nodeColumnSelections.find(s=>s.nodeId===n.id)?.column)}
            className="w-full md:w-auto px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {isRunning ? 'Running...' : 'Run Topic Modeling'}
          </button>
          <button
            onClick={async () => {
              if (!currentWorkspaceId) return;
              setIsClearing(true);
              try {
                // Cancel any running topic_modeling tasks first
                try { await workspacesApi.cancelTasks(currentWorkspaceId, { task_type: 'topic_modeling' }, getAuthHeaders()); } catch {}
                // Clear saved analyses
                try { await workspacesApi.clearAnalysis(currentWorkspaceId, 'topic_modeling', getAuthHeaders()); } catch {}
              } finally {
                setIsClearing(false);
                // Reset local state
                setResultSafely(null);
                setIsLocked(false);
                setLockedNodesSnapshot([]);
                setLockedNodeSelections(null);
                setIsRunning(false);
                runningRef.current = false;
                resetTopicModelingReady();
                lastFetchedRef.current = { taskId: null, state: null };
                setNodeColumnSelectionsRaw([], { replace: true, persist: false });
                recomputeAutoColumns();
              }
            }}
            disabled={isClearing || (!result && !isLocked && !isRunning) || !currentWorkspaceId}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            title={!result && !isLocked && !isRunning ? 'No results to clear' : 'Clear results'}
          >
            {isClearing ? 'Clearing…' : 'Clear Results'}
          </button>
        </div>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
  {result && result.state === 'running' && (
          <div className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            Topic modeling task started and is running in the background{result?.metadata?.task_id ? ` (task ${result.metadata.task_id})` : ''}. See Tasks list for progress.
          </div>
        )}
  {result && result.state === 'failed' && (
          <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            {result.message || 'Topic modeling failed'}
          </div>
        )}
      </div>
  {result && result.state === 'successful' && (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200" ref={containerRef}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-md font-semibold text-gray-800">Topics ({topics.length})</h3>
            <div className="text-xs text-gray-500">Colors blend by proportion of first vs second corpus</div>
          </div>
          <div className="relative w-full" ref={chartRef}>
            {bubbleElements}
            {tooltip.topic && (
              <div
                className="absolute pointer-events-none bg-white border border-gray-300 shadow-lg rounded p-3 text-xs z-10 max-w-xs"
                style={{ left: tooltip.x, top: tooltip.y }}
              >
                <div className="text-sm font-semibold mb-1">Topic {tooltip.topic.id}</div>
                <div className="text-[10px] text-gray-600 leading-snug mb-1 break-words">{tooltip.topic.label}</div>
                <div className="mt-1">{renderSizeComposition(tooltip.topic.size, tooltip.topic.total_size)}</div>
              </div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            {topics.slice(0,10).map(t=> {
              const isHovered = hoveredTopicId === t.id;
              return (
                <div
                  key={t.id}
                  className={`p-2 rounded border bg-gray-50 transition-shadow ${isHovered ? 'ring-2 ring-blue-500 shadow-md' : ''}`}
                  onMouseEnter={()=>setHoveredTopicId(t.id)}
                  onMouseLeave={()=>setHoveredTopicId(null)}
                >
                  <div className="font-medium text-gray-700">Topic {t.id}</div>
                  <div className="text-xs text-gray-600 truncate" title={t.label}>{t.label}</div>
                  <div className="mt-1">{renderSizeComposition(t.size, t.total_size)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
  {result && result.state === 'failed' && (
        <div className="bg-white p-4 rounded border text-sm text-red-600">{result.message}</div>
      )}
    </div>
  );
};

export default TopicModelingTab;
