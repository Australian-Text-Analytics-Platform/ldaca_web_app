import React, { useState, useEffect, useMemo } from 'react';
import { useWorkspace } from '../hooks/useWorkspace';
import { FilterCondition, FilterRequest } from '../api';

// Extended interface for UI with tracking ID
interface FilterConditionWithId extends FilterCondition {
  id: string;
}

const FilterTab: React.FC = () => {
  const { 
    selectedNodeId, 
    selectedNode,
    nodeData,
    filterNode,
    isLoading
  } = useWorkspace();

  const [conditions, setConditions] = useState<FilterConditionWithId[]>([{
    id: '1',
    column: '',
    operator: 'eq',
    value: ''
  }]);
  const [logic, setLogic] = useState<'and' | 'or'>('and');
  const [newNodeName, setNewNodeName] = useState('');
  const [isFiltering, setIsFiltering] = useState(false);

  // Get available columns from node data (which includes actual column names)
  const availableColumns = useMemo(() => {
    // First try to get columns from nodeData (which includes actual column names)
    if (nodeData?.columns && Array.isArray(nodeData.columns)) {
      return nodeData.columns;
    }
    // Fallback to dtypes keys if available
    if (nodeData?.dtypes && typeof nodeData.dtypes === 'object') {
      return Object.keys(nodeData.dtypes);
    }
    // Last fallback to schema if available
    if (selectedNode?.data?.schema) {
      return Object.keys(selectedNode.data.schema);
    }
    return [];
  }, [nodeData?.columns, nodeData?.dtypes, selectedNode?.data?.schema]);

  // Auto-generate node name based on selected node
  useEffect(() => {
    if (selectedNode?.data?.name) {
      setNewNodeName(`${selectedNode.data.name}_filtered`);
    }
  }, [selectedNode]);

  const handleAddCondition = () => {
    const newCondition: FilterConditionWithId = {
      id: Date.now().toString(),
      column: availableColumns[0] || '',
      operator: 'eq',
      value: ''
    };
    setConditions([...conditions, newCondition]);
  };

  const handleRemoveCondition = (id: string) => {
    if (conditions.length > 1) {
      setConditions(conditions.filter(c => c.id !== id));
    }
  };

  const handleConditionChange = (id: string, field: keyof FilterConditionWithId, value: any) => {
    setConditions(conditions.map(c => 
      c.id === id ? { ...c, [field]: value } : c
    ));
  };

  const handleApplyFilter = async () => {
    if (!selectedNodeId) {
      alert('Please select a node first');
      return;
    }

    if (conditions.some(c => !c.column || c.value === '')) {
      alert('Please fill in all filter conditions');
      return;
    }

    const request: FilterRequest = {
      conditions: conditions.map(c => ({
        column: c.column,
        operator: c.operator,
        value: c.value
      })),
      logic,
      new_node_name: newNodeName || undefined
    };

    try {
      setIsFiltering(true);
      await filterNode(selectedNodeId, request);
      // Success - the graph should automatically refresh due to query invalidation
    } catch (error) {
      console.error('Filter error:', error);
      alert(`Error applying filter: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsFiltering(false);
    }
  };

  if (!selectedNodeId) {
    return (
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="text-lg font-medium text-blue-800 mb-2">Filter Data</h3>
        <p className="text-blue-700">
          Please select a node from the graph to apply filters.
        </p>
      </div>
    );
  }

  if (availableColumns.length === 0) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <h3 className="text-lg font-medium text-yellow-800 mb-2">Filter Data</h3>
        <p className="text-yellow-700">
          Loading node schema... Please wait.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Filter Data</h3>
      
      {/* Selected Node Info */}
      <div className="bg-gray-50 p-3 rounded-lg">
        <p className="text-sm text-gray-600">
          <strong>Selected Node:</strong> {selectedNode?.data?.name || selectedNodeId}
        </p>
        <p className="text-sm text-gray-600">
          <strong>Available Columns:</strong> {availableColumns.join(', ')}
        </p>
      </div>

      {/* Filter Conditions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-md font-medium text-gray-800">Filter Conditions</h4>
          <button
            onClick={handleAddCondition}
            className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
          >
            Add Condition
          </button>
        </div>

        {conditions.map((condition, index) => (
          <div key={condition.id} className="flex items-center space-x-2 p-3 bg-gray-50 rounded-lg">
            {index > 0 && (
              <select
                value={logic}
                onChange={(e) => setLogic(e.target.value as 'and' | 'or')}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              >
                <option value="and">AND</option>
                <option value="or">OR</option>
              </select>
            )}
            
            <select
              value={condition.column}
              onChange={(e) => handleConditionChange(condition.id, 'column', e.target.value)}
              className="px-2 py-1 border border-gray-300 rounded text-sm flex-1"
            >
              <option value="">Select Column</option>
              {availableColumns.map((col: string) => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>

            <select
              value={condition.operator}
              onChange={(e) => handleConditionChange(condition.id, 'operator', e.target.value)}
              className="px-2 py-1 border border-gray-300 rounded text-sm"
            >
              <option value="eq">Equals</option>
              <option value="ne">Not Equals</option>
              <option value="gt">Greater Than</option>
              <option value="gte">Greater Than or Equal</option>
              <option value="lt">Less Than</option>
              <option value="lte">Less Than or Equal</option>
              <option value="contains">Contains</option>
              <option value="startswith">Starts With</option>
              <option value="endswith">Ends With</option>
              <option value="is_null">Is Null</option>
              <option value="is_not_null">Is Not Null</option>
            </select>

            {condition.operator !== 'is_null' && condition.operator !== 'is_not_null' && (
              <input
                type="text"
                value={String(condition.value)}
                onChange={(e) => handleConditionChange(condition.id, 'value', e.target.value)}
                placeholder="Filter value"
                className="px-2 py-1 border border-gray-300 rounded text-sm flex-1"
              />
            )}

            {conditions.length > 1 && (
              <button
                onClick={() => handleRemoveCondition(condition.id)}
                className="px-2 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {/* New Node Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          New Node Name
        </label>
        <input
          type="text"
          value={newNodeName}
          onChange={(e) => setNewNodeName(e.target.value)}
          placeholder="Enter name for filtered data"
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        />
      </div>

      {/* Apply Button */}
      <button
        onClick={handleApplyFilter}
        disabled={isFiltering || isLoading.operations}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
      >
        {isFiltering ? 'Applying Filter...' : 'Apply Filter'}
      </button>
    </div>
  );
};

export default FilterTab;
