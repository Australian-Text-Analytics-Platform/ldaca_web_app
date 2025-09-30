import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ColorSwatchPicker from './ui/ColorSwatchPicker';
import { ColumnInfo, filterColumnsByType, mapColumnsToInfo, normalizeTypeName } from '../utils/columnTypes';
import { AlertTriangle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Card, CardContent, CardHeader } from './ui/card';
import { cn } from '../lib/utils';

export interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

type NodeColumnSource = string[] | ColumnInfo[];

const CLEAR_SELECTION_VALUE = '__ldaca__clear__';

interface NodeSelectionPanelProps {
  selectedNodes: any[];
  nodeColumnSelections: NodeColumnSelection[];
  onColumnChange: (nodeId: string, column: string) => void;
  nodeColors: Record<string,string>;
  onColorChange: (nodeId: string, color: string) => void;
  getNodeColumns?: (node: any) => NodeColumnSource;
  defaultPalette: string[];
  maxCompare?: number;
  className?: string;
  showHeaderLabel?: boolean;
  showColorPicker?: boolean;
  columnLabelFn?: (node: any, idx: number) => string;
  renderNodeMeta?: (node: any) => React.ReactNode;
  showShape?: boolean; // fetch shape if available and not supplied via renderNodeMeta
  getNodeShapeFn?: (nodeId: string) => Promise<{ shape: [number, number]; is_lazy: boolean; calculated: boolean } | null>;
  disabled?: boolean; // disables interactions but keeps UI fully visible
  locked?: boolean;   // shows a small lock icon in the header when true
  originalCount?: number; // total selection count prior to slicing for display
  /**
   * Restrict selectable columns by normalized data type (e.g., ['string'], ['datetime']).
   * Types are normalized via utils/columnTypes.normalizeTypeName before comparison.
   */
  allowedDataTypes?: string[];
  fallbackToAllColumns?: boolean; // if true, when filtering removes all columns we fall back to the unfiltered list
}

