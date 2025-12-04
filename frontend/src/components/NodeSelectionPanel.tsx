import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import { cn } from '../lib/utils';
import type { NodeColumnSelection, NodeColumnSource, WorkspaceNodeLike } from '@/features/analysis/common/nodeSelectionTypes';
import { getNodeIdentifier } from '@/features/analysis/common/nodeSelectionTypes';
import { NodeColumnSelector, NodeSelectionList } from '@/features/analysis/common/components';
import type { NodeSelectionRenderArgs } from '@/features/analysis/common/components';
import { useNodeColumnOptions } from '@/features/analysis/common/useNodeColumnOptions';

const CLEAR_SELECTION_VALUE = '__ldaca__clear__';

const STATUS_VARIANT_STYLES: Record<'info' | 'warning' | 'error', string> = {
  info: 'border-sky-500/50 bg-sky-100/60 text-sky-900',
  warning: 'border-amber-500/60 bg-amber-100/60 text-amber-900',
  error: 'border-destructive/50 bg-destructive/10 text-destructive',
};

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
  lockedMessage?: ReactNode; // optional message shown when locked
  statusMessage?: ReactNode; // optional inline status/warning rendered within the panel
  statusVariant?: 'info' | 'warning' | 'error';
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
  lockedMessage,
  statusMessage,
  statusVariant = 'warning',
}) => {
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
  const columnSelectionsByNode = useMemo(() => {
    const map = new Map<string, NodeColumnSelection>();
    nodeColumnSelections.forEach((selection) => {
      if (selection?.nodeId) {
        map.set(selection.nodeId, selection);
      }
    });
    return map;
  }, [nodeColumnSelections]);

  const columnOptions = useNodeColumnOptions({
    nodes: selectedNodes,
    getNodeColumns,
    allowedDataTypes,
    fallbackToAllColumns,
  });

  const renderMetaContent = useCallback(
    ({ node, nodeId }: NodeSelectionRenderArgs) => {
      if (renderNodeMeta) {
        return renderNodeMeta(node);
      }
      if (showShape) {
        return `Shape: ${shapes[nodeId] || '…'}`;
      }
      return null;
    },
    [renderNodeMeta, showShape, shapes]
  );

  const renderColumnSelector = useCallback(
    ({ node, nodeId, index }: NodeSelectionRenderArgs) => {
      if (!showColumnPicker) return null;
      const options = columnOptions[nodeId];
      const columns = options?.columns ?? [];
      const selection = columnSelectionsByNode.get(nodeId);
      const selectValue = selection?.column && selection.column.length > 0 ? selection.column : CLEAR_SELECTION_VALUE;
      return (
        <NodeColumnSelector
          columns={columns}
          value={selectValue}
          preserveValue={selection?.column}
          clearOptionValue={CLEAR_SELECTION_VALUE}
          label={getColumnLabel(node, index)}
          disabled={disabled}
          noColumnsMessage={
            options?.filteredOutByType
              ? 'No columns match the allowed data types for this node'
              : 'No columns available for this node'
          }
          onChange={(value) => {
            const nextValue = value === CLEAR_SELECTION_VALUE ? '' : value;
            onColumnChange(nodeId, nextValue ?? '');
          }}
        />
      );
    },
    [showColumnPicker, columnOptions, columnSelectionsByNode, getColumnLabel, disabled, onColumnChange]
  );

  const handleNodeColorChange = useCallback(
    (nodeId: string, color: string) => {
      if (disabled) return;
      onColorChange(nodeId, color);
    },
    [disabled, onColorChange]
  );

  const shouldRenderMeta = renderNodeMeta != null || showShape;

  return (
    <div className={cn('space-y-3', className)}>
      {showHeaderLabel && (
        <div className="flex items-center justify-between px-4 pt-2">
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
      {statusMessage && (
        <div className="px-4">
          <div
            className={cn(
              'rounded-md border px-3 py-2 text-xs leading-snug',
              STATUS_VARIANT_STYLES[statusVariant] ?? STATUS_VARIANT_STYLES.warning,
            )}
          >
            {statusMessage}
          </div>
        </div>
      )}
      {selectedNodes.length === 0 ? (
        <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-3 text-sm italic text-muted-foreground">
          { (originalCount && originalCount > 0)
            ? `Over-selected (${originalCount}) but none usable. Reduce to max ${maxCompare}.`
            : `No nodes selected. Single click on nodes in the workspace view to select them (max ${maxCompare} for comparison).` }
        </div>
      ) : (
        <NodeSelectionList
          nodes={selectedNodes}
          nodeIds={selectedNodeIds}
          nodeColors={nodeColors}
          palette={defaultPalette}
          maxCompare={maxCompare}
          showColorPicker={showColorPicker}
          onColorChange={showColorPicker ? handleNodeColorChange : undefined}
          renderNodeMeta={shouldRenderMeta ? renderMetaContent : undefined}
          renderNodeBody={showColumnPicker ? renderColumnSelector : undefined}
        />
      )}
      {(originalCount ?? selectedNodes.length) > maxCompare && (
        <div className="mt-1 flex items-center gap-1 text-sm text-amber-600">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Maximum {maxCompare} node allowed here. Currently {(originalCount ?? selectedNodes.length)} selected in workspace; only the first {maxCompare} is used.
        </div>
      )}
      {locked && lockedMessage && (
        <div className="pt-0">
          {typeof lockedMessage === 'string' ? (
            <div className="rounded-md border border-dashed border-muted-foreground/50 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {lockedMessage}
            </div>
          ) : (
            lockedMessage
          )}
        </div>
      )}
    </div>
  );
};

export type { NodeColumnSelection, WorkspaceNodeLike } from '@/features/analysis/common/nodeSelectionTypes';

export default NodeSelectionPanel;
