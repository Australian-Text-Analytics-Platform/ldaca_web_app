import { toast } from 'sonner';
import type { QueryClient } from '@tanstack/react-query';
import { runSequentialAnalysis, updateSequentialAnalysisTaskResult } from '@/api/generated/sdk.gen';
import type { SequentialAnalysisRequestInput } from '@/api/generated/types.gen';
import { type ChartConfig } from '@/components/ui/chart';
import { extractAndSetTaskId, restoreAnalysisLockFromRequest } from '../../common';

type SequentialAnalysisRequest = SequentialAnalysisRequestInput;
type SequentialFrequency = NonNullable<SequentialAnalysisRequest['frequency']>;
type SequentialCustomIntervalUnit = NonNullable<SequentialAnalysisRequest['custom_interval_unit']>;

// Callers may rely on period_start and period_end being present on chart rows.
export type SequentialAnalysisDatum = Record<string, unknown>;

export type ChartTypeOption = 'line' | 'bar' | 'area';

const CHART_TYPE_OPTIONS: ChartTypeOption[] = ['line', 'bar', 'area'];

// Narrows stored or server-provided chart type values to the supported UI options.
/**
 * Used by: SequentialAnalysisFeature.tsx because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
 */
export const isChartTypeOption = (value: unknown): value is ChartTypeOption =>
  typeof value === 'string' && CHART_TYPE_OPTIONS.includes(value as ChartTypeOption);

const SEQUENTIAL_ANALYSIS_PALETTE = [
  '#2563eb',
  '#16a34a',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#14b8a6',
  '#f97316',
  '#ec4899',
  '#0ea5e9',
  '#22c55e',
] as const;

// Provides deterministic colours for generated chart series.
/**
 * Used by: SequentialChart.tsx, SequentialAnalysisFeature.tsx because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
 */
export const getPaletteColor = (index: number) =>
  SEQUENTIAL_ANALYSIS_PALETTE[index % SEQUENTIAL_ANALYSIS_PALETTE.length];

const NON_SERIES_CHART_KEYS = new Set(['time_period', 'period_start', 'period_end']);

// Compares period boundary values so grouped rows retain their earliest start and latest end.
/**
 * Called by: useSequentialAnalysisTaskFlow hook during this analysis workflow because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
 * Flow: order nullish values last, compare numeric bounds directly, compare parseable dates by time, then fall back to string ordering.
 */
const comparePeriodBounds = (left: unknown, right: unknown): number => {
  if (left === right) return 0;
  if (left === undefined || left === null) return 1;
  if (right === undefined || right === null) return -1;

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  const leftTime = new Date(String(left)).getTime();
  const rightTime = new Date(String(right)).getTime();
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return leftTime - rightTime;
  }

  return String(left).localeCompare(String(right));
};

// Formats sequential chart x-axis labels for timestamps while preserving raw non-date values.
/**
 * Used by: SequentialChart.tsx because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
 * Flow: return a placeholder for empty values, format parseable dates with month/year/day detail, then preserve raw non-date labels.
 */
export const formatTimeLabel = (value?: string | number) => {
  if (value === undefined || value === null || value === '') return '—';
  // Numeric input is interpreted as epoch-milliseconds (this is what the
  // linear x-axis passes in for datetime columns). Pass it to Date
  // directly — stringifying first would yield e.g. `"846764800000"`,
  // which `Date.parse` doesn't recognise as a date and falls through to
  // the raw number, putting epoch-ms on the axis ticks.
  const parsed = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short' };
    if (
      !(parsed.getUTCDate() === 1 && parsed.getUTCHours() === 0 && parsed.getUTCMinutes() === 0)
    ) {
      options.day = 'numeric';
    }
    return parsed.toLocaleString(undefined, options);
  }
  return String(value);
};

interface SequentialAnalysisState {
  currentWorkspaceId: string | null;
  activeNodeId: string | null;
  nodeColumnSelections: Array<{ nodeId: string; column: string }>;
  timeColumn: string;
  groupByColumns: string[];
  frequency: SequentialFrequency;
  chartType: ChartTypeOption;
  derivedColumnType: 'datetime' | 'numeric';
  numericOriginValue: number | null;
  numericIntervalValue: number | null;
  numericOriginInput: string;
  customIntervalValue: number | null;
  customIntervalUnit: SequentialCustomIntervalUnit | null;
  caseSensitive: boolean;
  results: Record<string, unknown> | null;
}

interface SequentialAnalysisActions {
  setIsAnalyzing: (value: boolean) => void;
  setResults: (
    value:
      | Record<string, unknown>
      | null
      | ((prev: Record<string, unknown> | null) => Record<string, unknown> | null),
  ) => void;
  setChartType: (value: ChartTypeOption) => void;
  setLocalTaskId: (value: string | null) => void;
  setNodeColumnSelections: (selections: Array<{ nodeId: string; column: string }>) => void;
  setTimeColumn: (value: string) => void;
  lockWithSnapshots: (snapshots: Array<{ id: string; name?: string; columns?: string[] }>) => void;
  lockCurrentSchema: (schema?: Record<string, string>) => void;
  resolveTaskId: () => Promise<string | null>;
  clearResults: () => Promise<void>;
  // Reports the run's assigned task id back to the owning tab. No-op when not
  // tab-mounted.
  onTaskIdAssigned?: (taskId: string | null) => void;
}

