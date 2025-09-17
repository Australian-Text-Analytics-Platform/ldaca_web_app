import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useAuth } from '../../hooks/useAuth';
import { FrequencyAnalysisRequest, textApi } from '../../api/text';
import { nodesApi } from '../../api/index';
import { workspacesApi } from '../../api/workspaces';
import NodeSelectionPanel from '../NodeSelectionPanel';
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

// Component to display unique value count for a column
interface UniqueValueCountProps {
  workspaceId: string;
  nodeId: string;
  columnName: string;
}

const UniqueValueCount: React.FC<UniqueValueCountProps> = ({ workspaceId, nodeId, columnName }) => {
  const { getAuthHeaders } = useAuth();
  
  const { data, isLoading, error } = useQuery({
    queryKey: ['columnUniqueValues', workspaceId, nodeId, columnName],
  queryFn: () => nodesApi.uniqueValues(workspaceId, nodeId, columnName, getAuthHeaders()),
    enabled: !!workspaceId && !!nodeId && !!columnName,
  });

  if (isLoading) {
    return <span className="text-xs text-gray-500 px-2">Loading...</span>;
  }

  if (error || !data) {
    return <span className="text-xs text-red-500 px-2">Error</span>;
  }

  return (
    <span className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
      {data.unique_count} unique {data.has_more ? '(+)' : ''}
    </span>
  );
};

