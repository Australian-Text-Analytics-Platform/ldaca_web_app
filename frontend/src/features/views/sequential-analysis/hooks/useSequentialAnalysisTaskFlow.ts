import { toast } from 'sonner';
import { analysisTaskPreferences, runSequentialAnalysis } from '@/api';
import type { SequentialAnalysisRequest } from '@/api';
import { extractAndSetTaskId } from '../../common/extractTaskId';
import { isChartTypeOption, type ChartTypeOption } from './sequentialChartModel';

type SequentialFrequency = NonNullable<SequentialAnalysisRequest['frequency']>;
type SequentialCustomIntervalUnit = NonNullable<SequentialAnalysisRequest['custom_interval_unit']>;

interface SequentialAnalysisState {
  currentWorkspaceId: string | null;
  activeNodeId: string | null;
  nodeColumnSelections: { nodeId: string; column: string }[];
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
  setNodeColumnSelections: (selections: { nodeId: string; column: string }[]) => void;
  setTimeColumn: (value: string) => void;
  lockCurrentSchema: (schema?: Record<string, string>) => void;
  resolveTaskId: () => Promise<string | null>;
  clearResults: () => Promise<void>;
  // Reports the run's assigned task id back to the owning tab. No-op when not
  // tab-mounted.
  onTaskIdAssigned?: (taskId: string | null) => void;
}

interface Params {
  state: SequentialAnalysisState;
  actions: SequentialAnalysisActions;
}

/**
 * Builds the submit, clear, and chart-type persistence logic for sequential analysis.
 *
 * Used by: `SequentialAnalysisFeature`.
 * Flow: validate and submit the analysis request, clear the active result, and
 * persist chart-type preferences. Pure result shaping belongs to
 * `buildSequentialChartModel`.
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
    lockCurrentSchema,
    resolveTaskId,
    clearResults,
    onTaskIdAssigned,
  },
}: Params) {
  // Validates current parameters, submits the analysis request, and locks the selected node.
  /**
   * Returned to `SequentialAnalysisFeature` by `useSequentialAnalysisTaskFlow`.
   * Flow: validate the selected node/time interval, submit the generated
   * request, record task ownership, enrich result parameters, and lock schema.
   */
  const handleAnalyze = async () => {
    const nodeIdForAnalysis = activeNodeId;
    if (!nodeIdForAnalysis || !currentWorkspaceId) {
      toast.error('Please select a data block first');
      return;
    }

    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- empty column/time strings must fall through to the next fallback source */
    const picked =
      nodeColumnSelections.find((s) => s.nodeId === nodeIdForAnalysis)?.column ||
      timeColumn ||
      ((results?.analysis_params as Record<string, unknown> | undefined)?.time_column as
        | string
        | undefined) ||
      '';
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
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
      const { data: result } = await runSequentialAnalysis({
        body: request,
        path: { workspace_id: currentWorkspaceId, node_id: nodeIdForAnalysis },
        throwOnError: true,
      });
      const assignedTaskId = extractAndSetTaskId(result, setLocalTaskId);
      onTaskIdAssigned?.(assignedTaskId);
      const enrichedResult = {
        ...result,
        analysis_params: {
          ...((result as Record<string, unknown>).analysis_params as Record<string, unknown>),
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
        (enrichedResult as Record<string, unknown>).chart_type,
      )
        ? ((enrichedResult as Record<string, unknown>).chart_type as ChartTypeOption)
        : chartType;
      const normalizedResult = { ...enrichedResult, chart_type: resolvedChartType };
      setResults(normalizedResult);
      setChartType(resolvedChartType);

      lockCurrentSchema();
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
   * Returned to `SequentialAnalysisFeature` by `useSequentialAnalysisTaskFlow`.
   */
  const handleClearResults = async () => {
    await clearResults();
  };

  // Persists chart-type changes onto both local result state and the stored task result.
  /**
   * Returned to `SequentialAnalysisFeature` by `useSequentialAnalysisTaskFlow`.
   */
  const handleChartTypeChange = async (value: ChartTypeOption) => {
    setChartType(value);
    setResults((prev: Record<string, unknown> | null) =>
      prev ? { ...prev, chart_type: value } : prev,
    );

    if (!currentWorkspaceId) return;
    try {
      const taskId = await resolveTaskId();
      if (!taskId) return;
      await analysisTaskPreferences({
        body: { chart_type: value },
        path: { workspace_id: currentWorkspaceId, task_id: taskId },
        throwOnError: true,
      });
    } catch (error) {
      console.error('Failed to update sequential analysis chart type:', error);
    }
  };

  return {
    handleAnalyze,
    handleClearResults,
    handleChartTypeChange,
  };
}
