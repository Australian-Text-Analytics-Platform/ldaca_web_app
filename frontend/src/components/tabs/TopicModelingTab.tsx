/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import NodeSelectionPanel, { WorkspaceNodeLike } from '../NodeSelectionPanel';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../hooks/useWorkspaceSelection';
import { useAuth } from '../../hooks/useAuth';
// Updated to use modular API object pattern
import { textApi } from '../../api/text';
import type { TopicModelingRequest } from '../../api/text';
import { workspacesApi } from '../../api/workspaces';
import { getNodeInfo } from '../../lib/nodeInfoCache';
import { useAnalysisStore } from '../../stores/analysisStore';
import useNodeColumnInfos from '../../hooks/useNodeColumnInfos';
import { useAnalysisLockState } from '../../hooks/useAnalysisLockState';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import { AlertTriangle, Loader2, Play, Trash2 } from 'lucide-react';
import { applySelectedColumnsToSnapshots } from '../../hooks/useSchemaManagement';
import AnalysisLockedNotice from './AnalysisLockedNotice';
// Define local lightweight response/topic interfaces if not exported (legacy code referenced these)
interface TopicModelingTopic { id: number; label: string; size: number[]; total_size: number; x: number; y: number; }
interface TopicModelingResponse { state?: 'running' | 'successful' | 'failed' | 'cancelled'; message?: string; data?: { topics: TopicModelingTopic[]; corpus_sizes?: number[] }; metadata?: { task_id?: string; [k: string]: any } }

