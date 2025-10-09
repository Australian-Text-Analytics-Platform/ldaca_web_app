import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ColumnInfo, filterColumnsByType, mapColumnsToInfo, normalizeTypeName } from '../utils/columnTypes';
import { AlertTriangle, Lock } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Card, CardContent, CardHeader } from './ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Input } from './ui/input';
import { cn } from '../lib/utils';

export interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

type NodeColumnSource = string[] | ColumnInfo[];

const CLEAR_SELECTION_VALUE = '__ldaca__clear__';

export type WorkspaceNodeLike = Record<string, unknown> & {
  id?: string;
  node_id?: string;
  data?: Record<string, unknown> & {
    id?: string;
    node_id?: string;
    nodeName?: string;
    name?: string;
    label?: string;
    shape?: [number, number];
    columns?: string[];
    schema?: unknown;
  };
  name?: string;
  label?: string;
  unique_id?: string;
};

const getNodeIdentifier = (node: WorkspaceNodeLike, fallbackIndex: number): string =>
  node.id ||
  node.node_id ||
  (node.data?.id as string | undefined) ||
  (node.data?.node_id as string | undefined) ||
  (node.unique_id as string | undefined) ||
  `node-${fallbackIndex}`;

const getNodeDisplayName = (node: WorkspaceNodeLike, fallbackId: string): string =>
  (node.name as string | undefined) ||
  (node.data?.name as string | undefined) ||
  (node.data?.nodeName as string | undefined) ||
  (node.label as string | undefined) ||
  (node.data?.label as string | undefined) ||
  fallbackId;

interface NodeSelectionPanelProps {
  selectedNodes: WorkspaceNodeLike[];
  nodeColumnSelections: NodeColumnSelection[];
  onColumnChange: (nodeId: string, column: string) => void;
  nodeColors: Record<string,string>;
  onColorChange: (nodeId: string, color: string) => void;
  getNodeColumns?: (node: WorkspaceNodeLike) => NodeColumnSource;
  defaultPalette: string[];
  maxCompare?: number;
  className?: string;
  showHeaderLabel?: boolean;
  showColorPicker?: boolean;
  showColumnPicker?: boolean;
  columnLabelFn?: (node: WorkspaceNodeLike, idx: number) => string;
  renderNodeMeta?: (node: WorkspaceNodeLike) => React.ReactNode;
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
  showColumnPicker = true,
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
  const getColumnLabel = (node: WorkspaceNodeLike, idx: number) => (columnLabelFn ? columnLabelFn(node, idx) : 'Text Column:');
  const [shapes, setShapes] = useState<Record<string,string>>({});

  // Compute stable list of selected node ids to avoid retriggering on object identity changes
  const selectedNodeIds = useMemo(() => (
    selectedNodes.map((node, idx) => getNodeIdentifier(node, idx))
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
        } catch {
          // ignore storage errors
        }
        try {
          const res = await getNodeShapeFn(nodeId);
          if (!cancelled && res?.shape) {
            const val = `${res.shape[0]} × ${res.shape[1]}`;
            setShapes(prev => ({ ...prev, [nodeId]: val }));
            try {
              if (typeof window !== 'undefined') {
                window.sessionStorage.setItem(`node-shape:${nodeId}`, val);
              }
            } catch {
              // ignore storage errors
            }
          }
        } catch {
          // ignore fetch errors
        }
      }));
    };
    fetchShapes();
    return () => { cancelled = true; };
  }, [getNodeShapeFn, selectedNodeIds, shapes, showShape]);
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

  const resolveColumnInfos = useCallback((node: WorkspaceNodeLike): ColumnInfo[] => {
    let infos: ColumnInfo[] = [];
    if (getNodeColumns) {
      const provided = normalizeColumnInfos(getNodeColumns(node));
      infos = provided;
    } else {
      infos = mapColumnsToInfo(node as unknown as Record<string, unknown>);
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
    <div className={cn('space-y-4', className)}>
      {showHeaderLabel && (
        <div className="flex items-center justify-between px-1">
          <label className="block text-sm font-medium text-muted-foreground">
            Selected Nodes ({(originalCount ?? selectedNodes.length)}/{maxCompare})
          </label>
          {locked && (
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
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
            'flex gap-3 px-1 pb-2 pt-1',
            selectedNodes.length > maxCompare ? 'overflow-x-auto' : 'overflow-x-hidden'
          )}
        >
          {selectedNodes.map((node, idx) => {
            const nodeId = getNodeIdentifier(node, idx);
            const columnInfos = showColumnPicker ? resolveColumnInfos(node) : [];
            const columns = showColumnPicker ? columnInfos.map((info) => info.name) : [];
            const selection = nodeColumnSelections.find(sel => sel.nodeId === nodeId);
            const nodeDisplayName = getNodeDisplayName(node, nodeId);
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
                      <NodeColorDropdown
                        color={nodeColor}
                        palette={defaultPalette}
                        onChange={(c) => onColorChange(nodeId, c)}
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
                {showColumnPicker && (
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
                )}
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

interface NodeColorDropdownProps {
  color: string;
  palette: string[];
  onChange: (color: string) => void;
}

const NodeColorDropdown: React.FC<NodeColorDropdownProps> = ({ color, palette, onChange }) => {
  const [hexInput, setHexInput] = useState(color.toUpperCase());

  useEffect(() => {
    setHexInput(color.toUpperCase());
  }, [color]);

  const handleHexChange = useCallback(
    (value: string) => {
      const trimmed = value.trim().toUpperCase();
      setHexInput(trimmed.startsWith('#') ? trimmed : `#${trimmed}`);
      const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
      if (/^#[0-9A-F]{6}$/.test(normalized)) {
        onChange(normalized);
      }
    },
    [onChange]
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'h-7 w-7 aspect-square rounded-full ring-2 ring-border ring-offset-2 transition-shadow hover:ring-primary focus-visible:outline-none focus-visible:ring-primary shadow-sm'
          )}
          style={{ backgroundColor: color }}
          aria-label="Select color"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-3 space-y-3">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>Pick color</span>
          <span className="font-mono text-[10px] text-muted-foreground/80">{color.toUpperCase()}</span>
        </div>
        <div className="grid grid-cols-6 gap-1">
          {palette.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={cn(
                'h-6 w-6 rounded-full border border-white shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                swatch.toLowerCase() === color.toLowerCase() && 'ring-2 ring-primary ring-offset-1'
              )}
              style={{ backgroundColor: swatch }}
              onClick={() => onChange(swatch)}
              aria-label={`Set color ${swatch}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(event) => {
              const next = event.target.value.toUpperCase();
              setHexInput(next);
              onChange(next);
            }}
            className="h-9 w-9 cursor-pointer rounded border border-input bg-transparent p-0"
            aria-label="Custom color"
          />
          <Input
            value={hexInput}
            onChange={(event) => handleHexChange(event.target.value)}
            maxLength={7}
            placeholder="#000000"
            aria-label="Hex color"
            className="flex-1 text-xs font-mono"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
