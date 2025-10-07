/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import NodeSelectionPanel from '../NodeSelectionPanel';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '../../hooks/useWorkspaceActions';
import { useAuth } from '../../hooks/useAuth';
import { textApi } from '../../api/text';
import { nodesApi } from '../../api/nodes';
import { workspacesApi } from '../../api/workspaces';
import useAutoNodeColumns from '../../hooks/useAutoNodeColumns';
import useNodeColumnInfos from '../../hooks/useNodeColumnInfos';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, Lock, Search, Trash2, Unlink } from 'lucide-react';

interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

const QuotationTab: React.FC = () => {
  const { selectedNodes, handlePageChange: baseHandlePageChange, handlePageSizeChange } = useWorkspaceSelection();
  const { currentWorkspaceId, getNodeShape, nodeData } = useWorkspaceData();
  const { quotationSearch, detachQuotation } = useWorkspaceActions();
  const { getAuthHeaders } = useAuth();

  // Show metadata by default so the table mirrors original columns
  const [showMetadata, setShowMetadata] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoadingQuotations, setIsLoadingQuotations] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [lockedNodesSnapshot, setLockedNodesSnapshot] = useState<Array<{ id: string; name: string; columns: string[] }>>([]);
  const [lockedNodeSelections, setLockedNodeSelections] = useState<NodeColumnSelection[] | null>(null);

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
  });

  const { selections: nodeColumnSelections, setSelection: setNodeColumnSelection, setSelections: setNodeColumnSelectionsRaw, recompute: recomputeAutoColumns } = useAutoNodeColumns({
    selectedNodes,
    getNodeColumns: getColumnInfos,
    allowedDataTypes: ['string'],
  }, { workspaceId: currentWorkspaceId, maxNodes: 1, isLocked, docTypeOnly: true, enableHeuristicGuess: false });

  const activeSelections = useMemo(() => (
    isLocked && lockedNodeSelections ? lockedNodeSelections : nodeColumnSelections
  ), [isLocked, lockedNodeSelections, nodeColumnSelections]);

  const getStringColumns = useCallback((node: any) => getColumnInfos(node).map(info => info.name), [getColumnInfos]);

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

  useEffect(() => {
    if (isLocked) return;
    if (!selectedNodes.length) {
      if (nodeColumnSelections.length) {
        setNodeColumnSelectionsRaw([], { replace: true, persist: false });
      }
      return;
    }
    if (nodeColumnSelections.length === 0) {
      recomputeAutoColumns();
    }
  }, [isLocked, selectedNodes, nodeColumnSelections, recomputeAutoColumns, setNodeColumnSelectionsRaw]);

  const handleColumnChange = (nodeId: string, column: string) => {
    if (isLocked) return;
    setNodeColumnSelection(nodeId, column);
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
  const selection = activeSelections.find(s => s.nodeId === nodeId);
    if (!selection?.column) return;

  // show loading via global UI if desired; skip per-node loading state
    try {
      const req = {
        column: selection.column,
        page: 1,             // fetch a large slice to aggregate spans client-side
        page_size: 100000,
        sort_by: undefined,
        sort_order: 'asc' as const,
      } as any;
    const res = await quotationSearch(nodeId, req);
      // Build span map keyed by row signature from original columns
  const node = selectedNodes.find(n => n.id === nodeId);
  const origCols = node ? getStringColumns(node) : [];
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
  const runNodes = selectedNodes.slice(0,1);
  if (!runNodes.length) return;
  setIsLoadingQuotations(true);
  setHasLoaded(true);
  try {
    await Promise.all(runNodes.map(n => fetchQuotations(n.id, 1)));
    const nodeId = runNodes[0].id;
    try {
      const lockedSelections = activeSelections.filter(sel => sel.nodeId === nodeId && sel.column);
      if (lockedSelections.length) {
        setLockedNodeSelections(lockedSelections);
      }
      const info = await nodesApi.info(currentWorkspaceId!, nodeId, getAuthHeaders());
      const name = (info as any)?.name || (info as any)?.data?.name || nodeId;
      const columns = Array.isArray((info as any)?.columns) ? (info as any).columns : (Array.isArray((info as any)?.data?.columns) ? (info as any).data.columns : []);
      setLockedNodesSnapshot([{ id: nodeId, name: String(name), columns }]);
      setIsLocked(true);
    } catch {
      /* ignore */
    }
  } finally {
    setIsLoadingQuotations(false);
  }
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
    const selection = activeSelections.find(s => s.nodeId === nodeId);
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

  // Hydration from backend once per mount
  const hydratedOnceRef = React.useRef<boolean>(false);
  useEffect(() => {
    (async () => {
      if (hydratedOnceRef.current) return;
      hydratedOnceRef.current = true;
      if (!currentWorkspaceId) return;
      try {
        // First check current-request; if null, don't request current-result
        const reqResp = await textApi.getQuotationCurrentRequest(currentWorkspaceId, getAuthHeaders());
        if (!reqResp) {
          // No current request - fresh state
          return;
        }
        
        const req = (reqResp as any)?.data;
        if (req) {
          const nodeId = req.node_id || req.nodeId;
          const column = req.column || '';
          if (nodeId) {
            setNodeColumnSelectionsRaw([{ nodeId, column }], { replace: true });
            if (column) {
              setLockedNodeSelections([{ nodeId, column }]);
            }
          }
          setShowMetadata(true);
          
          // Lock with snapshot
          try {
            const info = await nodesApi.info(currentWorkspaceId!, nodeId, getAuthHeaders());
            const name = (info as any)?.name || (info as any)?.data?.name || nodeId;
            const columns = Array.isArray((info as any)?.columns) ? (info as any).columns : (Array.isArray((info as any)?.data?.columns) ? (info as any).data.columns : []);
            setLockedNodesSnapshot([{ id: nodeId, name: String(name), columns }]);
            setIsLocked(true);
          } catch { /* ignore */ }
        }
        
        // Now get current-result
        const resResp = await textApi.getQuotationCurrentResult(currentWorkspaceId, getAuthHeaders());
        if (!resResp) {
          // No result yet
          return;
        }
        
        const res = (resResp as any)?.data;
        if (res) {
          setHasLoaded(true);
          const nodeId = req?.node_id || req?.nodeId;
          if (nodeId) {
            await fetchQuotations(nodeId, 1);
          }
        }
      } catch { /* ignore */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspaceId, getAuthHeaders]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle>Quotation Extraction</CardTitle>
              <CardDescription>Load quotations for a single node and highlight speaker, quote, and verb spans.</CardDescription>
            </div>
            {isLocked && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2" disabled>
                    <Lock className="h-4 w-4" />
                    Locked
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="w-72 text-left">
                  <p className="font-semibold text-primary-foreground">Panel locked</p>
                  <ul className="mt-2 space-y-1 text-xs leading-relaxed text-primary-foreground/90">
                    <li>Locked to current request/results.</li>
                    <li>Node selection and backend-used parameters are disabled.</li>
                    <li>Frontend-only options (e.g., Show metadata) stay editable.</li>
                    <li>Clear results to unlock and resync with the graph selection.</li>
                  </ul>
                </TooltipContent>
              </Tooltip>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            <NodeSelectionPanel
              selectedNodes={(isLocked && lockedNodesSnapshot.length)
                ? lockedNodesSnapshot.map(s=>({ id: s.id, name: s.name, data: { name: s.name, nodeName: s.name, label: s.name, columns: s.columns }, columns: s.columns }))
                : selectedNodes.slice(0,1)}
              nodeColumnSelections={activeSelections}
              onColumnChange={handleColumnChange}
              nodeColors={{}}
              onColorChange={()=>{}}
              getNodeColumns={getColumnInfos}
              defaultPalette={[]}
              maxCompare={1}
              showShape
              getNodeShapeFn={getNodeShape}
              showColorPicker={false}
              disabled={!!isLocked}
              allowedDataTypes={['string']}
            />

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={handleSearchAll}
                disabled={!selectedNodes.length || activeSelections.some(s=>!s.column) || !!isLocked || isLoadingQuotations}
              >
                {isLoadingQuotations ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading…
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Load Quotations
                  </>
                )}
              </Button>
              {hasLoaded && (
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full sm:w-auto"
                  onClick={async () => {
                    if (!currentWorkspaceId) return;
                    setIsClearing(true);
                    try {
                      try {
                        await workspacesApi.clearAnalysis(currentWorkspaceId, 'quotation', getAuthHeaders());
                      } catch {
                        /* ignore */
                      }
                    } finally {
                      setIsClearing(false);
                      setHasLoaded(false);
                      setSpanMap({});
                      setLockedNodesSnapshot([]);
                      setLockedNodeSelections(null);
                      setIsLocked(false);
                      setNodeColumnSelectionsRaw([], { replace: true, persist: false });
                      recomputeAutoColumns();
                    }
                  }}
                  disabled={isClearing}
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
          </CardContent>
        </Card>

        {hasLoaded && selectedNodes.slice(0,1).map((node)=>{
          const nodeId = node.id;
          const nodeLabel = node.name || node.data?.name || node.data?.label || node.id;
          const originalColumns = getStringColumns(node);
          const selection = activeSelections.find(s => s.nodeId === nodeId);
          const textCol = selection?.column || '';
          
          // Core quotation columns from backend
          const coreQuotationCols = [
            'document_idx', 'speaker', 'speaker_start_idx', 'speaker_end_idx',
            'quote', 'quote_start_idx', 'quote_end_idx',
            'verb', 'verb_start_idx', 'verb_end_idx',
            'quote_type', 'quote_token_count', 'is_floating_quote', 'quote_row_idx',
            textCol // Include the selected text column
          ].filter(c => c); // Remove empty values
          
          // Get all available columns from data
          const baseRows: any[] = Array.isArray(nodeData?.data) ? nodeData.data : [];
          const allCols = baseRows.length > 0 ? Object.keys(baseRows[0]) : originalColumns;
          
          // Filter columns: if showMetadata is false, only show core columns that exist in data
          const cols = showMetadata 
            ? allCols 
            : allCols.filter((c: string) => coreQuotationCols.includes(c));
          
          const rowsForRender = baseRows;
          return (
            <Card key={nodeId} className="overflow-hidden">
              <CardHeader className="gap-1 border-b bg-muted/40">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <CardTitle className="text-base">Quotations for {nodeLabel}</CardTitle>
                    <CardDescription>Text column: {textCol || 'Select a text column to view highlighted quotations.'}</CardDescription>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-foreground whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={showMetadata}
                      onChange={(e) => setShowMetadata(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <span>Show metadata</span>
                  </label>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="flex h-[70vh] flex-col">
                  <div className="flex-1 overflow-y-auto">
                    <table className="min-w-full divide-y divide-border">
                      <thead className="sticky top-0 bg-muted/50">
                        <tr>
                          {cols.map((c: string) => (
                            <th
                              key={c}
                              className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted cursor-pointer"
                              onClick={()=>handleSort(nodeId, c)}
                            >
                              <span className="flex items-center gap-1">
                                <span>{c}</span>
                                <span className="text-[10px] text-muted-foreground/70">▲▼</span>
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-card">
                        {rowsForRender.length === 0 ? (
                          <tr>
                            <td className="px-4 py-6 text-center text-sm text-muted-foreground" colSpan={cols.length || 1}>
                              No quotations
                            </td>
                          </tr>
                        ) : (
                          rowsForRender.map((row:any, idx:number)=> (
                            <tr key={idx} className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                              {cols.map((c: string, i: number) => {
                                const val = row[c];
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
                                    className="px-4 py-2 text-sm text-foreground align-top"
                                    style={{ lineHeight: 1.6 }}
                                  >
                                    {content}
                                  </td>
                                );
                              })}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {(() => {
                    const pag = (nodeData as any)?.pagination || {};
                    const page = Number(pag.page) || 1;
                    const page_size = Number(pag.page_size) || 20;
                    const total_rows = Number(pag.total_rows) || (Array.isArray(nodeData?.data) ? nodeData.data.length : 0);
                    const total_pages = Number(pag.total_pages) || (page_size > 0 ? Math.max(1, Math.ceil(total_rows / page_size)) : 1);
                    const has_prev = !!pag.has_prev || page > 1;
                    const has_next = !!pag.has_next || page < total_pages;
                    return (
                      <div className="flex flex-col gap-4 border-t border-border bg-muted/30 px-4 py-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <span>Show</span>
                            <Select value={String(page_size)} onValueChange={(value) => handlePageSizeChange(Number(value))}>
                              <SelectTrigger className="h-8 w-[110px] text-left">
                                <SelectValue placeholder="Rows" />
                              </SelectTrigger>
                              <SelectContent>
                                {[10, 20, 50, 100].map(sz => (
                                  <SelectItem key={sz} value={String(sz)}>
                                    {sz}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <span>rows</span>
                          </div>
                          <div>
                            Showing {Math.min((page - 1) * page_size + 1, total_rows)} to {Math.min(page * page_size, total_rows)} of {total_rows} rows
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handlePageChange(1)}
                            disabled={!has_prev}
                            title="First page"
                          >
                            <ChevronsLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handlePageChange(page - 1)}
                            disabled={!has_prev}
                            title="Previous page"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>Page</span>
                            <Input
                              type="number"
                              value={page}
                              onChange={(e) => {
                                const newPage = Number(e.target.value);
                                if (Number.isFinite(newPage) && newPage >= 1 && newPage <= total_pages) {
                                  handlePageChange(newPage);
                                }
                              }}
                              className="h-8 w-20 text-center"
                              min={1}
                              max={total_pages}
                            />
                            <span>of {total_pages}</span>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handlePageChange(page + 1)}
                            disabled={!has_next}
                            title="Next page"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handlePageChange(total_pages)}
                            disabled={!has_next}
                            title="Last page"
                          >
                            <ChevronsRight className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={()=>handleDetach(nodeId)}
                            disabled={nodeDetaching[nodeId]}
                          >
                            {nodeDetaching[nodeId] ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Detaching…
                              </>
                            ) : (
                              <>
                                <Unlink className="mr-2 h-4 w-4" />
                                Detach
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </TooltipProvider>
  );
};

export default QuotationTab;
