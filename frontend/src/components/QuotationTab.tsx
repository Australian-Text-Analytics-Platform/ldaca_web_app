import React, { useEffect, useMemo, useState } from 'react';
import NodeSelectionPanel from './NodeSelectionPanel';
import { useWorkspace } from '../hooks/useWorkspace';

interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

const QuotationTab: React.FC = () => {
  const { selectedNodes, currentWorkspaceId, getNodeShape, quotationSearch, detachQuotation, nodeData, handlePageChange: baseHandlePageChange, handlePageSizeChange } = useWorkspace();

  const [nodeColumnSelections, setNodeColumnSelections] = useState<NodeColumnSelection[]>([]);
  // Show metadata by default so the table mirrors original columns
  const [showMetadata, setShowMetadata] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Per-node pagination and sorting state
  const [nodeState, setNodeState] = useState<Record<string, {
    currentPage: number;
    pageSize: number;
    sortBy?: string;
    sortOrder: 'asc' | 'desc';
  }>>({});
  // Deprecated per-node loading indicator; rely on DataView-like UX
  const [nodeDetaching, setNodeDetaching] = useState<Record<string, boolean>>({});

  // Raw quotation response is reduced into spanMap; we no longer store full pages here
  // Aggregated spans keyed by a row signature (JSON of original column values)
  const [spanMap, setSpanMap] = useState<Record<string, Record<string, { start: number; end: number; type: string }[]>>>({});

  // Helpers
  const getNodeColumns = useMemo(() => {
    return (node: any) => {
      if (node.data?.columns && Array.isArray(node.data.columns)) return node.data.columns;
      if (node.data?.dtypes && typeof node.data.dtypes === 'object') return Object.keys(node.data.dtypes);
      if (node.data?.schema) return Object.keys(node.data.schema);
      return [];
    };
  }, []);

  // Sync selection with current nodes (limit to 1 by default)
  useEffect(() => {
    if (selectedNodes.length === 0) { setNodeColumnSelections([]); return; }
    setNodeColumnSelections(prev => {
      const newSelections = selectedNodes.slice(0, 1).map(node => {
        const existing = prev.find(sel => sel.nodeId === node.id);
        if (existing) return existing;
        const columns = getNodeColumns(node);
        const isDocType = !!(node.data?.nodeType && node.data.nodeType.includes('Doc'));
        const documentColumn = node.data?.documentColumn;
        const defaultColumn = isDocType && documentColumn && columns.includes(documentColumn) ? documentColumn : '';
        return { nodeId: node.id, column: defaultColumn };
      });
      return JSON.stringify(newSelections) === JSON.stringify(prev) ? prev : newSelections;
    });
  }, [selectedNodes, getNodeColumns]);

  const handleColumnChange = (nodeId: string, column: string) => {
    setNodeColumnSelections(prev => prev.map(sel => sel.nodeId === nodeId ? { ...sel, column } : sel));
  };

  // Colors for underline types
  const TYPE_COLORS: Record<string, string> = useMemo(() => ({
    speaker: '#2563eb', // blue-600
    quote: '#059669',   // emerald-600
    verb: '#7c3aed',    // violet-600
  }), []);

  // Track hovered segment per cell to highlight only that particular part
  const [hoverState, setHoverState] = useState<{ key: string; segIndex: number; type?: 'speaker'|'quote'|'verb' } | null>(null);

  const hexToRgba = (hex: string, alpha = 0.18) => {
    const h = hex.replace('#', '');
    const bigint = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  // Build multiple text decorations for proper multi-line underlines
  const buildUnderlineStyle = (types: string[]): React.CSSProperties => {
    if (!types.length) return {};
    // Use text-decoration-line with multiple underlines for proper line wrapping
    const decorations = types.map(() => 'underline').join(' ');
    const colors = types.map(t => TYPE_COLORS[t] || '#111827');
    return {
      textDecorationLine: decorations as any,
      textDecorationColor: colors.join(' ') as any,
      textDecorationThickness: '2px',
      textUnderlineOffset: '2px',
      display: 'inline',
    } as React.CSSProperties;
  };

  // Render a single text cell with underline spans using indices and label badges
  const renderHighlightedText = (text: string, row: any, cellKey: string): React.ReactNode => {
    try {
      if (typeof text !== 'string' || !text.length) return text ?? '';
      const spans: Array<{ start: number; end: number; types: string[] }> = [];
      const addSpan = (start?: any, end?: any, type?: string) => {
        if (type && Number.isFinite(start) && Number.isFinite(end) && start < end && start >= 0 && end <= text.length) {
          spans.push({ start: Number(start), end: Number(end), types: [type] });
        }
      };
      // Prefer aggregated spans if present
      if (Array.isArray(row?.__spans) && row.__spans.length > 0) {
        row.__spans.forEach((s: any) => addSpan(s?.start, s?.end, s?.type));
      } else {
        addSpan(row?.speaker_start_idx, row?.speaker_end_idx, 'speaker');
        addSpan(row?.quote_start_idx, row?.quote_end_idx, 'quote');
        addSpan(row?.verb_start_idx, row?.verb_end_idx, 'verb');
      }

      if (!spans.length) return text;

      // Build segmentation boundaries
      const bounds = new Set<number>([0, text.length]);
      spans.forEach(s => { bounds.add(s.start); bounds.add(s.end); });
      const points = Array.from(bounds).sort((a, b) => a - b);

      const segs: Array<{ start: number; end: number; types: string[] }> = [];
      for (let i = 0; i < points.length - 1; i++) {
        const s = points[i];
        const e = points[i + 1];
        if (e <= s) continue;
        const covering = spans.filter(sp => sp.start < e && sp.end > s).flatMap(sp => sp.types);
        segs.push({ start: s, end: e, types: Array.from(new Set(covering)) });
      }

      const renderLabels = (types: string[], segIndex: number) => {
        if (!types.length) return null;
        return types.map((t, idx) => (
          <span
            key={idx}
            className="text-[10px] font-semibold px-1 py-0.5 rounded border mr-1 align-baseline cursor-pointer"
            style={{
              color: '#0f172a',
              borderColor: TYPE_COLORS[t] || '#334155',
              backgroundColor: hoverState && hoverState.key === cellKey && hoverState.segIndex === segIndex && hoverState.type === (t as any)
                ? hexToRgba(TYPE_COLORS[t] || '#cbd5e1', 0.28)
                : '#f1f5f9',
            }}
            onMouseEnter={() => setHoverState({ key: cellKey, segIndex, type: t as 'speaker'|'quote'|'verb' })}
            onMouseLeave={() => setHoverState(null)}
          >
            {t.toUpperCase()}
          </span>
        ));
      };

      return (
        <span>
          {segs.map((seg, i) => {
            const str = text.slice(seg.start, seg.end);
            if (!seg.types.length) return <span key={i}>{str}</span>;
            const style = buildUnderlineStyle(seg.types);
            // Determine hover match for this segment: if the currently hovered type applies to this cell and segment
            const isHoveredSeg = !!(hoverState && hoverState.key === cellKey && hoverState.segIndex === i);
            const colorForSeg = (hoverState?.type && isHoveredSeg && seg.types.includes(hoverState.type))
              ? hoverState.type
              : undefined;
            const bgStyle: React.CSSProperties = isHoveredSeg ? {
              backgroundColor: hexToRgba(TYPE_COLORS[colorForSeg || 'quote'] || '#cbd5e1', 0.22),
              borderRadius: 3,
              paddingLeft: 1,
              paddingRight: 1,
            } : {};

            // On text hover, pick a deterministic type to highlight (priority: quote > speaker > verb)
            const choosePriorityType = (ts: string[]) => {
              const order = ['quote', 'speaker', 'verb'];
              for (const t of order) if (ts.includes(t)) return t as 'quote'|'speaker'|'verb';
              return ts[0] as 'quote'|'speaker'|'verb';
            };
            const segHoverType = choosePriorityType(seg.types);
            return (
              <span key={i}>
                {renderLabels(seg.types, i)}
                <span
                  style={{ ...style, ...bgStyle }}
                  onMouseEnter={() => setHoverState({ key: cellKey, segIndex: i, type: segHoverType })}
                  onMouseLeave={() => setHoverState(null)}
                >{str}</span>
              </span>
            );
          })}
          {row?.quote_type ? (
            <span className="ml-1 align-baseline text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">{String(row.quote_type)}</span>
          ) : null}
        </span>
      );
    } catch {
      return text;
    }
  };

  const fetchQuotations = async (nodeId: string, _page?: number, _sortBy?: string, _sortOrder?: 'asc'|'desc') => {
    if (!currentWorkspaceId) return;
    const selection = nodeColumnSelections.find(s => s.nodeId === nodeId);
    if (!selection?.column) return;

  // show loading via global UI if desired; skip per-node loading state
    try {
      const req = {
        column: selection.column,
        show_metadata: true, // ensure original columns present
        page: 1,             // fetch a large slice to aggregate spans client-side
        page_size: 100000,
        sort_by: undefined,
        sort_order: 'asc' as const,
      } as any;
    const res = await quotationSearch(nodeId, req);
      // Build span map keyed by row signature from original columns
      const node = selectedNodes.find(n => n.id === nodeId);
      const origCols = node ? getNodeColumns(node) : [];
      const map: Record<string, { start: number; end: number; type: string }[]> = {};
      const rows: any[] = res?.data || [];
      const sig = (r: any) => JSON.stringify(origCols.map((c: string) => r?.[c]));
      for (const r of rows) {
        const k = sig(r);
        if (!map[k]) map[k] = [];
        const add = (s?: any, e?: any, t?: string) => {
          if (t && Number.isFinite(s) && Number.isFinite(e) && s < e) map[k].push({ start: Number(s), end: Number(e), type: t });
        };
        add(r?.speaker_start_idx, r?.speaker_end_idx, 'speaker');
        add(r?.quote_start_idx, r?.quote_end_idx, 'quote');
        add(r?.verb_start_idx, r?.verb_end_idx, 'verb');
      }
      setSpanMap(prev => ({ ...prev, [nodeId]: map }));
    } finally {
      // no-op
    }
  };

  const handleSearchAll = async () => {
  setHasLoaded(true);
  await Promise.all(selectedNodes.slice(0,1).map(n => fetchQuotations(n.id, 1)));
  };

  const handlePageChange = (newPage: number) => {
    // Use base table pagination; quotes already aggregated in spanMap
    baseHandlePageChange(newPage);
  };

  const handleSort = (nodeId: string, column: string) => {
  const defaultPageSize = Number((nodeData as any)?.pagination?.page_size) || 20;
  const ns = nodeState[nodeId] || { currentPage: 1, pageSize: defaultPageSize, sortBy: undefined, sortOrder: 'asc' as const };
    const isSame = ns.sortBy === column;
    const nextOrder: 'asc'|'desc' = isSame && ns.sortOrder === 'asc' ? 'desc' : 'asc';
    setNodeState(prev => ({ ...prev, [nodeId]: { ...ns, currentPage: 1, sortBy: column, sortOrder: nextOrder } }));
    fetchQuotations(nodeId, 1, column, nextOrder);
  };

  const handleDetach = async (nodeId: string) => {
    const selection = nodeColumnSelections.find(s => s.nodeId === nodeId);
    if (!selection?.column) return;
    setNodeDetaching(prev => ({ ...prev, [nodeId]: true }));
    try {
      await detachQuotation(nodeId, { node_id: nodeId, column: selection.column });
    } catch (e: any) {
      alert(`Error detaching quotation: ${e?.message || 'Unknown error'}`);
    } finally {
      setNodeDetaching(prev => ({ ...prev, [nodeId]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <NodeSelectionPanel
              selectedNodes={selectedNodes.slice(0,1)}
              nodeColumnSelections={nodeColumnSelections}
              onColumnChange={handleColumnChange}
              nodeColors={{}}
              onColorChange={()=>{}}
              getNodeColumns={getNodeColumns}
              defaultPalette={[]}
              maxCompare={1}
              className="mb-0"
              showShape
              getNodeShapeFn={getNodeShape}
              showColorPicker={false}
            />
          </div>
          <div className="w-64 flex-shrink-0">
            <div className="space-y-3">
              <div>
                <label className="flex items-center">
                  <input type="checkbox" className="mr-2" checked={showMetadata} onChange={(e)=>setShowMetadata(e.target.checked)} />
                  <span className="text-sm text-gray-700">Show metadata</span>
                </label>
              </div>
              <div>
                <button
                  onClick={handleSearchAll}
                  disabled={!selectedNodes.length || nodeColumnSelections.some(s=>!s.column)}
                  className="w-full px-4 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm"
                >
                  Load quotations
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Results - render only after user clicks Load quotations */}
      {hasLoaded && selectedNodes.slice(0,1).map((node)=>{
        const nodeId = node.id;
  // const nodeRes = results[nodeId]; // no longer needed; we use base table pagination
  // Determine which columns to show: mirror original node columns only
        const originalColumns = getNodeColumns(node);
        const selection = nodeColumnSelections.find(s => s.nodeId === nodeId);
        const textCol = selection?.column || '';
        const cols = originalColumns;
  // Use base table rows as the source of truth
  const baseRows: any[] = Array.isArray(nodeData?.data) ? nodeData.data : [];
  const rowsForRender = baseRows;
        return (
          <div key={nodeId} className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden h-[70vh] flex flex-col">
              <div className="flex-1 overflow-y-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      {cols.map((c: string) => (
                        <th
                          key={c}
                          className="px-4 py-2 text-left text-xs font-medium text-gray-500 tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={()=>handleSort(nodeId, c)}
                        >
                          <div className="flex items-center space-x-1">
                            <span>{c}</span>
                            <span className="text-xs text-gray-400">▲▼</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {rowsForRender.length === 0 ? (
                      <tr><td className="px-4 py-6 text-center text-gray-500" colSpan={cols.length || 1}>No quotations</td></tr>
                    ) : (
                      rowsForRender.map((row:any, idx:number)=> {
                        return (
                          <tr key={idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                            {cols.map((c: string, i: number) => {
                              const val = row[c];
                              // compute signature to find spans for this row
                              const signature = JSON.stringify(cols.map((oc: string) => row?.[oc]));
                              const spansForRow = (spanMap[nodeId] && spanMap[nodeId][signature]) || [];
                              const rowWithSpans = { ...row, __spans: spansForRow };
                              const cellKey = `${nodeId}:${idx}:${i}`;
                              const content = (c === textCol)
                                ? renderHighlightedText(typeof val === 'string' ? val : (val ?? ''), rowWithSpans, cellKey)
                                : (val !== undefined && val !== null ? String(val) : '');
                              return (
                                <td
                                  key={i}
                                  className="px-4 py-2 text-sm text-gray-900 align-top"
                                  style={{ lineHeight: 1.6 }}
                                >
                                  {content}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {/* DataView-style pagination controls + detach */}
              {(() => {
                const pag = (nodeData as any)?.pagination || {};
                const page = Number(pag.page) || 1;
                const page_size = Number(pag.page_size) || 20;
                const total_rows = Number(pag.total_rows) || (Array.isArray(nodeData?.data) ? nodeData.data.length : 0);
                const total_pages = Number(pag.total_pages) || (page_size > 0 ? Math.max(1, Math.ceil(total_rows / page_size)) : 1);
                const has_prev = !!pag.has_prev || page > 1;
                const has_next = !!pag.has_next || page < total_pages;
                return (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
                    {/* Left: page size + row info */}
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm text-gray-700">Show</span>
                        <select
                          value={page_size}
                          onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                          className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          {[10,20,50,100].map(sz => (<option key={sz} value={sz}>{sz}</option>))}
                        </select>
                        <span className="text-sm text-gray-700">rows</span>
                      </div>
                      <div className="text-sm text-gray-700">
                        Showing {Math.min((page - 1) * page_size + 1, total_rows)} to {Math.min(page * page_size, total_rows)} of {total_rows} rows
                      </div>
                    </div>

                    {/* Right: nav + detach */}
                    <div className="flex items-center space-x-2">
                      <button onClick={() => handlePageChange(1)} disabled={!has_prev} className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100" title="First page">⟨⟨</button>
                      <button onClick={() => handlePageChange(page - 1)} disabled={!has_prev} className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100" title="Previous page">⟨</button>
                      <div className="flex items-center space-x-1">
                        <span className="text-sm text-gray-700">Page</span>
                        <input
                          type="number"
                          value={page}
                          onChange={(e) => {
                            const newPage = Number(e.target.value);
                            if (newPage >= 1 && newPage <= total_pages) handlePageChange(newPage);
                          }}
                          className="w-16 px-2 py-1 text-sm border border-gray-300 rounded text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                          min={1}
                          max={total_pages}
                        />
                        <span className="text-sm text-gray-700">of {total_pages}</span>
                      </div>
                      <button onClick={() => handlePageChange(page + 1)} disabled={!has_next} className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100" title="Next page">⟩</button>
                      <button onClick={() => handlePageChange(total_pages)} disabled={!has_next} className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100" title="Last page">⟩⟩</button>
                      <button onClick={()=>handleDetach(nodeId)} disabled={nodeDetaching[nodeId]} className="ml-3 px-3 py-1 bg-green-600 text-white rounded text-sm disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-green-700 transition-colors">
                        {nodeDetaching[nodeId] ? 'Detaching...' : 'Detach'}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })}
  {/* Intentionally render nothing before user loads quotations */}
    </div>
  );
};

export default QuotationTab;