interface SequentialAnalysisLock {
  getAuthHeaders: () => Record<string, string>;
  queryClient: QueryClient;
}

type Params = {
  state: SequentialAnalysisState;
  actions: SequentialAnalysisActions;
  lock: SequentialAnalysisLock;
};

/** Builds the submit, clear, chart-type, and chart-shaping logic for sequential analysis. */
/**
 * Used by: SequentialChart.tsx, SequentialAnalysisFeature.tsx, and related files because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
 * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
 */
export function useSequentialAnalysisTaskFlow({
  state: {
    currentWorkspaceId,
    activeNodeId,
    nodeColumnSelections,
    timeColumn,
    groupByColumns,
    frequency,
    chartType,
    derivedColumnType,
    numericOriginValue,
    numericIntervalValue,
    numericOriginInput,
    customIntervalValue,
    customIntervalUnit,
    caseSensitive,
    results,
  },
  actions: {
    setIsAnalyzing,
    setResults,
    setChartType,
    setLocalTaskId,
    setNodeColumnSelections,
    setTimeColumn,
    lockWithSnapshots,
    lockCurrentSchema,
    resolveTaskId,
    clearResults,
    onTaskIdAssigned,
  },
  lock: { getAuthHeaders, queryClient },
}: Params) {
  // Validates current parameters, submits the analysis request, and locks the selected node.
  /**
   * Called by: useSequentialAnalysisTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
   */
  const handleAnalyze = async () => {
    const nodeIdForAnalysis = activeNodeId;
    if (!nodeIdForAnalysis || !currentWorkspaceId) {
      toast.error('Please select a data block first');
      return;
    }

    const picked =
      nodeColumnSelections.find((s) => s.nodeId === nodeIdForAnalysis)?.column ||
      timeColumn ||
      ((results?.analysis_params as Record<string, unknown> | undefined)?.time_column as
        | string
        | undefined) ||
      '';
    if (!picked) {
      toast.error('Please select a time column');
      return;
    }

    setNodeColumnSelections([{ nodeId: nodeIdForAnalysis, column: picked }]);
    setTimeColumn(picked);

    const validGroupByColumns = groupByColumns.filter((col) => col.trim() !== '');

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

    const isCustomDatetime = derivedColumnType === 'datetime' && frequency === 'custom';
    if (isCustomDatetime) {
      if (
        customIntervalValue === null ||
        !Number.isInteger(customIntervalValue) ||
        customIntervalValue <= 0
      ) {
        toast.error('Please enter a positive whole number for the custom interval.');
        return;
      }
      if (customIntervalUnit === null) {
        toast.error('Please select a unit for the custom interval.');
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
      custom_interval_value: isCustomDatetime ? customIntervalValue : undefined,
      custom_interval_unit: isCustomDatetime ? customIntervalUnit : undefined,
      case_sensitive: caseSensitive,
    };

    try {
      setIsAnalyzing(true);
      const authHeaders = getAuthHeaders();
      const headers =
        Object.keys(authHeaders).length > 0 ? (authHeaders as Record<string, string>) : {};
      const { data: result } = await runSequentialAnalysis({
        body: request,
        headers,
        path: { node_id: nodeIdForAnalysis },
        throwOnError: true,
      });
      const assignedTaskId = extractAndSetTaskId(result, setLocalTaskId);
      onTaskIdAssigned?.(assignedTaskId);
      const enrichedResult = {
        ...result,
        analysis_params: {
          ...((result as Record<string, unknown>)?.analysis_params as Record<string, unknown>),
          group_by_columns: validGroupByColumns,
          time_column: picked,
          frequency,
          column_type: derivedColumnType,
          numeric_origin: numericOriginValue,
          numeric_interval: numericIntervalValue,
          custom_interval_value: isCustomDatetime ? customIntervalValue : null,
          custom_interval_unit: isCustomDatetime ? customIntervalUnit : null,
          case_sensitive: caseSensitive,
        },
      };
      const resolvedChartType = isChartTypeOption(
        (enrichedResult as Record<string, unknown>)?.chart_type,
      )
        ? ((enrichedResult as Record<string, unknown>).chart_type as ChartTypeOption)
        : chartType;
      const normalizedResult = { ...enrichedResult, chart_type: resolvedChartType };
      setResults(normalizedResult);
      setChartType(resolvedChartType);

      try {
        await restoreAnalysisLockFromRequest({
          workspaceId: currentWorkspaceId,
          requestData: {
            node_ids: [nodeIdForAnalysis],
            node_columns: { [nodeIdForAnalysis]: picked },
          },
          getAuthHeaders,
          lockWithSnapshots,
          queryClient,
          maxNodes: 1,
        });
        lockCurrentSchema();
      } catch {
        /* ignore */
      }
    } catch (error) {
      console.error('Sequential analysis error:', error);
      toast.error(
        `Error performing sequential analysis: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Clears the active sequential-analysis result through the shared lifecycle.
  /**
   * Called by: useSequentialAnalysisTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   */
  const handleClearResults = async () => {
    await clearResults();
  };

  // Persists chart-type changes onto both local result state and the stored task result.
  /**
   * Called by: useSequentialAnalysisTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   * Flow: derive display state, bind user actions, then render the analysis UI.
   */
  const handleChartTypeChange = async (value: ChartTypeOption) => {
    setChartType(value);
    setResults((prev: Record<string, unknown> | null) =>
      prev ? { ...prev, chart_type: value } : prev,
    );

    if (!currentWorkspaceId) return;
    const authHeaders = getAuthHeaders();
    const headers =
      Object.keys(authHeaders).length > 0 ? (authHeaders as Record<string, string>) : {};
    try {
      const taskId = await resolveTaskId();
      if (!taskId) return;
      await updateSequentialAnalysisTaskResult({
        body: { chart_type: value },
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
    } catch (error) {
      console.error('Failed to update sequential analysis chart type:', error);
    }
  };

  const chartData = (() => {
    if (!results?.data || !Array.isArray(results.data)) return [];

    const groupingColumns = (results?.analysis_params as Record<string, unknown> | undefined)
      ?.group_by_columns;
    const effectiveGroupColumns = Array.isArray(groupingColumns)
      ? groupingColumns
      : groupByColumns.length
        ? groupByColumns
        : [];

    if (!effectiveGroupColumns || effectiveGroupColumns.length === 0) {
      return results.data.map((item: Record<string, unknown>) => ({
        ...item,
        time_period:
          (item.time_period_formatted as string | undefined) ||
          (item.time_period as string | undefined),
        sequential_count: item.sequential_count,
      }));
    }

    const timeMap = new Map<string, SequentialAnalysisDatum>();
    const allGroupKeys = new Set<string>();
    results.data.forEach((item: Record<string, unknown>) => {
      const timePeriod =
        (item.time_period_formatted as string | undefined) ||
        (item.time_period as string | undefined) ||
        '';
      const groupKey = effectiveGroupColumns
        .map((col: string) => String(item[col] ?? ''))
        .join(' - ');
      allGroupKeys.add(groupKey);
      if (!timeMap.has(timePeriod)) {
        timeMap.set(timePeriod, {
          time_period: timePeriod,
          period_start: item.period_start,
          period_end: item.period_end,
        });
      }
      const timeEntry = timeMap.get(timePeriod);
      if (timeEntry) {
        if (comparePeriodBounds(item.period_start, timeEntry.period_start) < 0) {
          timeEntry.period_start = item.period_start;
        }
        if (comparePeriodBounds(item.period_end, timeEntry.period_end) > 0) {
          timeEntry.period_end = item.period_end;
        }
        timeEntry[groupKey] = item.sequential_count;
      }
    });

    // Backfill 0 for any (group, time) cell the worker omitted. Sequential
    // analysis is a count over text events: a group with no occurrences
    // in a period is genuinely "zero", not "unknown". Without this the
    // chart renders `undefined` cells as null and breaks lines/areas at
    // every gap — especially visible in the linear-axis mode where gap
    // distances are proportional to time.
    timeMap.forEach((entry) => {
      allGroupKeys.forEach((key) => {
        if (entry[key] === undefined) {
          entry[key] = 0;
        }
      });
    });

    return Array.from(timeMap.values()).sort((a, b) => {
      const aTime = String(a.time_period ?? '');
      const bTime = String(b.time_period ?? '');
      return aTime.localeCompare(bTime);
    });
  })();

  const groupKeys = (() => {
    const groupingColumns = (results?.analysis_params as Record<string, unknown> | undefined)
      ?.group_by_columns;
    const effectiveGroupColumns = Array.isArray(groupingColumns)
      ? groupingColumns
      : groupByColumns.length
        ? groupByColumns
        : [];

    if (!effectiveGroupColumns.length || !chartData.length) return ['sequential_count'];

    const keys = new Set<string>();
    chartData.forEach((item: Record<string, unknown>) => {
      Object.keys(item).forEach((key) => {
        if (!NON_SERIES_CHART_KEYS.has(key)) keys.add(key);
      });
    });
    return Array.from(keys);
  })();

  const chartConfig = (() => {
    if (!groupKeys.length || (groupKeys.length === 1 && groupKeys[0] === 'sequential_count')) {
      return {
        sequential_count: { label: 'Sequential Count', color: getPaletteColor(0) },
      };
    }
    return groupKeys.reduce<ChartConfig>((acc, key, index) => {
      acc[key] = { label: key, color: getPaletteColor(index) };
      return acc;
    }, {});
  })();

  const groupPointCounts = (() => {
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
  })();

  return {
    handleAnalyze,
    handleClearResults,
    handleChartTypeChange,
    chartData,
    groupKeys,
    chartConfig,
    groupPointCounts,
  };
}
