import React, { useState, useEffect } from 'react';
import { WorkspaceNode } from '../types';

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
      onCancel(); // Close the join interface
    } catch (error) {
      console.error('Error joining nodes:', error);
      alert('Failed to join nodes. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 bg-white border border-gray-200 rounded-lg">
      <div className="flex items-center space-x-2 mb-4">
        <div className="text-lg font-semibold text-gray-800">Join Nodes</div>
        <div className="text-sm text-gray-500">
          {leftNode.name} ⟷ {rightNode.name}
        </div>
      </div>
      
      {/* Auto-selection message */}
      {findCommonColumns(leftNode.columns, rightNode.columns).length > 0 && leftOn && rightOn && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
          <div className="flex items-center">
            <div className="text-sm text-green-800">
              <span className="font-medium">✓ Auto-selected:</span> Found common column "{leftOn}" for joining
              {findCommonColumns(leftNode.columns, rightNode.columns).length > 1 && (
                <span className="ml-2 text-xs">
                  (+{findCommonColumns(leftNode.columns, rightNode.columns).length - 1} other common column{findCommonColumns(leftNode.columns, rightNode.columns).length > 2 ? 's' : ''} available)
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      
      {findCommonColumns(leftNode.columns, rightNode.columns).length === 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <div className="flex items-center">
            <div className="text-sm text-yellow-800">
              <span className="font-medium">⚠ No common columns found.</span> Please select columns manually to join on.
            </div>
          </div>
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Node */}
        <div className="space-y-3">
          <div className="text-sm font-medium text-gray-700">
            Left Node: {leftNode.name}
          </div>
          <div className="text-xs text-gray-500 mb-2">
            Shape: {leftNode.shape[0]} × {leftNode.shape[1]}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Left Column
            </label>
            <select
              value={leftOn}
              onChange={(e) => setLeftOn(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={loading}
            >
              <option value="">Select column...</option>
              {/* Show common columns first with special styling */}
              {findCommonColumns(leftNode.columns, rightNode.columns).map((col) => (
                <option key={`common-${col}`} value={col}>
                  {col} (common)
                </option>
              ))}
              {/* Show separator if there are common columns */}
              {findCommonColumns(leftNode.columns, rightNode.columns).length > 0 && (
                <option disabled value="">──────────</option>
              )}
              {/* Show remaining columns */}
              {leftNode.columns
                .filter(col => !findCommonColumns(leftNode.columns, rightNode.columns).includes(col))
                .map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Right Node */}
        <div className="space-y-3">
          <div className="text-sm font-medium text-gray-700">
            Right Node: {rightNode.name}
          </div>
          <div className="text-xs text-gray-500 mb-2">
            Shape: {rightNode.shape[0]} × {rightNode.shape[1]}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Right Column
            </label>
            <select
              value={rightOn}
              onChange={(e) => setRightOn(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={loading}
            >
              <option value="">Select column...</option>
              {/* Show common columns first with special styling */}
              {findCommonColumns(leftNode.columns, rightNode.columns).map((col) => (
                <option key={`common-${col}`} value={col}>
                  {col} (common)
                </option>
              ))}
              {/* Show separator if there are common columns */}
              {findCommonColumns(leftNode.columns, rightNode.columns).length > 0 && (
                <option disabled value="">──────────</option>
              )}
              {/* Show remaining columns */}
              {rightNode.columns
                .filter(col => !findCommonColumns(leftNode.columns, rightNode.columns).includes(col))
                .map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
            </select>
          </div>
        </div>
      </div>

      {/* Join Options */}
      <div className="mt-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Join Type
            </label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New Node Name (optional)
            </label>
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

      {/* Join Description */}
      {leftOn && rightOn && (
        <div className="mt-4 p-3 bg-blue-50 rounded-md">
          <div className="text-sm text-blue-800">
            <strong>Join Preview:</strong> Performing {how} join between{' '}
            <code className="bg-blue-100 px-1 rounded">{leftNode.name}.{leftOn}</code> and{' '}
            <code className="bg-blue-100 px-1 rounded">{rightNode.name}.{rightOn}</code>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-6 flex justify-end space-x-3">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
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