const TimelineTab: React.FC = () => {
  const { 
    selectedNodeId, 
    selectedNode,
    nodeData,
    isLoading,
    currentWorkspaceId
  } = useWorkspace();

  const { getAuthHeaders } = useAuth();

  // Node selection via shared panel (single node)
  const [nodeColumnSelections, setNodeColumnSelections] = useState<Array<{ nodeId: string; column: string }>>([]);

  const [timeColumn, setTimeColumn] = useState('');
  const [groupByColumns, setGroupByColumns] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');
  const [chartType, setChartType] = useState<'line' | 'bar' | 'area'>('line');
  const [isLocked, setIsLocked] = useState(false);
  const [lockedNodesSnapshot, setLockedNodesSnapshot] = useState<Array<{ id: string; name: string; columns: string[] }>>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<any>(null);

  // Utility function (duplicated from FilterTab) to normalize type names for consistent display
  const normalizeTypeName = (type: string): string => {
    const lowercaseType = type.toLowerCase();
    if (lowercaseType.includes('utf8') || lowercaseType.includes('string')) return 'string';
    if (lowercaseType.includes('int') && !lowercaseType.includes('interval')) return 'integer';
    if (lowercaseType.includes('float') || lowercaseType.includes('double')) return 'float';
    if (lowercaseType.includes('bool')) return 'boolean';
    if (lowercaseType.includes('datetime') || lowercaseType.includes('timestamp')) return 'datetime';
    if (lowercaseType.includes('list') || lowercaseType.includes('array')) return 'array';
    return 'string';
  };

  // Get available columns from node data with normalized datatypes (mirrors FilterTab logic)
  const availableColumns = useMemo(() => {
    // When locked, freeze the schema table using locked snapshot columns
    if (isLocked && lockedNodesSnapshot.length > 0) {
      const cols = lockedNodesSnapshot[0].columns || [];
      return cols.map((name: string) => ({ name, dataType: 'string' }));
    }
    const columns: Array<{ name: string; dataType: string }> = [];
    if (nodeData?.columns && Array.isArray(nodeData.columns) && nodeData?.dtypes) {
      nodeData.columns.forEach((colName: string) => {
        const rawDataType = nodeData.dtypes[colName] || 'unknown';
        const normalizedDataType = normalizeTypeName(rawDataType);
        columns.push({ name: colName, dataType: normalizedDataType });
      });
    } else if (nodeData?.dtypes && typeof nodeData.dtypes === 'object') {
      Object.keys(nodeData.dtypes).forEach(colName => {
        const rawDataType = nodeData.dtypes[colName] || 'unknown';
        const normalizedDataType = normalizeTypeName(rawDataType);
        columns.push({ name: colName, dataType: normalizedDataType });
      });
    } else if (selectedNode?.data?.schema) {
      Object.keys(selectedNode.data.schema).forEach(colName => {
        columns.push({ name: colName, dataType: 'string' });
      });
    }
    return columns;
  }, [isLocked, lockedNodesSnapshot, nodeData?.columns, nodeData?.dtypes, selectedNode?.data?.schema]);

// Keep nodeColumnSelections in sync with selectedNodeId
  useEffect(() => {
    if (isLocked) return;
    if (!selectedNodeId) { setNodeColumnSelections([]); return; }
    setNodeColumnSelections(prev => {
      const existing = prev.find(s => s.nodeId === selectedNodeId);
      if (existing) return prev;
      const initial = { nodeId: selectedNodeId, column: timeColumn || '' };
      return [initial];
    });
  }, [selectedNodeId]);

  // Auto-select first datetime-like column
  useEffect(() => {
    if (isLocked) return;
    if (availableColumns.length > 0 && !timeColumn) {
      const dateColumnObj = availableColumns.find((c) => 
        c.name.toLowerCase().includes('date') ||
        c.name.toLowerCase().includes('time') ||
        c.name.toLowerCase().includes('created') ||
        c.name.toLowerCase().includes('timestamp') ||
        c.dataType === 'datetime'
      );
      const picked = dateColumnObj?.name || availableColumns[0].name;
      setTimeColumn(picked);
      if (selectedNodeId) setNodeColumnSelections([{ nodeId: selectedNodeId, column: picked }]);
    }
  }, [availableColumns, timeColumn, selectedNodeId]);

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

    // Use column from picker state
    const picked = nodeColumnSelections.find(s=>s.nodeId===selectedNodeId)?.column || timeColumn;
    if (!picked) {
      alert('Please select a time column');
      return;
    }

    const validGroupByColumns = groupByColumns.filter(col => col.trim() !== '');

    const request: FrequencyAnalysisRequest = {
      time_column: picked,
      group_by_columns: validGroupByColumns.length > 0 ? validGroupByColumns : null,
      frequency,
      sort_by_time: true
    };

    try {
      setIsAnalyzing(true);
      const authHeaders = getAuthHeaders();
      const headers = Object.keys(authHeaders).length > 0 ? authHeaders as Record<string, string> : {};
      const result = await textApi.frequency(currentWorkspaceId, selectedNodeId, request, headers);
      setResults(result);
      // Lock with snapshot
      try {
        const info = await nodesApi.info(currentWorkspaceId, selectedNodeId, getAuthHeaders());
        const name = (info as any)?.name || (info as any)?.data?.name || selectedNodeId;
        const columns = Array.isArray((info as any)?.columns) ? (info as any).columns : (Array.isArray((info as any)?.data?.columns) ? (info as any).data.columns : []);
        setLockedNodesSnapshot([{ id: selectedNodeId, name: String(name), columns }]);
        setIsLocked(true);
      } catch { /* ignore */ }
    } catch (error) {
      console.error('Frequency analysis error:', error);
      alert(`Error performing frequency analysis: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

const handleClearResults = async () => {
    try {
      if (currentWorkspaceId) await workspacesApi.clearAnalysis(currentWorkspaceId, 'frequency_analysis', getAuthHeaders());
    } catch { /* ignore */ }
    setResults(null);
    setLockedNodesSnapshot([]);
    setIsLocked(false);
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

  // Hydration from backend once per mount
  const hydratedOnceRef = useRef<boolean>(false);
  useEffect(() => {
    (async () => {
      if (hydratedOnceRef.current) return;
      hydratedOnceRef.current = true;
      if (!currentWorkspaceId) return;
      try {
        // First check current-request; if null, don't request current-result
        const reqResp = await textApi.getFrequencyCurrentRequest(currentWorkspaceId, getAuthHeaders());
        if (!reqResp) {
          // No current request - fresh state
          return;
        }
        
        const req = (reqResp as any)?.data;
        if (req) {
          const nodeId = String(req.node_id || req.nodeId || selectedNodeId || '');
          const col = String(req.time_column || '');
          setNodeColumnSelections(nodeId ? [{ nodeId, column: col }] : []);
          setTimeColumn(col);
          setGroupByColumns(Array.isArray(req.group_by_columns) ? req.group_by_columns : []);
          setFrequency(req.frequency as any);
          
          // Lock and snapshot node
          try {
            const nodeIdStr = String(req.node_id || req.nodeId || selectedNodeId || '');
            if (nodeIdStr) {
              const info = await nodesApi.info(currentWorkspaceId, nodeIdStr, getAuthHeaders());
              const name = (info as any)?.name || (info as any)?.data?.name || nodeIdStr;
              const columns = Array.isArray((info as any)?.columns) ? (info as any).columns : (Array.isArray((info as any)?.data?.columns) ? (info as any).data.columns : []);
              setLockedNodesSnapshot([{ id: nodeIdStr, name: String(name), columns }]);
              setIsLocked(true);
            }
          } catch { /* ignore */ }
        }
        
        // Now get current-result
        const resResp = await textApi.getFrequencyCurrentResult(currentWorkspaceId, getAuthHeaders());
        if (!resResp) {
          // No result yet
          return;
        }
        
        const res = (resResp as any)?.data;
        if (res) {
          setResults(resResp);
        }
      } catch { /* ignore */ }
    })();
  }, [currentWorkspaceId, getAuthHeaders]);

  return (
    <div className="p-4 space-y-4">
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium text-gray-900">Timeline Analysis</h3>
{isLocked && (
            <div className="relative group flex items-center text-sm text-gray-600 cursor-default">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M5 8V6a5 5 0 1110 0v2h1a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1h1zm2-2a3 3 0 116 0v2H7V6zm-2 4h10v7H5v-7z" clipRule="evenodd" />
              </svg>
              Locked
              <div className="absolute right-0 mt-2 w-72 z-10 hidden group-hover:block bg-white border border-gray-200 shadow-lg rounded p-2 text-xs text-gray-700">
                <div className="font-semibold mb-1">Panel locked</div>
                <ul className="list-disc ml-4 space-y-1">
                  <li>Locked to current request/results.</li>
                  <li>Node selection and backend-used parameters are disabled.</li>
                  <li>Frontend-only options (e.g., chart type) stay editable.</li>
                  <li>Clear results to unlock and resync with the graph selection.</li>
                </ul>
              </div>
            </div>
          )}
        </div>
        <NodeSelectionPanel
          selectedNodes={(isLocked && lockedNodesSnapshot.length) ? lockedNodesSnapshot.map(s=>({ id: s.id, name: s.name, data: { name: s.name, nodeName: s.name, label: s.name, columns: s.columns }, columns: s.columns })) : (selectedNode ? [{ id: selectedNode.id, name: selectedNode.data?.name, data: selectedNode.data }] : [])}
          nodeColumnSelections={nodeColumnSelections}
          onColumnChange={(nodeId, column) => { if (isLocked) return; setNodeColumnSelections([{ nodeId, column }]); setTimeColumn(column); }}
          nodeColors={{}}
          onColorChange={()=>{}}
          getNodeColumns={(node: any) => {
            if (node?.data?.columns && Array.isArray(node.data.columns)) return node.data.columns;
            if (node?.columns && Array.isArray(node.columns)) return node.columns;
            if (node?.data?.dtypes && typeof node.data.dtypes === 'object') return Object.keys(node.data.dtypes);
            if (node?.data?.schema) return Object.keys(node.data.schema);
            return [];
          }}
          defaultPalette={[]}
          maxCompare={1}
          className="mb-0"
          showShape
          getNodeShapeFn={async (id: string) => {
            // Reuse unique values query as proxy only if needed; keep shape hidden if not available
            return null;
          }}
          showColorPicker={false}
          disabled={!!isLocked}
          locked={!!isLocked}
          columnLabelFn={() => 'Time Column *'}
          renderNodeMeta={() => (
            <div className="pt-1">
              <div className="text-xs font-semibold text-gray-600 mb-1 tracking-wide">SCHEMA</div>
              <div className="overflow-x-auto border border-gray-200 rounded-md bg-white">
                <table className="text-[11px] font-mono border-collapse">
                  <tbody>
                    <tr className="align-top">
                      {availableColumns.map((col) => (
                        <td key={col.name + '-name'} className="px-2 py-1 font-semibold text-gray-700 whitespace-nowrap border-b border-gray-100 min-w-[6rem]">{col.name}</td>
                      ))}
                    </tr>
                    <tr className="align-top">
                      {availableColumns.map((col) => (
                        <td key={col.name + '-type'} className="px-2 py-1 text-gray-500 whitespace-nowrap min-w-[6rem]">{col.dataType}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="text-[10px] text-gray-400 mt-1">Scroll horizontally to view all {availableColumns.length} column(s).</div>
            </div>
          )}
        />

        {/* Analysis Configuration */}
        <div className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                disabled={groupByColumns.length >= 3 || !!isLocked}
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
                  disabled={!!isLocked}
                >
                  <option value="">Select Column</option>
                  {availableColumns.map((col) => (
                    <option key={col.name} value={col.name}>{col.name} ({col.dataType})</option>
                  ))}
                </select>
                {column && (
                  <UniqueValueCount 
                    workspaceId={currentWorkspaceId || ''} 
                    nodeId={(isLocked && lockedNodesSnapshot.length ? lockedNodesSnapshot[0].id : (selectedNodeId || ''))} 
                    columnName={column} 
                  />
                )}
                <button
                  onClick={() => handleRemoveGroupByColumn(index)}
                  className="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                  disabled={!!isLocked}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-2 mt-2">
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || isLoading.operations || !selectedNodeId || !timeColumn || !!isLocked}
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
                <span className="ml-2">{timeColumn}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Frequency:</span>
                <span className="ml-2 capitalize">{frequency}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Total Records:</span>
                <span className="ml-2">{results.total_records}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Groups:</span>
                <span className="ml-2">
                  {groupByColumns.length ? groupByColumns.join(', ') : 'None'}
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