const resolveWorkspaceNodeId = (node: WorkspaceNodeLike, fallbackIndex: number): string => {
  const candidates = [
    node.id,
    node.node_id,
    node.data?.id,
    node.data?.node_id,
    node.unique_id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  return `node-${fallbackIndex}`;
};

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
  const {
    isLocked,
    setIsLocked,
    lockWithSnapshots,
    unlockSelection,
    nodeColumnSelections,
    setNodeColumnSelection,
    setNodeColumnSelections,
    recomputeAutoColumns,
    activeNodeIds,
    activeNodeColumnSelections,
    panelSelectedNodes,
    displayNodeCount,
  } = useAnalysisLockState({
    allowedDataTypes: ['string'],
    maxNodes: 2,
    docTypeOnly: true,
    enableHeuristicGuess: false,
  });
  const runningRef = useRef<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TopicModelingResponse | null>(null);
  const resultRef = useRef<TopicModelingResponse | null>(null); // Track result to prevent downgrades
  
  // Safe setResult wrapper that prevents downgrades from successful to running
  const setResultSafely = useCallback((newResult: TopicModelingResponse | null) => {
    // Prevent downgrading from successful to running (race condition fix)
    if (resultRef.current?.state === 'successful' && newResult?.state === 'running') {
      console.debug('TopicModelingTab: Ignoring stale running update that would hide successful results');
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
  [currentWorkspaceId, getAuthHeaders, setIsLocked, setResultSafely]
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

  const panelNodeIds = useMemo<string[]>(() => (
    panelSelectedNodes
      .slice(0, 2)
      .map((node, idx) => resolveWorkspaceNodeId(node, idx) || activeNodeIds[idx])
      .filter((id): id is string => Boolean(id))
  ), [panelSelectedNodes, activeNodeIds]);

  const effectiveNodeColumnSelections = useMemo(() => (
    isLocked ? activeNodeColumnSelections : nodeColumnSelections
  ), [isLocked, activeNodeColumnSelections, nodeColumnSelections]);

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
  });

  const panelHasMissingColumns = useMemo(() => (
    panelNodeIds.some((nodeId) => {
      const selection = effectiveNodeColumnSelections.find((sel) => sel.nodeId === nodeId);
      return !selection || !selection.column;
    })
  ), [panelNodeIds, effectiveNodeColumnSelections]);

  // Ensure colors assigned
  useEffect(()=>{
    setNodeColors(prev=>{
      const out = { ...prev };
      let paletteIndex = 0;
      panelSelectedNodes.slice(0, 2).forEach((node, idx) => {
        const nodeId = resolveWorkspaceNodeId(node, idx);
        if (!nodeId || out[nodeId]) {
          return;
        }
        out[nodeId] = defaultPalette[paletteIndex % defaultPalette.length];
        paletteIndex += 1;
      });
      return out;
    });
  },[panelSelectedNodes, defaultPalette]);

  useEffect(() => {
    if (!isLocked && panelNodeIds.length > 0 && nodeColumnSelections.length === 0) {
      recomputeAutoColumns();
    }
  }, [isLocked, panelNodeIds, nodeColumnSelections.length, recomputeAutoColumns]);

  const handleColumnChange = (nodeId: string, column: string) => {
    if (isLocked) return;
    setNodeColumnSelection(nodeId, column);
  };
  const handleColorChange = (nodeId: string, color: string) => setNodeColors(p=>({...p,[nodeId]:color}));

  const handleRun = async () => {
    if (!currentWorkspaceId || panelNodeIds.length === 0) return;
    if (runningRef.current) return; // guard double click
    if (panelHasMissingColumns) {
      alert('Select a text column for all selected nodes');
      return;
    }
  const requestNodeIds = panelNodeIds.slice(0, 2);
    lastFetchedRef.current = { taskId: null, state: null };
    resetTopicModelingReady();
    // Optimistically enter running state immediately
    setIsRunning(true);
    runningRef.current = true;
    setError(null);
    setResultSafely(null);
    try {
      const node_columns: Record<string, string> = {};
      effectiveNodeColumnSelections.forEach((selection) => {
        if (selection.column && requestNodeIds.includes(selection.nodeId)) {
          node_columns[selection.nodeId] = selection.column;
        }
      });

      const req: TopicModelingRequest = {
        node_ids: requestNodeIds,
        node_columns,
        min_topic_size: minTopicSize,
        use_ctfidf: useCtTfidf,
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

      if (res.state !== 'successful' && res.state !== 'running') {
        setError(res.message || 'Topic modeling failed');
      }

      // Lock with snapshot
      try {
        const ids = requestNodeIds;
        const snaps: Array<{ id: string; name: string; columns: string[] }> = [];

        for (const id of ids) {
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

        const lockedSelections = effectiveNodeColumnSelections.filter((sel) => ids.includes(sel.nodeId));
        const normalizedSnapshots = applySelectedColumnsToSnapshots(
          snaps,
          lockedSelections.reduce<Record<string, string | undefined>>((acc, sel) => {
            acc[sel.nodeId] = sel.column;
            return acc;
          }, {})
        );
        lockWithSnapshots(normalizedSnapshots);
      } catch {
        /* ignore */
      }
    } catch (e:any) {
      setError(e?.message || 'Error running topic modeling');
      // Exit running state on error
      setIsRunning(false);
      runningRef.current = false;
    }
  };

  const topics: TopicModelingTopic[] = useMemo(()=> result?.data?.topics || [], [result]);
  const corpusCount = result?.data?.corpus_sizes?.length || 0;

  const fallbackPrimaryColor = defaultPalette[0] ?? '#2563eb';
  const fallbackSecondaryColor = defaultPalette[1] ?? '#dc2626';

  const getPanelColor = useCallback((index: number, fallback: string) => {
    const nodeId = panelNodeIds[index];
    if (nodeId) {
      return nodeColors[nodeId] || defaultPalette[index] || fallback;
    }
    return fallback;
  }, [panelNodeIds, nodeColors, defaultPalette]);

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
      const color = getPanelColor(0, fallbackPrimaryColor);
      const fg = getReadableTextColor(color);
      return (
        <span className="inline-flex items-center gap-1">
          <span style={{ background: color, color: fg }} className="px-1.5 py-0.5 rounded text-[10px] font-medium">{sizes[0]}</span>
          <span className="text-[10px] text-gray-500">= {total}</span>
        </span>
      );
    }
    // Two corpora: show N + M = Z boxes with colors
    const colorA = getPanelColor(0, fallbackPrimaryColor);
    const colorB = getPanelColor(1, fallbackSecondaryColor);
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
            const colorA = getPanelColor(0, fallbackPrimaryColor);
            const colorB = getPanelColor(1, fallbackSecondaryColor);
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
  },[topics, corpusCount, chartWidth, hoveredTopicId, getPanelColor, fallbackPrimaryColor, fallbackSecondaryColor]);

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
          setNodeColumnSelections(sels, { replace: true });
          setMinTopicSize(Number(req.min_topic_size ?? 5));
          setUseCtTfidf(!!req.use_ctfidf);
          
          // Create locked node snapshots for UI display
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
          if (snaps.length) {
            const normalizedSnapshots = applySelectedColumnsToSnapshots(
              snaps,
              node_columns
            );
            lockWithSnapshots(normalizedSnapshots);
          }
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
  }, [currentWorkspaceId, getAuthHeaders, lockWithSnapshots, setNodeColumnSelections, setResultSafely, setIsLocked]);

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
  }, [tasks, fetchTopicModelingResult, setIsLocked]);

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
  }, [result, setIsLocked]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Topic Modeling (BERTopic)</CardTitle>
              <CardDescription>Compare up to two nodes to uncover shared topics.</CardDescription>
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
              getNodeColumns={getColumnInfos}
              defaultPalette={defaultPalette}
              maxCompare={2}
              className="border border-dashed border-muted-foreground/40 rounded-lg bg-muted/30 p-4"
              originalCount={displayNodeCount}
              disabled={!!isLocked}
              showShape
              getNodeShapeFn={getNodeShape}
              showColorPicker
              locked={!!isLocked}
              allowedDataTypes={['string']}
              lockedMessage={<AnalysisLockedNotice />}
            />

            <div className="grid gap-4 md:grid-cols-2 md:items-end">
              <div className="space-y-2 md:max-w-xs">
                <label htmlFor="minTopicSize" className="text-sm font-medium text-foreground">
                  Min Topic Size
                </label>
                <Input
                  id="minTopicSize"
                  type="number"
                  min={2}
                  value={minTopicSize}
                  onChange={e=>setMinTopicSize(parseInt(e.target.value, 10) || 5)}
                  disabled={!!isLocked}
                  className="md:w-40"
                />
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/40 p-3">
                <Checkbox
                  id="useCtTfidf"
                  checked={useCtTfidf}
                  onCheckedChange={checked=>setUseCtTfidf(checked === true)}
                  disabled={!!isLocked}
                />
                <label htmlFor="useCtTfidf" className="text-sm leading-tight text-muted-foreground">
                  Use c-TF-IDF embeddings
                </label>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={handleRun}
                disabled={isRunning || !!isLocked || !!result || panelNodeIds.length === 0 || panelHasMissingColumns}
              >
                {isRunning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Run Topic Modeling
                  </>
                )}
              </Button>

              {(result || isLocked || isRunning) && (
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full sm:w-auto"
                  onClick={async () => {
                    if (!currentWorkspaceId) return;
                    setIsClearing(true);
                    try {
                      try {
                        await workspacesApi.cancelTasks(currentWorkspaceId, { task_type: 'topic_modeling' }, getAuthHeaders());
                      } catch {
                        /* ignore cancellation errors */
                      }
                      try {
                        await textApi.clearTopicModeling(currentWorkspaceId, getAuthHeaders());
                      } catch {
                        /* ignore clear errors */
                      }
                    } finally {
                      setIsClearing(false);
                      setResultSafely(null);
                      unlockSelection();
                      setIsLocked(false);
                      setIsRunning(false);
                      runningRef.current = false;
                      resetTopicModelingReady();
                      lastFetchedRef.current = { taskId: null, state: null };
                      setNodeColumnSelections([], { replace: true, persist: false });
                      recomputeAutoColumns();
                    }
                  }}
                  disabled={isClearing || !currentWorkspaceId}
                >
                  {isClearing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Clearing…
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Clear Results
                    </>
                  )}
                </Button>
              )}
            </div>

            {error && result?.state !== 'failed' && (
              <p className="text-sm font-medium text-destructive">{error}</p>
            )}
            {result && result.state === 'failed' && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <p>{result.message || 'Topic modeling failed'}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {result && result.state === 'running' && (
          <Card className="border border-amber-200 bg-amber-50/80 shadow-sm">
            <CardContent className="flex items-center gap-3 py-4 text-sm text-amber-900">
              <div className="flex h-6 w-6 items-center justify-center rounded-full border border-amber-300 bg-white/70">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
              <p className="leading-tight">
                Topic modeling task started and is running in the background
                {result?.metadata?.task_id ? ` (task ${result.metadata.task_id})` : ''}. See Tasks list for progress.
              </p>
            </CardContent>
          </Card>
        )}

        {result && result.state === 'successful' && (
          <Card ref={containerRef}>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Topics ({topics.length})</CardTitle>
                <CardDescription>Colors blend by proportion of first vs second corpus.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative w-full overflow-hidden rounded-lg border border-muted-foreground/30 bg-background" ref={chartRef}>
                {bubbleElements}
                {tooltip.topic && (
                  <div
                    className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-border bg-card p-3 text-xs shadow-lg"
                    style={{ left: tooltip.x, top: tooltip.y }}
                  >
                    <div className="text-sm font-semibold">Topic {tooltip.topic.id}</div>
                    <div className="mt-1 break-words text-[10px] leading-snug text-muted-foreground">{tooltip.topic.label}</div>
                    <div className="mt-2">{renderSizeComposition(tooltip.topic.size, tooltip.topic.total_size)}</div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                {topics.slice(0,10).map(t=> {
                  const isHovered = hoveredTopicId === t.id;
                  return (
                    <div
                      key={t.id}
                      className={`rounded-lg border border-border bg-muted/50 p-3 transition-shadow ${isHovered ? 'ring-2 ring-primary shadow-md' : ''}`}
                      onMouseEnter={()=>setHoveredTopicId(t.id)}
                      onMouseLeave={()=>setHoveredTopicId(null)}
                    >
                      <div className="font-medium text-foreground">Topic {t.id}</div>
                      <div className="truncate text-xs text-muted-foreground" title={t.label}>{t.label}</div>
                      <div className="mt-2">{renderSizeComposition(t.size, t.total_size)}</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
  );
};

export default TopicModelingTab;
