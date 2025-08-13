import React, { useState, useEffect } from 'react';
import { WorkspaceNode } from '../types';
import { useWorkspace } from '../hooks/useWorkspace';
import NodeSelectionPanel, { NodeColumnSelection } from './NodeSelectionPanel';

interface JoinInterfaceProps {
  leftNode: WorkspaceNode;
  rightNode: WorkspaceNode;
  onJoin: (leftNodeId: string, rightNodeId: string, joinColumns: { left: string; right: string }, joinType: 'inner' | 'left' | 'right' | 'outer', newNodeName: string) => Promise<WorkspaceNode>;
  onCancel: () => void;
  loading?: boolean;
}

const JoinInterface: React.FC<JoinInterfaceProps> = ({
  leftNode,
  rightNode,
  onJoin,
  onCancel,
  loading = false
}) => {
  const { getNodeShape } = useWorkspace();
  const [leftOn, setLeftOn] = useState<string>('');
  const [rightOn, setRightOn] = useState<string>('');
  const [how, setHow] = useState<'inner' | 'left' | 'right' | 'outer'>('left');
  const [newNodeName, setNewNodeName] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Function to find common columns between two nodes
  const findCommonColumns = (leftColumns: string[], rightColumns: string[]): string[] => {
    return leftColumns.filter(leftCol => rightColumns.includes(leftCol));
  };

  // Auto-select common columns when nodes change
  useEffect(() => {
    if (leftNode && rightNode && leftNode.columns && rightNode.columns) {
      const commonColumns = findCommonColumns(leftNode.columns, rightNode.columns);
      
      if (commonColumns.length > 0) {
        // Pick the first common column as default
        const defaultColumn = commonColumns[0];
        setLeftOn(defaultColumn);
        setRightOn(defaultColumn);
      } else {
        // No common columns found, reset to empty selection
        setLeftOn('');
        setRightOn('');
      }
    }
  }, [leftNode, rightNode]);

  const handleJoin = async () => {
    if (!leftOn || !rightOn) {
      alert('Please select columns to join on');
      return;
    }
    
    // Generate default name if none provided
    const finalNodeName = newNodeName.trim() || `${leftNode.name}_${how}_join_${rightNode.name}`;
    
    setIsLoading(true);
    try {
      await onJoin(
        leftNode.node_id,
        rightNode.node_id,
        { left: leftOn, right: rightOn },
        how,
        finalNodeName
      );
      // Reset form after successful join
      setLeftOn('');
      setRightOn('');
      setHow('left');
      setNewNodeName('');
  // Do NOT call onCancel here; selection will be updated by join mutation to the new node
  // which collapses the join interface naturally (selectedNodes length becomes 1).
    } catch (error) {
      console.error('Error joining nodes:', error);
      alert('Failed to join nodes. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Prepare props for NodeSelectionPanel reusing its UI (without color picker)
  const selectedNodes = [leftNode, rightNode];
  const nodeColumnSelections: NodeColumnSelection[] = [
    { nodeId: leftNode.node_id, column: leftOn || '' },
    { nodeId: rightNode.node_id, column: rightOn || '' },
  ];
  const handleColumnChange = (nodeId: string, column: string) => {
    if (nodeId === leftNode.node_id) setLeftOn(column); else if (nodeId === rightNode.node_id) setRightOn(column);
  };
  const getNodeColumns = (node: any) => node.columns || [];
  const nodeColors: Record<string,string> = {};
  const noop = () => {};
  return (
  <div className="flex flex-col max-h-[80vh] relative">
      <div className="flex items-center space-x-2 mb-4 flex-shrink-0">
        <div className="text-lg font-semibold text-gray-800">Join Nodes</div>
        <div className="text-sm text-gray-500">
          {leftNode.name} ⟷ {rightNode.name}
        </div>
      </div>
      <div className="overflow-y-auto pr-2 flex-1 pb-24">
        {findCommonColumns(leftNode.columns, rightNode.columns).length === 0 && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <div className="text-sm text-yellow-800">
              <span className="font-medium">⚠ No common columns found.</span> Please select columns manually to join on.
            </div>
          </div>
        )}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left: node & column selectors in one horizontal panel */}
          <div className="flex-1 min-w-0">
            <NodeSelectionPanel
              selectedNodes={selectedNodes}
              nodeColumnSelections={nodeColumnSelections}
              onColumnChange={handleColumnChange}
              nodeColors={nodeColors}
              onColorChange={noop}
              getNodeColumns={getNodeColumns}
              defaultPalette={["#2563eb","#dc2626"]}
              maxCompare={2}
              showHeaderLabel={false}
              showColorPicker={false}
              columnLabelFn={(node) => node.node_id === leftNode.node_id ? 'Left Column:' : 'Right Column:'}
              showShape
              getNodeShapeFn={getNodeShape}
            />
          </div>
          {/* Right: join options (two rows) */}
          <div className="w-full lg:w-72 flex flex-col gap-4 flex-shrink-0">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Join Type</label>
              <select
                value={how}
                onChange={(e) => setHow(e.target.value as 'inner' | 'left' | 'right' | 'outer')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={loading}
              >
                <option value="inner">Inner Join</option>
                <option value="left">Left Join</option>
                <option value="right">Right Join</option>
                <option value="outer">Outer Join</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Node Name (optional)</label>
              <input
                type="text"
                value={newNodeName}
                onChange={(e) => setNewNodeName(e.target.value)}
                placeholder={`${leftNode.name}_${how}_join_${rightNode.name}`}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={loading || isLoading}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Action Button (sticky) */}
      <div className="mt-4 pt-3 border-t flex justify-end bg-white sticky bottom-0 left-0 right-0">
        <button
          onClick={handleJoin}
          disabled={!leftOn || !rightOn || loading || isLoading}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {isLoading ? (
            <div className="flex items-center space-x-2">
              <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
              <span>Joining...</span>
            </div>
          ) : (
            'Join Nodes'
          )}
        </button>
      </div>
    </div>
  );
};

export default JoinInterface;
