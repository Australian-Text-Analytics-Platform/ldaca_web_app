import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '../../../hooks/useWorkspaceStatus';
import { useAuth } from '../../../hooks/useAuth';
import { useAnalysisLockState, useParameterChangeDetection } from '../../../hooks/useAnalysisLockState';
import { useSchemaManagement, useLatestRef, createNodeSnapshot, applySelectedColumnsToSnapshots } from '../../../hooks/useSchemaManagement';
import { SequentialAnalysisRequest, SequentialFrequency, textApi } from '../../../api/text';
import { nodesApi } from '../../../api/index';
import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import { getNodeInfo } from '../../../lib/nodeInfoCache';
import { ANALYSIS_LOCKED_MESSAGE } from '../../../components/tabs/AnalysisLockedNotice';
import { normalizeSchemaFromInfo } from '../../../hooks/useSchemaManagement';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import HelpIcon from '../../../components/help/HelpIcon';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../../components/ui/chart';
import { Loader2, Play, Plus, Trash2 } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
} from 'recharts';
import { normalizeTypeName } from '../../../utils/columnTypes';
import { getAnalysisActionState } from '../common/analysisActionState';
import { useAnalysisHydration } from '../common';
import {
  clearAnalysisTaskResults,
  collectTaskIds,
  resolveAnalysisTaskId,
} from '../../../hooks/analysisTaskUtils';

// Component to display unique value count for a column
interface UniqueValueCountProps {
  workspaceId: string;
  nodeId: string;
  columnName: string;
}

type SequentialAnalysisDatum = Record<string, unknown>;

type ChartTypeOption = 'line' | 'bar' | 'area';

const CHART_TYPE_OPTIONS: ChartTypeOption[] = ['line', 'bar', 'area'];
const isChartTypeOption = (value: unknown): value is ChartTypeOption =>
  typeof value === 'string' && CHART_TYPE_OPTIONS.includes(value as ChartTypeOption);

const FREQUENCY_OPTIONS: Array<{ value: SequentialFrequency; label: string }> = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const TIME_COMPATIBLE_TYPES = ['datetime', 'integer', 'float'] as const;
const NUMERIC_TYPE_SET = new Set(['integer', 'float']);

const parseNumericInput = (value: string): number | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const SEQUENTIAL_ANALYSIS_PALETTE = [
  '#2563eb', // blue
  '#16a34a', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#ec4899', // pink
  '#0ea5e9', // sky
  '#22c55e', // emerald
] as const;

const getPaletteColor = (index: number) => SEQUENTIAL_ANALYSIS_PALETTE[index % SEQUENTIAL_ANALYSIS_PALETTE.length];

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
      {data.unique_count} unique{data.has_null ? ' + null' : ''}
    </span>
  );
};

