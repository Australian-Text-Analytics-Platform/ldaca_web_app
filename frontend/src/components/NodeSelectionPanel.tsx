import React, { useEffect, useState } from 'react';
import ColorSwatchPicker from './ColorSwatchPicker';

export interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

interface NodeSelectionPanelProps {
  selectedNodes: any[];
  nodeColumnSelections: NodeColumnSelection[];
  onColumnChange: (nodeId: string, column: string) => void;
  nodeColors: Record<string,string>;
  onColorChange: (nodeId: string, color: string) => void;
  getNodeColumns: (node: any) => string[];
  defaultPalette: string[];
  maxCompare?: number;
  className?: string;
  showHeaderLabel?: boolean;
  showColorPicker?: boolean;
  columnLabelFn?: (node: any, idx: number) => string;
  renderNodeMeta?: (node: any) => React.ReactNode;
  showShape?: boolean; // fetch shape if available and not supplied via renderNodeMeta
  getNodeShapeFn?: (nodeId: string) => Promise<{ shape: [number, number]; is_lazy: boolean; calculated: boolean } | null>;
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
}) => {
  const getColorForNodeId = (nodeId: string, idx: number) => nodeColors[nodeId] || defaultPalette[idx % defaultPalette.length];
  const getColumnLabel = (node: any, idx: number) => (columnLabelFn ? columnLabelFn(node, idx) : 'Text Column:');
  const [shapes, setShapes] = useState<Record<string,string>>({});

  useEffect(() => {
    if (!showShape || !getNodeShapeFn) return;
    let cancelled = false;
    const fetchShapes = async () => {
      await Promise.all(selectedNodes.map(async (node: any, idx: number) => {
        const nodeId: string = node.id || node.node_id || node.data?.id || node.data?.node_id || node.unique_id || `node-${idx}`;
        if (shapes[nodeId]) return;
        try {
          const res = await getNodeShapeFn(nodeId);
          if (!cancelled && res?.shape) {
            setShapes(prev => ({ ...prev, [nodeId]: `${res.shape[0]} × ${res.shape[1]}` }));
          }
        } catch (e) { /* silent */ }
      }));
    };
    fetchShapes();
    return () => { cancelled = true; };
  }, [showShape, getNodeShapeFn, selectedNodes, shapes]);
  return (
    <div className={className}>
      {showHeaderLabel && (
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Selected Nodes ({selectedNodes.length}/{maxCompare})
        </label>
      )}
      {selectedNodes.length === 0 ? (
        <div className="text-sm text-gray-500 italic bg-gray-50 p-3 rounded-md">
          No nodes selected. Click on nodes in the workspace view to select them (max {maxCompare} for comparison). Hold Cmd/Ctrl to select multiple nodes.
        </div>
      ) : (
        <div className={`flex space-x-3 pb-2 ${selectedNodes.length > maxCompare ? 'overflow-x-auto' : 'overflow-x-hidden'}`}>
          {selectedNodes.map((node: any, idx: number) => {
            const nodeId: string = node.id || node.node_id || node.data?.id || node.data?.node_id || node.unique_id || `node-${idx}`;
            const columns = getNodeColumns(node);
            const selection = nodeColumnSelections.find(sel => sel.nodeId === nodeId);
            const nodeDisplayName = node.name || node.data?.name || (node as any).label || node.data?.label || nodeId;
            const nodeColor = getColorForNodeId(nodeId, idx);
            return (
              <div key={nodeId} className={`bg-gray-50 p-3 rounded-md ${selectedNodes.length > maxCompare ? 'flex-none min-w-[50%]' : 'flex-1 min-w-0'}`}>
                <div className="mb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className="font-medium break-words whitespace-normal hyphens-auto pr-2 leading-snug max-w-full"
                        style={showColorPicker ? { color: nodeColor } : undefined}
                        title={nodeDisplayName}
                      >{nodeDisplayName}</div>
                      {showColorPicker && (
                        <ColorSwatchPicker color={nodeColor} palette={defaultPalette} onChange={(c)=>onColorChange(nodeId,c)} size={7} />
                      )}
                    </div>
                    <div className="text-xs text-gray-500 break-all">{nodeId}</div>
                    {renderNodeMeta ? (
                      <div className="text-xs text-gray-500 mt-1">{renderNodeMeta(node)}</div>
                    ) : showShape && (
                      <div className="text-xs text-gray-500 mt-1">Shape: {shapes[nodeId] || '…'}</div>
                    )}
                </div>
                {columns.length > 0 ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{getColumnLabel(node, idx)}</label>
                    <select
                      value={selection?.column || ''}
                      onChange={(e) => onColumnChange(nodeId, e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">Select a column...</option>
                      {columns.map((column: string) => (
                        <option key={column} value={column}>{column}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="text-xs text-red-500">No columns available for this node</div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {selectedNodes.length > maxCompare && (
        <div className="text-sm text-orange-600 mt-2">⚠️ Only the first {maxCompare} selected nodes will be used for comparison.</div>
      )}
    </div>
  );
};

export default NodeSelectionPanel;
