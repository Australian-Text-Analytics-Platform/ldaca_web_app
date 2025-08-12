import React from 'react';
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
}) => {
  const getColorForNodeId = (nodeId: string, idx: number) => nodeColors[nodeId] || defaultPalette[idx % defaultPalette.length];
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
            const columns = getNodeColumns(node);
            const selection = nodeColumnSelections.find(sel => sel.nodeId === node.id);
            const nodeDisplayName = node.name || node.data?.name || (node as any).label || node.data?.label || node.id;
            const nodeColor = getColorForNodeId(node.id, idx);
            return (
              <div key={node.id} className={`bg-gray-50 p-3 rounded-md ${selectedNodes.length > maxCompare ? 'flex-none min-w-[50%]' : 'flex-1 min-w-0'}`}>
                <div className="mb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium break-words pr-2" style={{ color: nodeColor }}>{nodeDisplayName}</div>
                    <ColorSwatchPicker color={nodeColor} palette={defaultPalette} onChange={(c)=>onColorChange(node.id,c)} size={7} />
                  </div>
                  <div className="text-xs text-gray-500 break-all">{node.id}</div>
                </div>
                {columns.length > 0 ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Text Column:</label>
                    <select
                      value={selection?.column || ''}
                      onChange={(e) => onColumnChange(node.id, e.target.value)}
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