const SequentialAnalysisFeature: React.FC = () => {
  const { selectedNodeId, selectedNode } = useWorkspaceSelection();
  const { nodeData, currentWorkspaceId } = useWorkspaceData();
  const { isLoading } = useWorkspaceStatus();

  const { getAuthHeaders } = useAuth();

  // Use shared analysis lock state hook
  const {
    isLocked,
    setIsLocked,
    lockedNodesSnapshot,
    setLockedNodesSnapshot,
    activeNodeId,
    nodeColumnSelections,
    setNodeColumnSelections,
    displayNodeCount,
  } = useAnalysisLockState({
    allowedDataTypes: ['datetime'],
    maxNodes: 1,
    docTypeOnly: false,
    enableHeuristicGuess: false,
    storageScope: 'sequential-analysis', // Separate from other tabs
  });

  const [timeColumn, setTimeColumn] = useState('');
  const [groupByColumns, setGroupByColumns] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<SequentialFrequency>('daily');
  const [chartType, setChartType] = useState<ChartTypeOption>('line');
  const [numericOriginInput, setNumericOriginInput] = useState<string>('');
  const [numericIntervalInput, setNumericIntervalInput] = useState<string>('1');
  
  // Use schema management hook
  const {
    setLockedSchema,
    availableColumns,
    lockCurrentSchema,
    currentSchemaRef,
  } = useSchemaManagement({
    nodeId: activeNodeId,
    isLocked,
    workspaceId: currentWorkspaceId || undefined,
    getAuthHeaders,
    nodeData,
    selectedNode,
  });

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [localSequentialTaskId, setLocalSequentialTaskId] = useState<string | null>(null);
  const [hydratingSelection, setHydratingSelection] = useState(false);
  const hydratedParamsRef = useRef<{
    timeColumn: string;
    groupByColumns: string[];
    frequency: SequentialFrequency;
    columnType: 'datetime' | 'numeric';
    numericOrigin: number | null;
    numericInterval: number | null;
  } | null>(null);
  
  // Track locked parameters and detect changes
  const [lockedParams, setLockedParams] = useState<{
    frequency: SequentialFrequency;
    groupByColumns: string[];
    columnType: 'datetime' | 'numeric';
    numericOrigin: number | null;
    numericInterval: number | null;
    sortByTime: boolean;
  } | null>(null);

  // Ref for hydration logic (needed to access latest values in async effect)
  const frequencyRef = useLatestRef(frequency);
  const chartTypeRef = useLatestRef(chartType);

  useEffect(() => {
    if (!currentWorkspaceId) {
      setLocalSequentialTaskId(null);
    }
  }, [currentWorkspaceId]);

  const resolveSequentialTaskId = useCallback(async (): Promise<string | null> => {
    if (!currentWorkspaceId) {
      return null;
    }

    const metadataTaskId =
      (results as any)?.metadata?.task_id ??
      (results as any)?.metadata?.taskId ??
      null;

    return resolveAnalysisTaskId({
      candidateIds: [localSequentialTaskId, metadataTaskId],
      fetchCurrentTaskId: async () => {
        const headers = getAuthHeaders();
        const current = (await textApi.getAnalysisCurrent(
          currentWorkspaceId,
          'sequential-analysis',
          headers
        )) as any;
        const taskId = Array.isArray(current?.task_ids) ? current.task_ids[0] : null;
        return typeof taskId === 'string' && taskId.trim().length > 0 ? taskId : null;
      },
      onResolved: setLocalSequentialTaskId,
    });
  }, [currentWorkspaceId, getAuthHeaders, localSequentialTaskId, results]);

  const timeCompatibleColumns = useMemo(
    () =>
      availableColumns
        .map((column) => ({
          ...column,
          dataType: normalizeTypeName(column.dataType),
        }))
        .filter((column) => TIME_COMPATIBLE_TYPES.includes(column.dataType as (typeof TIME_COMPATIBLE_TYPES)[number]))
        .sort((a, b) => {
          const priority = (type: string) => (type === 'datetime' ? 0 : 1);
          return priority(a.dataType) - priority(b.dataType);
        }),
    [availableColumns]
  );

  const timeColumnOptions = useMemo(
    () => timeCompatibleColumns.map((column) => column.name),
    [timeCompatibleColumns]
  );

  const activeTimeColumn = (() => {
    if (!activeNodeId) return '';
    const selection = nodeColumnSelections.find((s) => s.nodeId === activeNodeId);
    if (selection?.column) return selection.column;
    if (timeColumn) return timeColumn;
    const hydratedTime = (results?.analysis_params?.time_column as string | undefined) ?? '';
    return hydratedTime;
  })();

  const activeColumnInfo = timeCompatibleColumns.find((column) => column.name === activeTimeColumn);
  const activeColumnType = normalizeTypeName(activeColumnInfo?.dataType || (timeCompatibleColumns[0]?.dataType ?? 'datetime'));
  const derivedColumnType: 'datetime' | 'numeric' = NUMERIC_TYPE_SET.has(activeColumnType) ? 'numeric' : 'datetime';
  const numericOriginValue = derivedColumnType === 'numeric' ? parseNumericInput(numericOriginInput) : null;
  const numericIntervalValue = derivedColumnType === 'numeric' ? parseNumericInput(numericIntervalInput) : null;

  // Use parameter change detection hook
  const hasParamsChanged = useParameterChangeDetection(
    isLocked,
    {
      frequency,
      groupByColumns,
      columnType: derivedColumnType,
      numericOrigin: derivedColumnType === 'numeric' ? numericOriginValue : null,
      numericInterval: derivedColumnType === 'numeric' ? numericIntervalValue : null,
      sortByTime: true,
    },
    lockedParams
  );

  const actionState = getAnalysisActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    hasSelection: Boolean(activeNodeId),
    isLocked,
    hasResults: Boolean(results),
    isBusy: isAnalyzing,
    hasActiveTask: false,
    allowRunWhenLocked: hasParamsChanged,
  });

  useEffect(() => {
    if (isLocked || hydratingSelection) return;
    if (!selectedNodeId) {
      setNodeColumnSelections([]);
      setTimeColumn('');
      return;
    }

    if (!timeColumnOptions.length) {
      // Check current state before updating to avoid infinite loop
      const currentSelection = nodeColumnSelections.find(s => s.nodeId === selectedNodeId);
      if (!currentSelection || currentSelection.column !== '') {
        setNodeColumnSelections([{ nodeId: selectedNodeId, column: '' }]);
      }
      if (timeColumn !== '') {
        setTimeColumn('');
      }
      return;
    }

    const desired = timeColumnOptions.includes(timeColumn) ? timeColumn : timeColumnOptions[0];
    if (desired !== timeColumn) {
      setTimeColumn(desired);
    }

    // Check current state before updating to avoid infinite loop
    const currentSelection = nodeColumnSelections.find(s => s.nodeId === selectedNodeId);
    if (!currentSelection || currentSelection.column !== desired) {
      setNodeColumnSelections([{ nodeId: selectedNodeId, column: desired }]);
    }
  }, [isLocked, hydratingSelection, selectedNodeId, timeColumn, timeColumnOptions, setNodeColumnSelections]);
  // Note: nodeColumnSelections intentionally excluded from deps to prevent infinite loop
  // We read it directly inside the effect to check current state

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
    const nodeIdForAnalysis = activeNodeId;
    if (!nodeIdForAnalysis || !currentWorkspaceId) {
      toast.error('Please select a node first');
      return;
    }

    // Use column from picker state
    const picked =
      nodeColumnSelections.find((s) => s.nodeId === nodeIdForAnalysis)?.column ||
      timeColumn ||
      (results?.analysis_params?.time_column as string | undefined) ||
      '';
    if (!picked) {
      toast.error('Please select a time column');
      return;
    }

    setNodeColumnSelections([{ nodeId: nodeIdForAnalysis, column: picked }]);
    setTimeColumn(picked);

    const validGroupByColumns = groupByColumns.filter(col => col.trim() !== '');

    if (derivedColumnType === 'numeric') {
      if (numericIntervalValue === null || numericIntervalValue <= 0) {
        toast.error('Please enter a numeric interval greater than 0.');
        return;
      }
      if (numericOriginInput.trim().length > 0 && numericOriginValue === null) {
        toast.error('Numeric origin must be a valid number.');
        return;
      }
    }

    const request: SequentialAnalysisRequest = {
      time_column: picked,
      group_by_columns: validGroupByColumns.length > 0 ? validGroupByColumns : null,
      frequency,
      sort_by_time: true,
      column_type: derivedColumnType,
      numeric_origin: derivedColumnType === 'numeric' ? numericOriginValue : undefined,
      numeric_interval: derivedColumnType === 'numeric' ? numericIntervalValue : undefined,
    };

    try {
      setIsAnalyzing(true);
      const authHeaders = getAuthHeaders();
      const headers = Object.keys(authHeaders).length > 0 ? authHeaders as Record<string, string> : {};
      const result = await textApi.sequentialAnalysis(currentWorkspaceId, nodeIdForAnalysis, request, headers);
      const taskIdFromResponse =
        (result as any)?.metadata?.task_id ??
        (result as any)?.metadata?.taskId ??
        null;
      if (typeof taskIdFromResponse === 'string' && taskIdFromResponse.trim().length > 0) {
        setLocalSequentialTaskId(taskIdFromResponse);
      }
      const enrichedResult = {
        ...result,
        analysis_params: {
          ...(result as any)?.analysis_params,
          group_by_columns: validGroupByColumns,
          time_column: picked,
          frequency,
          column_type: derivedColumnType,
          numeric_origin: numericOriginValue,
          numeric_interval: numericIntervalValue,
        },
      };
      const resolvedChartType = isChartTypeOption((enrichedResult as any)?.chart_type)
        ? (enrichedResult as any).chart_type
        : chartTypeRef.current;
      const normalizedResult = {
        ...enrichedResult,
        chart_type: resolvedChartType,
      };
      setResults(normalizedResult);
      setChartType(resolvedChartType);
      // Lock with snapshot & preserve schema and params
      try {
        const snapshot = await createNodeSnapshot(currentWorkspaceId, nodeIdForAnalysis, () => getAuthHeaders());
        const [normalizedSnapshot] = applySelectedColumnsToSnapshots(
          [snapshot],
          { [nodeIdForAnalysis]: picked }
        );
        if (normalizedSnapshot) {
          setLockedNodesSnapshot([{ id: normalizedSnapshot.id, name: normalizedSnapshot.name, columns: normalizedSnapshot.columns }]);
          lockCurrentSchema(normalizedSnapshot.schema);
        }

        // Save locked parameters
        setLockedParams({
          frequency,
          groupByColumns: [...validGroupByColumns],
          columnType: derivedColumnType,
          numericOrigin: numericOriginValue,
          numericInterval: numericIntervalValue,
          sortByTime: true,
        });

        setIsLocked(true);
      } catch { /* ignore */ }
    } catch (error) {
      console.error('Sequential analysis error:', error);
      toast.error(`Error performing sequential analysis: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

const handleUpdateResults = async () => {
    // Clear current results and rerun with new parameters
    if (currentWorkspaceId) {
      const taskId = await resolveSequentialTaskId();
      await clearAnalysisTaskResults({
        workspaceId: currentWorkspaceId,
        taskIds: collectTaskIds([localSequentialTaskId, taskId]),
        clearAnalysisTask: (workspaceId, id) =>
          textApi.clearTask(workspaceId, id, getAuthHeaders()),
        warnContext: 'sequential-analysis',
      });
    }
    setResults(null);
    // Keep locked state and nodes, just update the analysis with new params
    await handleAnalyze();
  };

  const handleClearResults = async () => {
    if (currentWorkspaceId) {
      const taskId = await resolveSequentialTaskId();
      await clearAnalysisTaskResults({
        workspaceId: currentWorkspaceId,
        taskIds: collectTaskIds([localSequentialTaskId, taskId]),
        clearAnalysisTask: (workspaceId, id) =>
          textApi.clearTask(workspaceId, id, getAuthHeaders()),
        warnContext: 'sequential-analysis',
      });
    }
    setLocalSequentialTaskId(null);
    setResults(null);
    setLockedNodesSnapshot([]);
    setLockedSchema(null);
    setLockedParams(null);
    setIsLocked(false);
    setChartType('line');
    setNumericOriginInput('');
    setNumericIntervalInput('1');
  };

  const handleChartTypeChange = async (value: ChartTypeOption) => {
    setChartType(value);
    setResults((prev: any) => (prev ? { ...prev, chart_type: value } : prev));

    if (!currentWorkspaceId) {
      return;
    }

    const authHeaders = getAuthHeaders();
    const headers = Object.keys(authHeaders).length > 0 ? (authHeaders as Record<string, string>) : {};

    try {
      const taskId = await resolveSequentialTaskId();
      if (!taskId) {
        return;
      }
      await textApi.postSequentialAnalysisTaskResult(currentWorkspaceId, taskId, { chart_type: value }, headers);
    } catch (error) {
      console.error('Failed to update sequential analysis chart type:', error);
    }
  };

  // Prepare data for chart visualization
  const chartData = useMemo<SequentialAnalysisDatum[]>(() => {
    if (!results?.data || !Array.isArray(results.data)) {
      return [];
    }

    const groupingColumns = (results as any)?.analysis_params?.group_by_columns;
    const effectiveGroupColumns = Array.isArray(groupingColumns)
      ? groupingColumns
      : (groupByColumns.length ? groupByColumns : []);
    
    if (!effectiveGroupColumns || effectiveGroupColumns.length === 0) {
      // No grouping - simple time series
      return results.data.map((item: Record<string, unknown>) => ({
        ...item,
        time_period:
          (item.time_period_formatted as string | undefined) ||
          (item.time_period as string | undefined),
        sequential_count: item.sequential_count,
      }));
    }

    // With grouping - need to reshape data for recharts
    const timeMap = new Map<string, SequentialAnalysisDatum>();
    
    results.data.forEach((item: Record<string, unknown>) => {
      const timePeriod = (item.time_period_formatted as string | undefined) || (item.time_period as string | undefined) || '';
      const groupKey = effectiveGroupColumns.map((col: string) => String(item[col] ?? '')).join(' - ');
      
      if (!timeMap.has(timePeriod)) {
        timeMap.set(timePeriod, { time_period: timePeriod });
      }
      
      const timeEntry = timeMap.get(timePeriod);
      if (timeEntry) {
        timeEntry[groupKey] = item.sequential_count;
      }
    });
    
    return Array.from(timeMap.values()).sort((a, b) => {
      const aTime = String(a.time_period ?? '');
      const bTime = String(b.time_period ?? '');
      return aTime.localeCompare(bTime);
    });
  }, [results, groupByColumns]);

  // Get unique group values for legend colors
  const groupKeys = useMemo(() => {
    const groupingColumns = (results as any)?.analysis_params?.group_by_columns;
    const effectiveGroupColumns = Array.isArray(groupingColumns)
      ? groupingColumns
      : (groupByColumns.length ? groupByColumns : []);

    if (!effectiveGroupColumns.length || !chartData.length) {
      return ['sequential_count'];
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
    if (!groupKeys.length || (groupKeys.length === 1 && groupKeys[0] === 'sequential_count')) {
      return {
        sequential_count: {
          label: 'Sequential Count',
          color: getPaletteColor(0),
        },
      };
    }

    return groupKeys.reduce<ChartConfig>((acc, key, index) => {
      acc[key] = {
        label: key,
        color: getPaletteColor(index),
      };
      return acc;
    }, {});
  }, [groupKeys]);

  const formatTimeLabel = (value?: string | number) => {
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
  };

  const groupPointCounts = useMemo(() => {
    if (!chartData.length) return {} as Record<string, number>;

    const counts: Record<string, number> = {};
    chartData.forEach((row) => {
      const typedRow = row as Record<string, unknown>;
      groupKeys.forEach((key) => {
        const value = typedRow[key];
        if (value !== undefined && value !== null) {
          counts[key] = (counts[key] ?? 0) + 1;
        }
      });
    });
    return counts;
  }, [chartData, groupKeys]);

  const renderChart = () => {
    if (!chartData.length) {
      return (
        <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-muted-foreground/30 text-sm text-muted-foreground">
          No sequential analysis data available. Adjust your configuration and try again.
        </div>
      );
    }

    const margin = { top: 20, right: 30, left: 20, bottom: 20 };

    const axisTickProps = {
      angle: -45,
      textAnchor: 'end' as const,
      height: 100,
      minTickGap: 20,
    };

    return (
      <ChartContainer config={chartConfig} className="w-full">
        <div className="aspect-auto h-100 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'bar' ? (
              <BarChart data={chartData} margin={margin}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time_period" {...axisTickProps} />
                <YAxis />
                <ChartTooltip
                  content={<ChartTooltipContent className="min-w-50" labelFormatter={formatTimeLabel} />}
                />
                {groupKeys.map((key, idx) => {
                  const color = chartConfig[key]?.color ?? getPaletteColor(idx);
                  return (
                    <Bar key={key} dataKey={key} fill={color} radius={[6, 6, 0, 0]} name={key} />
                  );
                })}
              </BarChart>
            ) : chartType === 'area' ? (
              <AreaChart data={chartData} margin={margin}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time_period" {...axisTickProps} />
                <YAxis />
                <ChartTooltip
                  content={<ChartTooltipContent className="min-w-50" labelFormatter={formatTimeLabel} />}
                />
                {groupKeys.map((key, idx) => {
                  const color = chartConfig[key]?.color ?? getPaletteColor(idx);
                  return (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stackId="1"
                      stroke={color}
                      fill={color}
                      fillOpacity={0.35}
                      name={key}
                    />
                  );
                })}
              </AreaChart>
            ) : (
              <LineChart data={chartData} margin={margin}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time_period" {...axisTickProps} />
                <YAxis />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      className="min-w-50"
                      indicator="line"
                      labelFormatter={formatTimeLabel}
                    />
                  }
                />
                {groupKeys.map((key, idx) => {
                  const color = chartConfig[key]?.color ?? getPaletteColor(idx);
                  const shouldShowDot = (groupPointCounts[key] ?? chartData.length) <= 1;
                  return (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={color}
                      strokeWidth={2}
                      dot={shouldShowDot ? { r: 4, strokeWidth: 0 } : false}
                      activeDot={{ r: 5 }}
                      name={key}
                    />
                  );
                })}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 px-4">
          {groupKeys.map((key) => {
            const color = chartConfig[key]?.color;
            const label = chartConfig[key]?.label || key;
            return (
              <div key={key} className="flex items-center gap-2">
                {chartType === 'line' ? (
                  <div className="flex items-center">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                    <div className="h-0.5 w-3" style={{ backgroundColor: color }} />
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  </div>
                ) : (
                  <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
                )}
                <span className="text-sm font-medium text-muted-foreground">{label}</span>
              </div>
            );
          })}
        </div>
      </ChartContainer>
    );
  };

  const summaryTimeColumn = (results?.analysis_params?.time_column as string | undefined) ?? timeColumn;
  const summaryGroupBy = (results?.analysis_params?.group_by_columns as string[] | undefined) ?? groupByColumns;
  const summaryColumnType = (results?.analysis_params?.column_type as 'datetime' | 'numeric' | undefined) ?? derivedColumnType;
  const summaryNumericOrigin = summaryColumnType === 'numeric'
    ? (results?.analysis_params?.numeric_origin as number | null | undefined) ?? numericOriginValue ?? null
    : null;
  const summaryNumericInterval = summaryColumnType === 'numeric'
    ? (results?.analysis_params?.numeric_interval as number | null | undefined) ?? numericIntervalValue ?? null
    : null;
  const summaryFrequency = summaryColumnType === 'numeric'
    ? 'Numeric bins'
    : ((results?.analysis_params?.frequency as SequentialFrequency | undefined) ?? frequency);
  const resultsSummary = summaryTimeColumn
    ? (summaryColumnType === 'numeric'
        ? `Numeric bin counts for ${summaryTimeColumn}`
        : `Frequency of records grouped by ${summaryTimeColumn}`)
    : 'Aggregated frequency over time';

  const applyHydratedRequest = useCallback(
    async (requestPayload: unknown) => {
      const req = (requestPayload as any)?.data ?? requestPayload;
      if (!req) {
        return;
      }

      setHydratingSelection(true);
      const nodeIdStr = String(req.node_id || req.nodeId || '');
      const reqTimeColumn = typeof req.time_column === 'string' ? req.time_column : '';
      const reqColumnType = req.column_type === 'numeric' ? 'numeric' : 'datetime';
      const lockedNumericOrigin = reqColumnType === 'numeric' && typeof req.numeric_origin === 'number'
        ? req.numeric_origin
        : null;
      const lockedNumericInterval = reqColumnType === 'numeric' && typeof req.numeric_interval === 'number'
        ? req.numeric_interval
        : null;

      if (reqColumnType === 'numeric') {
        setNumericOriginInput(lockedNumericOrigin != null ? String(lockedNumericOrigin) : '');
        setNumericIntervalInput(lockedNumericInterval != null ? String(lockedNumericInterval) : '1');
      } else {
        setNumericOriginInput('');
        setNumericIntervalInput('1');
      }

      if (nodeIdStr && reqTimeColumn) {
        setNodeColumnSelections([{ nodeId: nodeIdStr, column: reqTimeColumn }]);
        setTimeColumn(reqTimeColumn);
      }

      const normalizedGroups = Array.isArray(req.group_by_columns)
        ? req.group_by_columns.filter((col: unknown): col is string => typeof col === 'string' && col.trim() !== '')
        : [];
      setGroupByColumns(normalizedGroups.length ? [...normalizedGroups] : []);

      const validFrequencies: SequentialFrequency[] = ['hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
      const reqFrequency = typeof req.frequency === 'string' ? (req.frequency as any) : undefined;
      const lockedFrequency = reqFrequency && validFrequencies.includes(reqFrequency)
        ? reqFrequency
        : frequencyRef.current;
      if (frequencyRef.current !== lockedFrequency) {
        setFrequency(lockedFrequency);
      }

      hydratedParamsRef.current = {
        timeColumn: reqTimeColumn,
        groupByColumns: normalizedGroups.length ? [...normalizedGroups] : [],
        frequency: lockedFrequency,
        columnType: reqColumnType,
        numericOrigin: lockedNumericOrigin,
        numericInterval: lockedNumericInterval,
      };

      setLockedParams({
        frequency: lockedFrequency,
        groupByColumns: normalizedGroups.length ? [...normalizedGroups] : [],
        columnType: reqColumnType,
        numericOrigin: lockedNumericOrigin,
        numericInterval: lockedNumericInterval,
        sortByTime: typeof req.sort_by_time === 'boolean' ? req.sort_by_time : true,
      });

      if (nodeIdStr) {
        setIsLocked(true);
        try {
          const info = await getNodeInfo({ workspaceId: currentWorkspaceId!, nodeId: nodeIdStr, getAuthHeaders });
          const name = info?.name || info?.data?.name || nodeIdStr;
          const columns = Array.isArray(info?.columns)
            ? info.columns
            : (Array.isArray(info?.data?.columns) ? info.data.columns : []);
          const [normalizedSnapshot] = applySelectedColumnsToSnapshots(
            [{ id: nodeIdStr, name: String(name), columns }],
            { [nodeIdStr]: reqTimeColumn }
          );
          setLockedNodesSnapshot([{ id: normalizedSnapshot.id, name: normalizedSnapshot.name, columns: normalizedSnapshot.columns }]);
          const normalizedSchema = normalizeSchemaFromInfo(info);
          if (Object.keys(normalizedSchema).length > 0) {
            setLockedSchema(normalizedSchema);
          } else {
            setLockedSchema((prev) => prev ?? currentSchemaRef.current);
          }
        } catch {
          setLockedSchema((prev) => prev ?? currentSchemaRef.current);
        }
      }

      setHydratingSelection(false);
    },
    [
      currentSchemaRef,
      frequencyRef,
      getAuthHeaders,
      setIsLocked,
      setLockedNodesSnapshot,
      setLockedSchema,
      setNodeColumnSelections,
    ]
  );

  const applyHydratedResult = useCallback(
    async (resultPayload: unknown) => {
      if (!resultPayload) {
        return;
      }

      const metadataTaskId =
        (resultPayload as any)?.metadata?.task_id ??
        (resultPayload as any)?.metadata?.taskId ??
        (resultPayload as any)?.data?.metadata?.task_id ??
        (resultPayload as any)?.data?.metadata?.taskId ??
        null;
      if (typeof metadataTaskId === 'string' && metadataTaskId.trim().length > 0) {
        setLocalSequentialTaskId(metadataTaskId);
      }

      const hydratedParams = hydratedParamsRef.current;
      const enriched = {
        ...(resultPayload as any),
        analysis_params: {
          ...((resultPayload as any)?.analysis_params ?? {}),
          ...(hydratedParams
            ? {
                group_by_columns: hydratedParams.groupByColumns,
                time_column: hydratedParams.timeColumn,
                frequency: hydratedParams.frequency,
                column_type: hydratedParams.columnType,
                numeric_origin: hydratedParams.numericOrigin,
                numeric_interval: hydratedParams.numericInterval,
              }
            : {}),
        },
      };

      const resolvedChartType = isChartTypeOption((resultPayload as any)?.chart_type)
        ? (resultPayload as any).chart_type
        : chartTypeRef.current;
      const normalizedResult = {
        ...enriched,
        chart_type: resolvedChartType,
      };
      setResults(normalizedResult);
      setChartType(resolvedChartType);
    },
    [chartTypeRef]
  );

  const fetchSequentialRequest = useCallback(
    async (taskId?: string | null) => {
      if (!currentWorkspaceId || !taskId) return null;
      return textApi.getTaskRequest(currentWorkspaceId, taskId, getAuthHeaders());
    },
    [currentWorkspaceId, getAuthHeaders]
  );

  const fetchSequentialResult = useCallback(
    async (taskId?: string | null) => {
      if (!currentWorkspaceId || !taskId) return null;
      return textApi.getTaskResult(currentWorkspaceId, taskId, getAuthHeaders());
    },
    [currentWorkspaceId, getAuthHeaders]
  );

  const { hydrateFromServer } = useAnalysisHydration({
    workspaceId: currentWorkspaceId,
    analysisKey: 'sequential-analysis',
    getAuthHeaders,
    onTaskIdResolved: setLocalSequentialTaskId,
    fetchRequest: fetchSequentialRequest,
    fetchResult: fetchSequentialResult,
    applyRequest: applyHydratedRequest,
    applyResult: applyHydratedResult,
    autoHydrateOnFocus: false,
    autoHydrateOnVisibility: false,
  });

  const hydratedOnceRef = useRef<boolean>(false);
  useEffect(() => {
    hydratedOnceRef.current = false;
  }, [currentWorkspaceId]);
  useEffect(() => {
    if (!currentWorkspaceId || hydratedOnceRef.current) {
      return;
    }

    hydratedOnceRef.current = true;
    void hydrateFromServer();
  }, [currentWorkspaceId, hydrateFromServer]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Sequential Analysis
                <HelpIcon
                  targetKey="analysis.sequential-analysis.parameters"
                  label="Sequential analysis parameters"
                  tooltip="Select a time column, choose frequency, and configure group-by options."
                />
              </CardTitle>
            </div>
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
            getNodeColumns={() => timeCompatibleColumns}
            defaultPalette={[]}
            maxCompare={1}
            className="border border-dashed border-muted-foreground/40 rounded-lg bg-muted/30 p-4"
            showShape
            showColorPicker={false}
            disabled={!!isLocked}
            locked={!!isLocked}
            originalCount={displayNodeCount}
            columnLabelFn={() => (
              <span className="inline-flex items-center gap-1">
                Time/Numeric Column *
                <HelpIcon targetKey="analysis.sequential-analysis.time-column" label="Time column selector" />
              </span>
            )}
            allowedDataTypes={Array.from(TIME_COMPATIBLE_TYPES)}
            lockedMessage={ANALYSIS_LOCKED_MESSAGE}
          />

          {/* Analysis Configuration */}
          <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {derivedColumnType === 'datetime' ? (
              <div className="md:col-span-1">
                <div className="mb-1 flex items-center gap-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Frequency
                  </label>
                  <HelpIcon targetKey="analysis.sequential-analysis.frequency" label="Frequency selector" />
                </div>
                <Select
                  value={frequency}
                  onValueChange={(value) => setFrequency(value as SequentialFrequency)}
                  disabled={!isLocked && (isAnalyzing || isLoading.operations || !activeNodeId)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Numeric Origin
                  </label>
                  <Input
                    type="number"
                    value={numericOriginInput}
                    onChange={(event) => setNumericOriginInput(event.target.value)}
                    placeholder="Auto-detect"
                    disabled={!!isLocked}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Optional. Leave blank to auto-detect from the minimum value.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Numeric Interval *
                  </label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={numericIntervalInput}
                    onChange={(event) => setNumericIntervalInput(event.target.value)}
                    placeholder="e.g. 10"
                    disabled={!!isLocked}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Required. Values are bucketed using this interval width.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Group By Columns */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Group By Columns (Optional, max 3)
              </label>
              <Button
                onClick={handleAddGroupByColumn}
                disabled={groupByColumns.length >= 3}
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
          {hasParamsChanged ? (
            <Button
              onClick={handleUpdateResults}
              disabled={actionState.runDisabled || isLoading.operations || !activeTimeColumn}
              className="w-full md:w-auto"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Update Results
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={handleAnalyze}
              disabled={actionState.runDisabled || isLoading.operations || !activeTimeColumn}
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
                  Run Sequential Analysis
                </>
              )}
            </Button>
          )}

          <div className="flex items-center gap-2">
            <Button
              onClick={handleClearResults}
              variant="destructive"
              disabled={actionState.clearDisabled}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Results
            </Button>
            <HelpIcon targetKey="analysis.sequential-analysis.clear-results" label="Clear results" />
          </div>
        </div>
        </CardContent>
      </Card>

      {/* Results Display */}
      {results && (
        <Card className="mt-6">
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Sequential Analysis Results
                <HelpIcon
                  targetKey="analysis.sequential-analysis.results"
                  label="Sequential analysis results"
                  tooltip={`${resultsSummary}. Review the chart, summaries, and adjust chart type.`}
                />
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Chart Type</span>
              <Select
                value={chartType}
                onValueChange={(value) => handleChartTypeChange(value as ChartTypeOption)}
              >
                <SelectTrigger className="w-35 text-sm">
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
                  {summaryColumnType === 'numeric' ? 'Numeric Interval' : 'Frequency'}
                </span>
                <div className="mt-1 text-base font-semibold capitalize text-foreground">
                  {summaryColumnType === 'numeric'
                    ? summaryNumericInterval != null
                      ? `${summaryNumericInterval}${summaryNumericOrigin != null ? ` (origin ${summaryNumericOrigin})` : ''}`
                      : '—'
                    : summaryFrequency}
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

export default SequentialAnalysisFeature;
