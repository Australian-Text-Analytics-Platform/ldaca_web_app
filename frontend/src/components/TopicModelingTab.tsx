import React, { useEffect, useMemo, useRef, useState } from 'react';
import NodeSelectionPanel from './NodeSelectionPanel';
import { useWorkspace } from '../hooks/useWorkspace';
import { useAuth } from '../hooks/useAuth';
import { runTopicModeling, TopicModelingRequest, TopicModelingResponse, TopicModelingTopic } from '../api';

interface NodeColumnSelection { nodeId: string; column: string; }

// Simple linear gradient between two colors given t in [0,1]
function interpolateColor(c1: string, c2: string, t: number) {
  const parse = (c: string) => c.replace('#','').match(/.{2}/g)!.map(x=>parseInt(x,16));
  const [r1,g1,b1] = parse(c1); const [r2,g2,b2] = parse(c2);
  const r = Math.round(r1 + (r2-r1)*t); const g = Math.round(g1 + (g2-g1)*t); const b = Math.round(b1 + (b2-b1)*t);
  return `rgb(${r}, ${g}, ${b})`;
}

const TopicModelingTab: React.FC = () => {
  const { selectedNodes, currentWorkspaceId } = useWorkspace();
  const { getAuthHeaders } = useAuth();
  const [nodeColumnSelections, setNodeColumnSelections] = useState<NodeColumnSelection[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TopicModelingResponse | null>(null);
  const [minTopicSize, setMinTopicSize] = useState(5);
  const [useCtTfidf, setUseCtTfidf] = useState(false);
  const [nodeColors, setNodeColors] = useState<Record<string,string>>({});
  const [hoveredTopicId, setHoveredTopicId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{x:number;y:number; topic: TopicModelingTopic | null}>({x:0,y:0,topic:null});
  const containerRef = useRef<HTMLDivElement | null>(null); // overall card
  const chartRef = useRef<HTMLDivElement | null>(null); // chart area
  const [chartWidth, setChartWidth] = useState<number>(800);

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

  // Ensure colors assigned
  useEffect(()=>{
    setNodeColors(prev=>{
      const out = { ...prev };
      let i=0; selectedNodes.forEach(n=>{ if(!out[n.id]) { out[n.id] = defaultPalette[i % defaultPalette.length]; i++; } });
      return out;
    });
  },[selectedNodes, defaultPalette]);

  const getNodeColumns = useMemo(()=> (node: any)=>{
    if (node.data?.columns) return node.data.columns;
    if (node.data?.dtypes) return Object.keys(node.data.dtypes);
    if (node.data?.schema) return Object.keys(node.data.schema);
    return [];
  },[]);

  useEffect(()=>{
    if(!selectedNodes.length) { setNodeColumnSelections([]); return; }
    setNodeColumnSelections(prev=>{
      const next = selectedNodes.map((n:any)=>{
        const existing = prev.find(p=>p.nodeId===n.id); if(existing) return existing;
        const cols = getNodeColumns(n);
        const docCol = n.data?.documentColumn;
        return { nodeId: n.id, column: (docCol && cols.includes(docCol)) ? docCol : '' };
      });
      return next;
    });
  },[selectedNodes, getNodeColumns]);

  const handleColumnChange = (nodeId: string, column: string) => {
    setNodeColumnSelections(prev=>prev.map(sel=> sel.nodeId===nodeId ? { ...sel, column } : sel));
  };
  const handleColorChange = (nodeId: string, color: string) => setNodeColors(p=>({...p,[nodeId]:color}));

  const handleRun = async () => {
    if (!currentWorkspaceId || !selectedNodes.length) return;
    const firstTwo = selectedNodes.slice(0,2);
    if (firstTwo.some(n=> !nodeColumnSelections.find(s=>s.nodeId===n.id)?.column)) {
      alert('Select a text column for all selected nodes'); return;
    }
    setIsRunning(true); setError(null); setResult(null);
    try {
      const node_columns: Record<string,string> = {};
      nodeColumnSelections.forEach(s=>{ if(s.column) node_columns[s.nodeId]=s.column; });
      const req: TopicModelingRequest = {
        node_ids: firstTwo.map(n=>n.id),
        node_columns,
        min_topic_size: minTopicSize,
        use_ctfidf: useCtTfidf
      };
      const res = await runTopicModeling(currentWorkspaceId, req, getAuthHeaders());
      setResult(res);
      if (!res.success) setError(res.message || 'Topic modeling failed');
    } catch (e:any) {
      setError(e?.message || 'Error running topic modeling');
    } finally { setIsRunning(false); }
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

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-lg border">
        <h2 className="text-lg font-semibold mb-4 text-gray-800">Topic Modeling (BERTopic)</h2>
        <NodeSelectionPanel
          selectedNodes={selectedNodes}
          nodeColumnSelections={nodeColumnSelections}
          onColumnChange={handleColumnChange}
          nodeColors={nodeColors}
            onColorChange={handleColorChange}
          getNodeColumns={getNodeColumns}
          defaultPalette={defaultPalette}
          maxCompare={2}
        />
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Min Topic Size</label>
            <input type="number" min={2} value={minTopicSize} onChange={e=>setMinTopicSize(parseInt(e.target.value)||5)} className="w-full px-2 py-1 text-sm border rounded" />
          </div>
          <div className="flex items-center gap-2 pt-5">
            <input id="useCtTfidf" type="checkbox" checked={useCtTfidf} onChange={e=>setUseCtTfidf(e.target.checked)} />
            <label htmlFor="useCtTfidf" className="text-sm text-gray-700">Use c-TF-IDF embeddings</label>
          </div>
          <div className="pt-5">
            <button disabled={isRunning || !selectedNodes.length} onClick={handleRun} className={`px-4 py-2 text-sm rounded-md font-medium text-white ${isRunning? 'bg-blue-400':'bg-blue-600 hover:bg-blue-700'}`}>{isRunning? 'Running...' : 'Run Topic Modeling'}</button>
          </div>
        </div>
        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
      </div>
      {result && result.success && (
        <div className="bg-white p-4 rounded-lg border" ref={containerRef}>
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
      {result && !result.success && (
        <div className="bg-white p-4 rounded border text-sm text-red-600">{result.message}</div>
      )}
    </div>
  );
};

export default TopicModelingTab;
