import React, { useState, useEffect, useMemo } from 'react';
import { useWorkspace } from '../hooks/useWorkspace';
import { useAuth } from '../hooks/useAuth';
import { FrequencyAnalysisRequest, frequencyAnalysis } from '../api';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
} from 'recharts';

const TimelineTab: React.FC = () => {
  const { 
    selectedNodeId, 
    selectedNode,
    nodeData,
    isLoading,
    currentWorkspaceId
  } = useWorkspace();

  const { getAuthHeaders } = useAuth();

  const [timeColumn, setTimeColumn] = useState('');
  const [groupByColumns, setGroupByColumns] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [chartType, setChartType] = useState<'line' | 'bar' | 'area'>('line');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<any>(null);

  // Get available columns from node data - memoized to prevent useEffect dependency issues
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

  // Auto-select first datetime-like column
  useEffect(() => {
    if (availableColumns.length > 0 && !timeColumn) {
      // Try to find a column that might contain datetime
      const dateColumn = availableColumns.find((col: string) => 
        col.toLowerCase().includes('date') || 
        col.toLowerCase().includes('time') || 
        col.toLowerCase().includes('created') ||
        col.toLowerCase().includes('timestamp')
      );
      setTimeColumn(dateColumn || availableColumns[0]);
    }
  }, [availableColumns, timeColumn]);

  const handleAddGroupByColumn = () => {
    if (groupByColumns.length < 3) {
      setGroupByColumns([...groupByColumns, '']);
    }
  };

  const handleRemoveGroupByColumn = (index: number) => {
    setGroupByColumns(groupByColumns.filter((_, i) => i !== index));
  };

  const handleGroupByColumnChange = (index: number, value: string) => {
    const newColumns = [...groupByColumns];
    newColumns[index] = value;
    setGroupByColumns(newColumns);
  };

  const handleAnalyze = async () => {
    if (!selectedNodeId || !currentWorkspaceId) {
      alert('Please select a node first');
      return;
    }

    if (!timeColumn) {
      alert('Please select a time column');
      return;
    }

    // Filter out empty group by columns
    const validGroupByColumns = groupByColumns.filter(col => col.trim() !== '');

    const request: FrequencyAnalysisRequest = {
      time_column: timeColumn,
      group_by_columns: validGroupByColumns.length > 0 ? validGroupByColumns : null,
      frequency,
      sort_by_time: true
    };

    try {
      setIsAnalyzing(true);
      const authHeaders = getAuthHeaders();
      const headers = Object.keys(authHeaders).length > 0 ? authHeaders as Record<string, string> : {};
      const result = await frequencyAnalysis(currentWorkspaceId, selectedNodeId, request, headers);
      setResults(result);
    } catch (error) {
      console.error('Frequency analysis error:', error);
      alert(`Error performing frequency analysis: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleClearResults = () => {
    setResults(null);
  };

  // Prepare data for chart visualization
  const chartData = useMemo(() => {
    if (!results?.data || !Array.isArray(results.data)) {
      return [];
    }

    const groupByColumns = results.analysis_params?.group_by_columns;
    
    if (!groupByColumns || groupByColumns.length === 0) {
      // No grouping - simple time series
      return results.data.map((item: any) => ({
        time_period: item.time_period_formatted || item.time_period,
        frequency_count: item.frequency_count,
        ...item
      }));
    }

    // With grouping - need to reshape data for recharts
    const timeMap = new Map<string, any>();
    
    results.data.forEach((item: any) => {
      const timePeriod = item.time_period_formatted || item.time_period;
      const groupKey = groupByColumns.map((col: string) => item[col]).join(' - ');
      
      if (!timeMap.has(timePeriod)) {
        timeMap.set(timePeriod, { time_period: timePeriod });
      }
      
      const timeEntry = timeMap.get(timePeriod);
      timeEntry[groupKey] = item.frequency_count;
    });
    
    return Array.from(timeMap.values()).sort((a, b) => 
      a.time_period.localeCompare(b.time_period)
    );
  }, [results]);

  // Get unique group values for legend colors
  const groupKeys = useMemo(() => {
    if (!results?.analysis_params?.group_by_columns || !chartData.length) {
      return ['frequency_count'];
    }
    
    // Extract all group keys from the transformed data
    const keys = new Set<string>();
    chartData.forEach((item: any) => {
      Object.keys(item).forEach(key => {
        if (key !== 'time_period') {
          keys.add(key);
        }
      });
    });
    
    return Array.from(keys);
  }, [results, chartData]);

  // Color palette for different groups
  const colors = [
    '#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00ff00', 
    '#ff00ff', '#00ffff', '#ff8042', '#0088fe', '#00c49f'
  ];

  const renderChart = () => {
    if (!chartData.length) return null;

    const commonProps = {
      width: 800,
      height: 400,
      data: chartData,
      margin: { top: 20, right: 30, left: 20, bottom: 60 }
    };

    switch (chartType) {
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="time_period" 
                angle={-45}
                textAnchor="end"
                height={100}
                interval={0}
              />
              <YAxis />
              <Tooltip />
              <Legend />
              {groupKeys.map((key, index) => (
                <Bar 
                  key={key}
                  dataKey={key} 
                  fill={colors[index % colors.length]} 
                  name={key}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="time_period" 
                angle={-45}
                textAnchor="end"
                height={100}
                interval={0}
              />
              <YAxis />
              <Tooltip />
              <Legend />
              {groupKeys.map((key, index) => (
                <Area 
                  key={key}
                  type="monotone" 
                  dataKey={key} 
                  stackId="1"
                  stroke={colors[index % colors.length]} 
                  fill={colors[index % colors.length]}
                  fillOpacity={0.6}
                  name={key}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        );

      default: // line chart
        return (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="time_period" 
                angle={-45}
                textAnchor="end"
                height={100}
                interval={0}
              />
              <YAxis />
              <Tooltip />
              <Legend />
              {groupKeys.map((key, index) => (
                <Line 
                  key={key}
                  type="monotone" 
                  dataKey={key} 
                  stroke={colors[index % colors.length]} 
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  name={key}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );
    }
  };

  if (!selectedNodeId) {
    return (
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="text-lg font-medium text-blue-800 mb-2">Timeline Analysis</h3>
        <p className="text-blue-700">
          Please select a node from the graph to perform timeline analysis.
        </p>
      </div>
    );
  }

  if (availableColumns.length === 0) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <h3 className="text-lg font-medium text-yellow-800 mb-2">Timeline Analysis</h3>
        <p className="text-yellow-700">
          Loading node schema... Please wait.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Timeline Analysis</h3>
      
      {/* Selected Node Info */}
      <div className="bg-gray-50 p-3 rounded-lg">
        <p className="text-sm text-gray-600">
          <strong>Selected Node:</strong> {selectedNode?.data?.name || selectedNodeId}
        </p>
        <p className="text-sm text-gray-600">
          <strong>Available Columns:</strong> {availableColumns.join(', ')}
        </p>
      </div>

      {/* Analysis Configuration */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Time Column Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Time Column *
            </label>
            <select
              value={timeColumn}
              onChange={(e) => setTimeColumn(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">Select Time Column</option>
              {availableColumns.map((col: string) => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </div>

          {/* Frequency Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Frequency
            </label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as 'daily' | 'weekly' | 'monthly' | 'yearly')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
        </div>

        {/* Group By Columns */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-medium text-gray-700">
              Group By Columns (Optional, max 3)
            </label>
            <button
              onClick={handleAddGroupByColumn}
              disabled={groupByColumns.length >= 3}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              Add Group
            </button>
          </div>
          
          {groupByColumns.map((column, index) => (
            <div key={index} className="flex items-center space-x-2 mb-2">
              <select
                value={column}
                onChange={(e) => handleGroupByColumnChange(index, e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">Select Column</option>
                {availableColumns.map((col: string) => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
              <button
                onClick={() => handleRemoveGroupByColumn(index)}
                className="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex space-x-2">
        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing || isLoading.operations}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
        >
          {isAnalyzing ? 'Analyzing...' : 'Analyze Timeline'}
        </button>

        {results && (
          <button
            onClick={handleClearResults}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            Clear Results
          </button>
        )}
      </div>

      {/* Results Display */}
      {results && (
        <div className="mt-6">
          <div className="flex justify-between items-center mb-4">
            <h4 className="text-lg font-medium text-gray-900">Timeline Results</h4>
            <div className="flex space-x-2">
              <span className="text-sm text-gray-600">Chart Type:</span>
              <select
                value={chartType}
                onChange={(e) => setChartType(e.target.value as 'line' | 'bar' | 'area')}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              >
                <option value="line">Line Chart</option>
                <option value="bar">Bar Chart</option>
                <option value="area">Area Chart</option>
              </select>
            </div>
          </div>

          {/* Analysis Summary */}
          <div className="bg-gray-50 p-3 rounded-lg mb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-700">Time Column:</span>
                <span className="ml-2">{results.analysis_params?.time_column}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Frequency:</span>
                <span className="ml-2 capitalize">{results.analysis_params?.frequency}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Total Records:</span>
                <span className="ml-2">{results.total_records}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Groups:</span>
                <span className="ml-2">
                  {results.analysis_params?.group_by_columns?.join(', ') || 'None'}
                </span>
              </div>
            </div>
          </div>
          
          {/* Chart Visualization */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            {renderChart()}
          </div>
        </div>
      )}
    </div>
  );
};

export default TimelineTab;
