import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '../../hooks/useWorkspaceStatus';
import { useAuth } from '../../hooks/useAuth';
import { FrequencyAnalysisRequest, textApi } from '../../api/text';
import { nodesApi } from '../../api/index';
import NodeSelectionPanel from '../NodeSelectionPanel';
import { normalizeTypeName } from '../../utils/columnTypes';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../ui/chart';
import { Loader2, Play, Plus, Trash2 } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
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
  const { selectedNodeId, selectedNode, selectedNodes } = useWorkspaceSelection();
  const { nodeData, currentWorkspaceId } = useWorkspaceData();
  const { isLoading } = useWorkspaceStatus();

  const { getAuthHeaders } = useAuth();

  // Node selection via shared panel (single node)
  const [nodeColumnSelections, setNodeColumnSelections] = useState<Array<{ nodeId: string; column: string }>>([]);

  const [timeColumn, setTimeColumn] = useState('');
  const [groupByColumns, setGroupByColumns] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');
  const [chartType, setChartType] = useState<'line' | 'bar' | 'area'>('line');
  const [isLocked, setIsLocked] = useState(false);
  const [lockedNodesSnapshot, setLockedNodesSnapshot] = useState<Array<{ id: string; name: string; columns: string[] }>>([]);
  // Store schema (column -> js_type) separately so we don't lose types when locking/unlocking
  const [currentSchema, setCurrentSchema] = useState<Record<string,string>>({});
  const [lockedSchema, setLockedSchema] = useState<Record<string,string> | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<any>(null);

  // Get available columns from schema (prefer fetched schema; fallback to nodeData/selectedNode) preserving types
  const availableColumns = useMemo(() => {
    const effectiveSchema = isLocked ? (lockedSchema || currentSchema) : currentSchema;
    if (effectiveSchema && Object.keys(effectiveSchema).length > 0) {
      return Object.entries(effectiveSchema).map(([name, jsType]) => ({ name, dataType: jsType }));
    }
    // Fallback logic (legacy) only if schema not yet fetched
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
      // selectedNode.data.schema may already be array of objects or mapping; attempt to parse
      const schemaObj = Array.isArray(selectedNode.data.schema)
        ? Object.fromEntries(selectedNode.data.schema.map((c:any)=>[c.name, c.js_type || 'string']))
        : selectedNode.data.schema;
      Object.entries(schemaObj).forEach(([colName, jsType]) => {
        columns.push({ name: colName, dataType: typeof jsType === 'string' ? normalizeTypeName(jsType) : 'string' });
      });
    }
    return columns;
  }, [isLocked, lockedSchema, currentSchema, nodeData?.columns, nodeData?.dtypes, selectedNode?.data?.schema]);

  const datetimeColumns = useMemo(
    () => availableColumns.filter((column) => column.dataType === 'datetime'),
    [availableColumns]
  );

  const timeColumnOptions = useMemo(
    () => datetimeColumns.map((column) => column.name),
    [datetimeColumns]
  );

  // Fetch schema on-demand when selected node changes (and not locked)
  useEffect(() => {
    if (!selectedNodeId || isLocked) return;
    (async () => {
      try {
        if (!currentWorkspaceId) return;
        const info = await nodesApi.info(currentWorkspaceId, selectedNodeId, getAuthHeaders());
        // info.schema could be array (NodeSummary) or mapping (legacy). Normalize to mapping of js_type.
        let schemaMap: Record<string,string> = {};
        const rawSchema = (info as any)?.schema;
        if (Array.isArray(rawSchema)) {
          schemaMap = Object.fromEntries(rawSchema.map((c:any)=>[c.name, c.js_type || 'string']));
        } else if (rawSchema && typeof rawSchema === 'object') {
          schemaMap = Object.fromEntries(Object.entries(rawSchema).map(([k,v])=>[k, typeof v === 'string' ? normalizeTypeName(v) : 'string']));
        }
        if (Object.keys(schemaMap).length > 0) setCurrentSchema(schemaMap);
      } catch { /* ignore schema fetch errors */ }
    })();
  }, [selectedNodeId, isLocked, currentWorkspaceId, getAuthHeaders]);

  useEffect(() => {
    if (isLocked) return;
    if (!selectedNodeId) {
      setNodeColumnSelections([]);
      setTimeColumn('');
      return;
    }

    if (!timeColumnOptions.length) {
      setNodeColumnSelections((prev) => {
        if (prev.length === 1 && prev[0].nodeId === selectedNodeId && prev[0].column === '') {
          return prev;
        }
        return [{ nodeId: selectedNodeId, column: '' }];
      });
      if (timeColumn !== '') {
        setTimeColumn('');
      }
      return;
    }

    const desired = timeColumnOptions.includes(timeColumn) ? timeColumn : timeColumnOptions[0];
    if (desired !== timeColumn) {
      setTimeColumn(desired);
    }

    setNodeColumnSelections((prev) => {
      if (prev.length === 1 && prev[0].nodeId === selectedNodeId && prev[0].column === desired) {
        return prev;
      }
      return [{ nodeId: selectedNodeId, column: desired }];
    });
  }, [isLocked, selectedNodeId, timeColumn, timeColumnOptions]);

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
      const enrichedResult = {
        ...result,
        analysis_params: {
          ...(result as any)?.analysis_params,
          group_by_columns: validGroupByColumns,
          time_column: picked,
          frequency,
        },
      };
      setResults(enrichedResult);
      // Lock with snapshot & preserve schema
      try {
        const info = await nodesApi.info(currentWorkspaceId, selectedNodeId, getAuthHeaders());
        const name = (info as any)?.name || (info as any)?.data?.name || selectedNodeId;
        const columns = Array.isArray((info as any)?.columns) ? (info as any).columns : (Array.isArray((info as any)?.data?.columns) ? (info as any).data.columns : []);
        setLockedNodesSnapshot([{ id: selectedNodeId, name: String(name), columns }]);
        // Capture schema for locked display
        const rawSchema = (info as any)?.schema;
        if (Array.isArray(rawSchema)) {
          setLockedSchema(Object.fromEntries(rawSchema.map((c:any)=>[c.name, c.js_type || 'string'])));
        } else if (rawSchema && typeof rawSchema === 'object') {
          setLockedSchema(Object.fromEntries(Object.entries(rawSchema).map(([k,v])=>[k, typeof v === 'string' ? normalizeTypeName(v) : 'string'])));
        } else {
          setLockedSchema(currentSchema);
        }
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
      if (currentWorkspaceId) await textApi.clearFrequencyAnalysis(currentWorkspaceId, getAuthHeaders());
    } catch { /* ignore */ }
    setResults(null);
    setLockedNodesSnapshot([]);
    setLockedSchema(null);
    setIsLocked(false);
  };

  // Prepare data for chart visualization
  const chartData = useMemo(() => {
    if (!results?.data || !Array.isArray(results.data)) {
      return [];
    }

    const groupingColumns = (results as any)?.analysis_params?.group_by_columns;
    const effectiveGroupColumns = Array.isArray(groupingColumns)
      ? groupingColumns
      : (groupByColumns.length ? groupByColumns : []);
    
    if (!effectiveGroupColumns || effectiveGroupColumns.length === 0) {
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
      const groupKey = effectiveGroupColumns.map((col: string) => item[col]).join(' - ');
      
      if (!timeMap.has(timePeriod)) {
        timeMap.set(timePeriod, { time_period: timePeriod });
      }
      
      const timeEntry = timeMap.get(timePeriod);
      timeEntry[groupKey] = item.frequency_count;
    });
    
    return Array.from(timeMap.values()).sort((a, b) => 
      a.time_period.localeCompare(b.time_period)
    );
  }, [results, groupByColumns]);

  // Get unique group values for legend colors
  const groupKeys = useMemo(() => {
    const groupingColumns = (results as any)?.analysis_params?.group_by_columns;
    const effectiveGroupColumns = Array.isArray(groupingColumns)
      ? groupingColumns
      : (groupByColumns.length ? groupByColumns : []);

    if (!effectiveGroupColumns.length || !chartData.length) {
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
  }, [results, chartData, groupByColumns]);

  const chartConfig = useMemo<ChartConfig>(() => {
    if (!groupKeys.length || (groupKeys.length === 1 && groupKeys[0] === 'frequency_count')) {
      return {
        frequency_count: {
          label: 'Frequency Count',
          color: 'hsl(var(--chart-1))',
        },
      };
    }

    return groupKeys.reduce<ChartConfig>((acc, key, index) => {
      const colorIndex = (index % 5) + 1;
      acc[key] = {
        label: key,
        color: `hsl(var(--chart-${colorIndex}))`,
      };
      return acc;
    }, {});
  }, [groupKeys]);

  const seriesColor = useCallback((key: string) => {
    return `var(--color-${key.toString().toLowerCase().replace(/[^a-z0-9]+/g, '-')})`;
  }, []);

  const formatTimeLabel = useCallback((value?: string | number) => {
    if (!value) return '—';
    const str = String(value);
    const parsed = new Date(str);
    if (!Number.isNaN(parsed.getTime())) {
      const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'short',
      };
      if (!(parsed.getUTCDate() === 1 && parsed.getUTCHours() === 0 && parsed.getUTCMinutes() === 0)) {
        options.day = 'numeric';
      }
      return parsed.toLocaleString(undefined, options);
    }
    return str;
  }, []);

  const renderChart = useCallback(() => {
    if (!chartData.length) {
      return (
        <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-muted-foreground/30 text-sm text-muted-foreground">
          No timeline data available. Adjust your configuration and try again.
        </div>
      );
    }

    const margin = { top: 20, right: 30, left: 20, bottom: 60 };

    const axisTickProps = {
      angle: -45,
      textAnchor: 'end' as const,
      height: 100,
      interval: 0 as const,
    };

    return (
      <ChartContainer config={chartConfig} className="aspect-auto h-[420px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart data={chartData} margin={margin}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time_period" {...axisTickProps} />
              <YAxis />
              <ChartTooltip
                content={<ChartTooltipContent className="min-w-[200px]" labelFormatter={formatTimeLabel} />}
              />
              <Legend />
              {groupKeys.map((key) => (
                <Bar key={key} dataKey={key} fill={seriesColor(key)} radius={[6, 6, 0, 0]} name={key} />
              ))}
            </BarChart>
          ) : chartType === 'area' ? (
            <AreaChart data={chartData} margin={margin}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time_period" {...axisTickProps} />
              <YAxis />
              <ChartTooltip
                content={<ChartTooltipContent className="min-w-[200px]" labelFormatter={formatTimeLabel} />}
              />
              <Legend />
              {groupKeys.map((key) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stackId="1"
                  stroke={seriesColor(key)}
                  fill={seriesColor(key)}
                  fillOpacity={0.35}
                  name={key}
                />
              ))}
            </AreaChart>
          ) : (
            <LineChart data={chartData} margin={margin}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time_period" {...axisTickProps} />
              <YAxis />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    className="min-w-[200px]"
                    indicator="line"
                    labelFormatter={formatTimeLabel}
                  />
                }
              />
              <Legend />
              {groupKeys.map((key) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={seriesColor(key)}
                  strokeWidth={2}
                  dot={false}
                  name={key}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </ChartContainer>
    );
  }, [chartData, chartConfig, chartType, groupKeys, seriesColor, formatTimeLabel]);

  const summaryTimeColumn = (results?.analysis_params?.time_column as string | undefined) ?? timeColumn;
  const summaryGroupBy = (results?.analysis_params?.group_by_columns as string[] | undefined) ?? groupByColumns;
  const summaryFrequency = (results?.analysis_params?.frequency as string | undefined) ?? frequency;

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
          if (!isLocked) {
            setNodeColumnSelections(nodeId ? [{ nodeId, column: col }] : []);
            setTimeColumn(col);
          }
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
          const groupCols = Array.isArray((req as any)?.group_by_columns) ? (req as any).group_by_columns : [];
          const enriched = {
            ...resResp,
            analysis_params: {
              ...(resResp as any)?.analysis_params,
              group_by_columns: groupCols,
              time_column: (req as any)?.time_column || '',
              frequency: (req as any)?.frequency || frequency,
            },
          };
          setResults(enriched);
        }
      } catch { /* ignore */ }
    })();
  }, [currentWorkspaceId, getAuthHeaders]);

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Timeline Analysis</CardTitle>
              <CardDescription>Configure a time-series frequency view for the selected node.</CardDescription>
            </div>
{isLocked && (
              <div className="relative group flex items-center text-sm text-muted-foreground md:self-center">
                <svg className="mr-1 h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M5 8V6a5 5 0 1110 0v2h1a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1h1zm2-2a3 3 0 116 0v2H7V6zm-2 4h10v7H5v-7z" clipRule="evenodd" />
                </svg>
                Locked
                <div className="absolute right-0 top-full z-10 mt-2 hidden w-72 rounded border border-border bg-popover p-2 text-xs text-popover-foreground shadow-lg group-hover:block">
                  <div className="font-semibold mb-1">Panel locked</div>
                  <ul className="ml-4 space-y-1 list-disc">
                    <li>Locked to current request/results.</li>
                    <li>Node selection and backend-used parameters are disabled.</li>
                    <li>Frontend-only options (e.g., chart type) stay editable.</li>
                    <li>Clear results to unlock and resync with the graph selection.</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          <NodeSelectionPanel
            selectedNodes={(isLocked && lockedNodesSnapshot.length)
              ? lockedNodesSnapshot.map((s) => ({
                  id: s.id,
                  name: s.name,
                  data: { name: s.name, nodeName: s.name, label: s.name, columns: s.columns },
                  columns: s.columns,
                }))
              : (selectedNode ? [{ id: selectedNode.id, name: selectedNode.data?.name, data: selectedNode.data }] : [])}
            nodeColumnSelections={nodeColumnSelections}
            onColumnChange={(nodeId, column) => {
              if (isLocked) return;
              setNodeColumnSelections([{ nodeId, column }]);
              setTimeColumn(column);
            }}
            nodeColors={{}}
            onColorChange={() => {}}
            getNodeColumns={() => datetimeColumns}
            defaultPalette={[]}
            maxCompare={1}
            className="border border-dashed border-muted-foreground/40 rounded-lg bg-muted/30 p-4"
            showShape
            getNodeShapeFn={async (_id: string) => {
              return null;
            }}
            showColorPicker={false}
            disabled={!!isLocked}
            locked={!!isLocked}
            originalCount={selectedNodes?.length || (selectedNode ? 1 : 0)}
            columnLabelFn={() => 'Time Column *'}
            allowedDataTypes={['datetime']}
            renderNodeMeta={() => (
              <div className="pt-1">
                <div className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground">SCHEMA (on-demand)</div>
                <div className="overflow-x-auto rounded-md border bg-background">
                  <table className="border-collapse text-[11px] font-mono">
                    <tbody>
                      <tr className="align-top">
                        {availableColumns.map((col) => (
                          <td key={col.name + '-name'} className="min-w-[6rem] whitespace-nowrap border-b border-border/60 px-2 py-1 font-semibold text-foreground">{col.name}</td>
                        ))}
                      </tr>
                      <tr className="align-top">
                        {availableColumns.map((col) => (
                          <td key={col.name + '-type'} className="min-w-[6rem] whitespace-nowrap px-2 py-1 text-muted-foreground">{col.dataType}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">Scroll horizontally to view all {availableColumns.length} column(s).</div>
              </div>
            )}
          />

          {/* Analysis Configuration */}
          <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Frequency Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Frequency
              </label>
              <Select
                value={frequency}
                onValueChange={(value) => setFrequency(value as 'daily' | 'weekly' | 'monthly' | 'yearly')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Group By Columns */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Group By Columns (Optional, max 3)
              </label>
              <Button
                onClick={handleAddGroupByColumn}
                disabled={groupByColumns.length >= 3 || !!isLocked}
                size="sm"
                className="gap-1"
              >
                <Plus className="h-4 w-4" />
                Add Group
              </Button>
            </div>
            
            {groupByColumns.map((column, index) => (
              <div key={index} className="flex items-center space-x-2 mb-2">
                <Select
                  value={column || undefined}
                  onValueChange={(value) => handleGroupByColumnChange(index, value)}
                  disabled={!!isLocked}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select column" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableColumns.map((col) => (
                      <SelectItem key={col.name} value={col.name}>
                        {col.name} ({col.dataType})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {column && (
                  <UniqueValueCount 
                    workspaceId={currentWorkspaceId || ''} 
                    nodeId={(isLocked && lockedNodesSnapshot.length ? lockedNodesSnapshot[0].id : (selectedNodeId || ''))} 
                    columnName={column} 
                  />
                )}
                <Button
                  onClick={() => handleRemoveGroupByColumn(index)}
                  variant="destructive"
                  size="sm"
                  disabled={!!isLocked}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={handleAnalyze}
            disabled={isAnalyzing || isLoading.operations || !selectedNodeId || !timeColumn || !!isLocked}
            className="w-full md:w-auto"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Analyze Timeline
              </>
            )}
          </Button>

          {results && (
            <Button
              onClick={handleClearResults}
              variant="outline"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Results
            </Button>
          )}
        </div>
        </CardContent>
      </Card>

      {/* Results Display */}
      {results && (
        <Card className="mt-6">
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Timeline Results</CardTitle>
              <CardDescription>
                {summaryTimeColumn
                  ? `Frequency of records grouped by ${summaryTimeColumn}`
                  : 'Aggregated frequency over time'}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Chart Type</span>
              <Select
                value={chartType}
                onValueChange={(value) => setChartType(value as 'line' | 'bar' | 'area')}
              >
                <SelectTrigger className="w-[140px] text-sm">
                  <SelectValue placeholder="Select chart" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="line">Line Chart</SelectItem>
                  <SelectItem value="bar">Bar Chart</SelectItem>
                  <SelectItem value="area">Area Chart</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border border-border/60 p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Time Column
                </span>
                <div className="mt-1 text-base font-semibold text-foreground">
                  {summaryTimeColumn || '—'}
                </div>
              </div>
              <div className="rounded-md border border-border/60 p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Frequency
                </span>
                <div className="mt-1 text-base font-semibold capitalize text-foreground">
                  {summaryFrequency}
                </div>
              </div>
              <div className="rounded-md border border-border/60 p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Total Records
                </span>
                <div className="mt-1 text-base font-semibold text-foreground">
                  {results?.total_records ?? '—'}
                </div>
              </div>
              <div className="rounded-md border border-border/60 p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Groups
                </span>
                <div className="mt-1 text-base font-semibold text-foreground">
                  {summaryGroupBy.length ? summaryGroupBy.join(', ') : 'None'}
                </div>
              </div>
            </div>

            {renderChart()}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default TimelineTab;