/** Shared node + text-column + color selection panel reused across analysis tabs */
const NodeSelectionPanel: React.FC<NodeSelectionPanelProps> = ({
  selectedNodes,
  nodeColumnSelections,
  onColumnChange,
  nodeColors,
  onColorChange,
  getNodeColumns,
  defaultPalette,
  maxCompare = 2,
  className = '',
  showHeaderLabel = true,
  showColorPicker = true,
  columnLabelFn,
  renderNodeMeta,
  showShape = false,
  getNodeShapeFn,
  disabled = false,
  locked = false,
  originalCount,
  allowedDataTypes,
  fallbackToAllColumns = false,
}) => {
  const getColorForNodeId = (nodeId: string, idx: number) => {
    if (nodeColors[nodeId]) return nodeColors[nodeId];
    if (!defaultPalette.length) return '#000000';
    return defaultPalette[idx % defaultPalette.length];
  };
  const getColumnLabel = (node: any, idx: number) => (columnLabelFn ? columnLabelFn(node, idx) : 'Text Column:');
  const [shapes, setShapes] = useState<Record<string,string>>({});

  // Compute stable list of selected node ids to avoid retriggering on object identity changes
  const selectedNodeIds = useMemo(() => (
    selectedNodes.map((node: any, idx: number) => (
      node.id || node.node_id || node.data?.id || node.data?.node_id || node.unique_id || `node-${idx}`
    ))
  ), [selectedNodes]);

  useEffect(() => {
    if (!showShape || !getNodeShapeFn) return;
    let cancelled = false;
    const fetchShapes = async () => {
      await Promise.all(selectedNodeIds.map(async (nodeId: string) => {
        if (!nodeId) return;
        if (shapes[nodeId]) return;
        // Check sessionStorage cache to avoid duplicate network calls on StrictMode double-mount or tab switches
        try {
          const cacheKey = `node-shape:${nodeId}`;
          const cached = typeof window !== 'undefined' ? window.sessionStorage.getItem(cacheKey) : null;
          if (cached) {
            if (!cancelled) setShapes(prev => ({ ...prev, [nodeId]: cached }));
            return;
          }
        } catch (_) { /* ignore storage errors */ }
        try {
          const res = await getNodeShapeFn(nodeId);
          if (!cancelled && res?.shape) {
            const val = `${res.shape[0]} × ${res.shape[1]}`;
            setShapes(prev => ({ ...prev, [nodeId]: val }));
            try { if (typeof window !== 'undefined') window.sessionStorage.setItem(`node-shape:${nodeId}`, val); } catch (_) { /* ignore */ }
          }
        } catch (e) { /* silent */ }
      }));
    };
    fetchShapes();
    return () => { cancelled = true; };
  }, [showShape, getNodeShapeFn, selectedNodeIds]);
  const normalizeColumnInfos = useCallback((source: NodeColumnSource | undefined): ColumnInfo[] => {
    if (!source) return [];
    if (!Array.isArray(source) || source.length === 0) return [];
    const first = source[0];
    if (typeof first === 'string') {
      return (source as string[]).map((name) => ({ name, dataType: 'string' }));
    }
    return (source as ColumnInfo[]).map((col) => ({
      name: col.name,
      dataType: normalizeTypeName(col.dataType),
    }));
  }, []);

  const resolveColumnInfos = useCallback((node: any): ColumnInfo[] => {
    let infos: ColumnInfo[] = [];
    if (getNodeColumns) {
  const provided = normalizeColumnInfos(getNodeColumns(node));
      infos = provided;
    } else {
      infos = mapColumnsToInfo(node);
    }

    if (allowedDataTypes && allowedDataTypes.length) {
      const filtered = filterColumnsByType(infos, allowedDataTypes);
      if (filtered.length > 0) {
        return filtered;
      }
      if (!fallbackToAllColumns) {
        return filtered;
      }
    }
    return infos;
  }, [allowedDataTypes, fallbackToAllColumns, getNodeColumns, normalizeColumnInfos]);

  return (
    <div className={cn('space-y-3', className)}>
      {showHeaderLabel && (
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-muted-foreground">
            Selected Nodes ({(originalCount ?? selectedNodes.length)}/{maxCompare})
          </label>
        </div>
      )}
      {selectedNodes.length === 0 ? (
        <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-3 text-sm italic text-muted-foreground">
          { (originalCount && originalCount > 0)
            ? `Over-selected (${originalCount}) but none usable. Reduce to max ${maxCompare}.`
            : `No nodes selected. Single click on nodes in the workspace view to select them (max ${maxCompare} for comparison).` }
        </div>
      ) : (
        <div
          className={cn(
            'flex gap-3 pb-2',
            selectedNodes.length > maxCompare ? 'overflow-x-auto' : 'overflow-x-hidden'
          )}
        >
          {selectedNodes.map((node: any, idx: number) => {
            const nodeId: string = node.id || node.node_id || node.data?.id || node.data?.node_id || node.unique_id || `node-${idx}`;
            const columnInfos = resolveColumnInfos(node);
            const columns = columnInfos.map((info) => info.name);
            const selection = nodeColumnSelections.find(sel => sel.nodeId === nodeId);
            const nodeDisplayName = node.name || node.data?.name || node.data?.nodeName || (node as any).label || node.data?.label || nodeId;
            const nodeColor = getColorForNodeId(nodeId, idx);
            return (
              <Card
                key={nodeId}
                className={cn(
                  'border border-border/60 bg-card shadow-sm transition-colors',
                  selectedNodes.length > maxCompare ? 'flex-none min-w-[50%]' : 'flex-1 min-w-0'
                )}
              >
                <CardHeader className="space-y-2 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className="max-w-full break-words pr-2 text-sm font-semibold leading-snug text-foreground"
                      style={showColorPicker ? { color: nodeColor } : undefined}
                      title={nodeDisplayName}
                    >
                      {nodeDisplayName}
                    </div>
                    {showColorPicker && (
                      <ColorSwatchPicker
                        color={nodeColor}
                        palette={defaultPalette}
                        onChange={(c) => onColorChange(nodeId, c)}
                        size={7}
                      />
                    )}
                  </div>
                  <div className="break-all text-xs text-muted-foreground">{nodeId}</div>
                  {renderNodeMeta ? (
                    <div className="text-xs text-muted-foreground">{renderNodeMeta(node)}</div>
                  ) : (
                    showShape && (
                      <div className="text-xs text-muted-foreground">Shape: {shapes[nodeId] || '…'}</div>
                    )
                  )}
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                  {columns.length > 0 ? (
                    <div className="space-y-1">
                      <span className="block text-xs font-medium text-muted-foreground">
                        {getColumnLabel(node, idx)}
                      </span>
                      <Select
                        value={selection?.column ? selection.column : undefined}
                        onValueChange={(value) => {
                          const nextValue = value === CLEAR_SELECTION_VALUE ? '' : value;
                          onColumnChange(nodeId, nextValue ?? '');
                        }}
                        disabled={disabled}
                      >
                        <SelectTrigger className="w-full text-sm">
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={CLEAR_SELECTION_VALUE}>Select column…</SelectItem>
                          {columns.map((column: string) => (
                            <SelectItem key={column} value={column}>
                              {column}
                            </SelectItem>
                          ))}
                          {selection?.column && !columns.includes(selection.column) && (
                            <SelectItem value={selection.column}>
                              {selection.column}
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      No columns available for this node
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {(originalCount ?? selectedNodes.length) > maxCompare && (
        <div className="mt-1 flex items-center gap-1 text-sm text-amber-600">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Maximum {maxCompare} node allowed here. Currently {(originalCount ?? selectedNodes.length)} selected in workspace; only the first {maxCompare} is used.
        </div>
      )}
    </div>
  );
};

export default NodeSelectionPanel;
