import { toast } from 'sonner';
import { submitTabAnalysis } from '@/api';
import type { Analysis, SequentialAnalysisRequest } from '@/api';
import type { RunAnalysis } from '../../common/hooks/useAnalysisFeature';
import type { ArrowField } from '@/lib/arrow/arrowTable';
import type { ChartTypeOption } from './sequentialChartModel';

type SequentialFrequency = NonNullable<SequentialAnalysisRequest['frequency']>;
type SequentialCustomIntervalUnit = NonNullable<SequentialAnalysisRequest['custom_interval_unit']>;

interface SequentialAnalysisState {
  currentWorkspaceId: string | null;
  tabId: string;
  activeNodeId: string | null;
  nodeColumnSelections: { nodeId: string; column: string }[];
  timeColumn: string;
  groupByColumns: string[];
  frequency: SequentialFrequency;
  derivedColumnType: 'datetime' | 'numeric';
  numericOriginValue: number | null;
  numericIntervalValue: number | null;
  numericOriginInput: string;
  customIntervalValue: number | null;
  customIntervalUnit: SequentialCustomIntervalUnit | null;
  caseSensitive: boolean;
}

interface SequentialAnalysisActions {
  runAnalysis: RunAnalysis;
  setChartType: (value: ChartTypeOption) => void;
  setNodeColumnSelections: (selections: { nodeId: string; column: string }[]) => void;
  setTimeColumn: (value: string) => void;
  lockCurrentSchema: (schema?: Record<string, ArrowField>) => void;
  clearResults: () => Promise<boolean>;
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
    tabId,
    activeNodeId,
    nodeColumnSelections,
    timeColumn,
    groupByColumns,
    frequency,
    derivedColumnType,
    numericOriginValue,
    numericIntervalValue,
    numericOriginInput,
    customIntervalValue,
    customIntervalUnit,
    caseSensitive,
  },
  actions: {
    runAnalysis,
    setChartType,
    setNodeColumnSelections,
    setTimeColumn,
    lockCurrentSchema,
    clearResults,
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
      nodeColumnSelections.find((s) => s.nodeId === nodeIdForAnalysis)?.column || timeColumn || '';
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
      node_id: nodeIdForAnalysis,
      time_column: picked,
      group_by_columns: validGroupByColumns.length > 0 ? validGroupByColumns : undefined,
      frequency,
      sort_by_time: true,
      column_type: derivedColumnType,
      numeric_origin: derivedColumnType === 'numeric' ? numericOriginValue : undefined,
      numeric_interval: derivedColumnType === 'numeric' ? numericIntervalValue : undefined,
      custom_interval_value: isCustomDatetime ? customIntervalValue : undefined,
      custom_interval_unit: isCustomDatetime ? customIntervalUnit : undefined,
      case_sensitive: caseSensitive,
    };

    await runAnalysis<Analysis>({
      action: 'run_all',
      submit: async () => {
        const { data } = await submitTabAnalysis({
          body: {
            execution_scope: 'run_all',
            request: { kind: 'sequential', ...request },
          },
          path: { workspace_id: currentWorkspaceId, tab_id: tabId },
          throwOnError: true,
        });
        return data;
      },
      onSuccess: () => {
        lockCurrentSchema();
      },
      onError: (error) => {
        console.error('Sequential analysis error:', error);
        toast.error(
          `Error performing sequential analysis: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      },
    });
  };

  // Clears the active sequential-analysis result through the shared lifecycle.
  /**
   * Returned to `SequentialAnalysisFeature` by `useSequentialAnalysisTaskFlow`.
   */
  const handleClearResults = () => clearResults();

  // Persists chart-type changes in device-local presentation state.
  /**
   * Returned to `SequentialAnalysisFeature` by `useSequentialAnalysisTaskFlow`.
   */
  const handleChartTypeChange = (value: ChartTypeOption) => {
    setChartType(value);
  };

  return {
    handleAnalyze,
    handleClearResults,
    handleChartTypeChange,
  };
}
