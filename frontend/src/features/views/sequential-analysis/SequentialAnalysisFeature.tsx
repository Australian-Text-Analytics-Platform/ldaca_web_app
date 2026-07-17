import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { useUIStore } from '@/stores/uiStore';
import { useSchemaManagement } from '@/features/workspace/common/hooks/useSchemaManagement';

import { arrowSchemaToKinds } from '@/features/workspace/common/hooks/useSchemaManagement';
import { fetchNodeSchema } from '@/lib/nodeSchema';
import AnalysisTaskBanner from '@/features/views/common/components/AnalysisTaskBanner';
import { useLastRunRequest } from '../common/hooks/useLastRunRequest';
import { useAnalysisFeature } from '../common/hooks/useAnalysisFeature';
import { useSafeResult } from '../common/useSafeResult';
import { executeAnalysisRerun } from '../common/rerunAnalysis';
import { ANALYSIS_TAB_GROUPS, ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import { nodeInputsFromSelections, useTabNodeInputs } from '../common/nodeInputs';
import { getRerunActionState, hasNodeSelectionChanged } from '../common/rerunActionState';
import { hasParameterDiff } from '../common/parameterComparison';
import { getAnalysisRequest, getAnalysisResultResource } from '../common/analysisApi';
import { AnalysisCardLayout } from '../common/components/AnalysisCardLayout';
import { useSequentialAnalysisTaskFlow } from './hooks/useSequentialAnalysisTaskFlow';
import { buildSequentialChartExportMetadata } from './hooks/sequentialChartExport';
import {
  buildSequentialChartModel,
  isChartTypeOption,
  type ChartTypeOption,
} from './hooks/sequentialChartModel';
import {
  deriveSequentialParameterValues,
  readSequentialServerParams,
  useSequentialAnalysisParameters,
  type SequentialHydratedParams,
} from './hooks/useSequentialAnalysisParameters';
import { useSequentialChartControls } from './hooks/useSequentialChartControls';
import { SequentialAnalysisParameterPanel } from './components/panels/SequentialAnalysisParameterPanel';
import { SequentialAnalysisResultsPanel } from './components/panels/SequentialAnalysisResultsPanel';
import { ChartImageDownloadDialog } from '@/components/ui/ChartImageDownloadDialog';
import { downloadChartAs, findSvgInContainer, type ChartImageFormat } from '@/lib/chartExport';
import { DEFAULT_TAB_INPUT_SET_ID } from '@/features/views/common/tabs/tabStateOps';
import type { AnalysisTabFeatureProps } from '@/features/views/common/tabs/AnalysisTabsHost';

const TIME_COMPATIBLE_TYPES = ['datetime', 'integer', 'float'] as const;
const NUMERIC_TYPE_SET = new Set(['integer', 'float']);

/**
 * Renders the sequential-analysis workflow for live trends and result exploration.
 *
 * Rendered by: the viewComponents tabbed loader, which mounts one instance per analysis tab and feeds it tab props.
 * Flow: read workspace/tab state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 *
 * The required host supplies normalized task/input state and closure-bound
 * persistence commands for the active tab; this feature has no standalone or
 * optional-tab compatibility path.
 */
const SequentialAnalysisFeature = ({ host }: AnalysisTabFeatureProps) => {
  const {
    taskId: tabTaskId,
    setTaskId: onTabTaskChange,
    inputSets: tabInputSets,
    setInputSet: onTabInputSetChange,
  } = host;
  const queryClient = useQueryClient();
  const { currentWorkspaceId } = useWorkspaceData();
  const { isLoading } = useWorkspaceStatus();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'analysis';

  const nodeInputs = useTabNodeInputs({
    tabInputSets,
    onTabInputSetChange,
    constraints: {
      allowedDataTypes: [...TIME_COMPATIBLE_TYPES],
      maxNodes: 1,
      docTypeOnly: false,
    },
  });
  const nodeColumnSelections = nodeInputs.nodeColumnSelections;
  const setNodeColumnSelection = nodeInputs.setColumn;
  const panelSelectedNodes = nodeInputs.selectedNodes;
  const activeNodeId = nodeInputs.resolvedNodes[0]?.id ?? '';
  const sourceDocumentCount = (() => {
    const firstShapeValue = activeNodeId
      ? nodeInputs.nodeInfoCache[activeNodeId]?.shape?.[0]
      : null;
    return typeof firstShapeValue === 'number' && Number.isFinite(firstShapeValue)
      ? firstShapeValue
      : undefined;
  })();
  const applyInputsFromSelections = (selections: { nodeId: string; column?: string | null }[]) => {
    onTabInputSetChange(DEFAULT_TAB_INPUT_SET_ID, nodeInputsFromSelections(selections));
  };
  const { serverRequest } = useLastRunRequest({
    analysisType: ANALYSIS_TAB_GROUPS.sequential,
    workspaceId: currentWorkspaceId,
    taskId: tabTaskId,
  });

  const sequentialParameters = useSequentialAnalysisParameters();
  const {
    timeColumn,
    setTimeColumn,
    groupByColumns,
    frequency,
    setFrequency,
    caseSensitive,
    setCaseSensitive,
    numericOriginInput,
    setNumericOriginInput,
    numericIntervalInput,
    setNumericIntervalInput,
    customIntervalValueInput,
    setCustomIntervalValueInput,
    customIntervalUnit,
    setCustomIntervalUnit,
  } = sequentialParameters;
  const [chartType, setChartType] = useState<ChartTypeOption>('line');
  const chartControls = useSequentialChartControls();
  const {
    xAxisType,
    setXAxisType,
    hiddenKeys,
    downloadDialogOpen,
    setDownloadDialogOpen,
    selectedPeriodIndices,
  } = chartControls;
  const chartContainerRef = useRef<HTMLDivElement | null>(null);

  // Use schema management hook
  const { setLockedSchema, availableColumns, lockCurrentSchema } = useSchemaManagement({
    nodeId: activeNodeId,
    isLocked: false,
    workspaceId: currentWorkspaceId ?? undefined,
  });

  const [liveResults, resultRef, setResults] = useSafeResult<Record<string, unknown>>();
  const [hydratingSelection, setHydratingSelection] = useState(false);
  const hydratedParamsRef = useRef<SequentialHydratedParams | null>(null);

  const {
    setLocalTaskId,
    isRunning: isAnalyzing,
    isStopping,
    setIsRunning: setIsAnalyzing,
    banner: sequentialWaitingBanner,
    clearResults,
    stopTask,
  } = useAnalysisFeature<Record<string, unknown>>({
    analysisType: ANALYSIS_TAB_GROUPS.sequential,
    taskType: ANALYSIS_TASK_TYPES.sequential,
    workspaceId: currentWorkspaceId,
    tabId: host.tabId,
    isTabActive: isActiveTab,
    // Tab-driven deterministic hydration: the tab's persisted task id wins task
    // resolution over transient local state.
    hydrationTaskId: tabTaskId,
    resultRef,
    // Loads the latest sequential-analysis result for polling and task resumption.
    fetchResult: async (taskId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisResultResource<Record<string, unknown>>(currentWorkspaceId, taskId);
    },
    // Retrieves the submitted request so hydration can restore parameters and locks.
    fetchRequest: async (taskId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisRequest(currentWorkspaceId, taskId);
    },
    // Applies freshly fetched task results to chart state after lifecycle polling completes.
    // Reset result selection, merge the fetched payload, and adopt its chart type.
    onResultFetched: (resultData) => {
      chartControls.resetResultSelection();
      const resolvedChartType = isChartTypeOption(resultData.chart_type)
        ? resultData.chart_type
        : chartType;
      setResults({
        ...resultData,
        analysis_params: {
          ...(results?.analysis_params ?? {}),
          ...(resultData.analysis_params ?? {}),
        },
        chart_type: resolvedChartType,
      });
      setChartType(resolvedChartType);
    },
    // Rebuilds chart state from a cached result payload and any hydrated request parameters.
    // Merge hydrated request parameters into the cached result before restoring chart state.
    onHydratedResult: (resultPayload) => {
      if (!resultPayload) return;
      chartControls.resetResultSelection();
      const hydratedParams = hydratedParamsRef.current;
      const enriched = {
        ...resultPayload,
        analysis_params: {
          ...(resultPayload.analysis_params as Record<string, unknown>),
          ...(hydratedParams
            ? {
                group_by_columns: hydratedParams.groupByColumns,
                time_column: hydratedParams.timeColumn,
                frequency: hydratedParams.frequency,
                column_type: hydratedParams.columnType,
                numeric_origin: hydratedParams.numericOrigin,
                numeric_interval: hydratedParams.numericInterval,
                custom_interval_value: hydratedParams.customIntervalValue,
                custom_interval_unit: hydratedParams.customIntervalUnit,
                case_sensitive: hydratedParams.caseSensitive,
              }
            : {}),
        },
      };
      const resolvedChartType = isChartTypeOption(resultPayload.chart_type)
        ? resultPayload.chart_type
        : chartType;
      setResults({ ...enriched, chart_type: resolvedChartType });
      setChartType(resolvedChartType);
    },
    // Restores sequential request parameters, selection lock, and schema after reload.
    // Called by: useAnalysisFeature hydration because Trends restores must rebuild time-column selection, bucket settings, grouping columns, and case handling from the submitted request. Flow: unwrap request data, apply numeric or datetime controls, restore node/group selections, then release hydration state.
    onHydratedRequest: async (requestPayload) => {
      const req = ((requestPayload as Record<string, unknown>).data ?? requestPayload) as Record<
        string,
        unknown
      > | null;
      if (!req) return;
      setHydratingSelection(true);
      try {
        const hydrated = sequentialParameters.applyHydratedRequest(req);
        const nodeIdStr = hydrated.nodeId;
        hydratedParamsRef.current = hydrated.hydratedParams;
        if (nodeIdStr && currentWorkspaceId) {
          const schema = await fetchNodeSchema({
            queryClient,
            workspaceId: currentWorkspaceId,
            nodeId: nodeIdStr,
          });
          setLockedSchema(arrowSchemaToKinds(schema));
        }
      } finally {
        setHydratingSelection(false);
      }
    },
    // Clears sequential-specific state after the shared lifecycle removes the task result.
    onCleared: (_, options) => {
      setResults(null);
      chartControls.resetAfterClear();
      if (options?.preserveLocalState) {
        return;
      }
      // Detach the cleared task from the owning tab so a reload doesn't rehydrate
      // a task the user explicitly cleared. Inputs are intentionally preserved.
      onTabTaskChange(null);
      setLockedSchema(null);
      setChartType('line');
      sequentialParameters.resetAfterClear();
    },
    // Finds task ids embedded in result metadata for status recovery.
    getExtraTaskIdCandidates: () =>
      [resultRef.current?.metadata as Record<string, unknown> | undefined].map(
        (m) => m?.task_id as string | undefined,
      ),
    // Finds task ids embedded in result metadata for clear operations.
    getClearTaskIdSources: () =>
      [resultRef.current?.metadata as Record<string, unknown> | undefined].map(
        (m) => m?.task_id as string | undefined,
      ),
    // Treats hydrated running results as active tasks for the shared banner/action state.
    isResultRunning: (r: Record<string, unknown> | null) => Boolean(r) && r?.state === 'running',
  });

  const results: Record<string, unknown> | null = liveResults;

  const timeCompatibleColumns = availableColumns
    .filter((column) =>
      TIME_COMPATIBLE_TYPES.includes(column.dataType as (typeof TIME_COMPATIBLE_TYPES)[number]),
    )
    .sort((a, b) => {
      // Prioritizes datetime columns before numeric fallbacks in the default selector.
      /**
       * Called by the selectable-column sort comparator below.
       */
      const priority = (type: string) => (type === 'datetime' ? 0 : 1);
      return priority(a.dataType) - priority(b.dataType);
    });

  const timeColumnOptions = timeCompatibleColumns.map((column) => column.name);

  const activeTimeColumn = (() => {
    if (!activeNodeId) return '';
    const selection = nodeColumnSelections.find((s) => s.nodeId === activeNodeId);
    if (selection?.column) return selection.column;
    if (timeColumn) return timeColumn;
    const hydratedTime =
      ((results?.analysis_params as Record<string, unknown> | undefined)?.time_column as
        | string
        | undefined) ?? '';
    return hydratedTime;
  })();

  const activeColumnInfo = timeCompatibleColumns.find((column) => column.name === activeTimeColumn);
  const activeColumnType =
    activeColumnInfo?.dataType ?? timeCompatibleColumns[0]?.dataType ?? 'datetime';
  const derivedColumnType: 'datetime' | 'numeric' = NUMERIC_TYPE_SET.has(activeColumnType)
    ? 'numeric'
    : 'datetime';
  const {
    numericOriginValue,
    numericIntervalValue,
    customIntervalValue,
    customIntervalUnitValue,
    currentSequentialParams,
  } = deriveSequentialParameterValues(sequentialParameters, derivedColumnType);

  const lastRunRequest = serverRequest ?? null;
  const serverNodeId =
    lastRunRequest && typeof lastRunRequest.node_id === 'string' ? lastRunRequest.node_id : '';
  const serverColumn = lastRunRequest ? ((lastRunRequest.time_column ?? '') as string) : '';
  const hasLastRun = Boolean(lastRunRequest);
  const hasParamsChanged = !lastRunRequest
    ? true
    : hasParameterDiff(currentSequentialParams, readSequentialServerParams(lastRunRequest)) ||
      hasNodeSelectionChanged(
        nodeColumnSelections,
        serverNodeId ? [serverNodeId] : [],
        serverNodeId ? { [serverNodeId]: serverColumn } : {},
      );

  const actionState = getRerunActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    isRunnable: Boolean(activeNodeId),
    hasLastRun,
    hasChanges: hasParamsChanged,
    isBusy: isAnalyzing,
    hasResults: Boolean(results),
  });

  useEffect(() => {
    if (hydratingSelection) return;
    const selection = nodeColumnSelections.find((s) => s.nodeId === activeNodeId);
    // Empty selected/option column names must fall through to the next source, so
    // logical-OR (not nullish) is intentional here.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const nextColumn = selection?.column || timeColumnOptions[0] || '';
    if (nextColumn && nextColumn !== timeColumn) {
      const id = requestAnimationFrame(() => {
        setTimeColumn(nextColumn);
      });
      return () => {
        cancelAnimationFrame(id);
      };
    }
  }, [
    hydratingSelection,
    activeNodeId,
    timeColumnOptions,
    nodeColumnSelections,
    timeColumn,
    setTimeColumn,
  ]);

  const { handleAnalyze, handleClearResults, handleChartTypeChange } =
    useSequentialAnalysisTaskFlow({
      state: {
        currentWorkspaceId,
        tabId: host.tabId,
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
        customIntervalUnit: customIntervalUnitValue,
        caseSensitive,
        results,
      },
      actions: {
        setIsAnalyzing,
        setResults,
        setChartType,
        setLocalTaskId,
        setNodeColumnSelections: (selections) => {
          applyInputsFromSelections(selections);
        },
        setTimeColumn,
        lockCurrentSchema,
        clearResults,
        // Persist the run's assigned task id onto the active tab so reload
        // rehydrates the same task.
        onTaskIdAssigned: (taskId) => {
          onTabTaskChange(taskId);
        },
      },
    });

  // Runs a fresh trends analysis or updates a locked task after parameter changes.
  /**
   * Passed to the analysis action button as its run/update handler.
   */
  const handleRunOrUpdate = async () => {
    await executeAnalysisRerun({
      hasUnrunChanges: hasParamsChanged,
      clearResults,
      runFreshAnalysis: handleAnalyze,
      clearOptionsOnRerun: { preserveLocalState: true },
    });
  };

  const chartModel = buildSequentialChartModel({
    results,
    fallbacks: {
      timeColumn,
      groupBy: groupByColumns,
      columnType: derivedColumnType,
      numericOrigin: numericOriginValue ?? null,
      numericInterval: numericIntervalValue ?? null,
      frequency,
      customIntervalValue,
      customIntervalUnit: customIntervalUnitValue,
    },
    chartType,
    xAxisType,
    hiddenKeys,
    selectedPeriodIndices,
    sourceDocumentCount,
  });
  const { summary } = chartModel;

  const resultsSummary = summary.timeColumn
    ? summary.columnType === 'numeric'
      ? `Numeric bin counts for ${summary.timeColumn}`
      : `Frequency of records grouped by ${summary.timeColumn}`
    : 'Aggregated frequency over time';

  // Exports the rendered chart SVG with contextual title and legend metadata.
  /**
   * Passed to the results panel as its chart-download handler.
   * Flow: validate the rendered chart, derive export metadata, then save the requested image format.
   */
  const handleDownloadChart = async (format: ChartImageFormat) => {
    if (!chartContainerRef.current) {
      toast.error('Chart not available for export.');
      return;
    }
    const svg = findSvgInContainer(chartContainerRef.current);
    if (!svg) {
      toast.error('Chart SVG not found.');
      return;
    }
    const nodeName = panelSelectedNodes[0]?.name ?? panelSelectedNodes[0]?.id ?? 'data';
    const { header, legend } = buildSequentialChartExportMetadata({
      nodeName,
      model: chartModel,
    });
    try {
      await downloadChartAs(svg, {
        nodeName,
        toolSuffix: 'trends',
        format,
        header,
        legend,
      });
    } catch (err) {
      toast.error('Failed to export chart.');
      console.error(err);
    }
  };

  return (
    <div className="space-y-4">
      <AnalysisCardLayout
        title="Trends and Sequence"
        info={{
          targetKey: 'sequential-analysis.overview',
          label: 'About Sequential Analysis',
          tooltip: 'Learn what sequential analysis is and how it can help you.',
        }}
        help={{
          targetKey: 'analysis.sequential-analysis.parameters',
          label: 'Sequential analysis parameters',
          tooltip: 'Select a time column, choose frequency, and configure group-by options.',
        }}
        actions={{
          // Routes the Run button through live sequential analysis.
          onRun: () => {
            void handleRunOrUpdate();
          },
          // Stops the active sequential-analysis task from the shared layout action.
          onStop: () => {
            void stopTask();
          },
          // Clears live sequential-analysis results from the shared layout action.
          onClear: () => {
            void handleClearResults();
          },
          runDisabled: actionState.runDisabled || isLoading.operations || !activeTimeColumn,
          runDisabledReason: (() => {
            if (isAnalyzing || isLoading.operations) return undefined;
            if (actionState.runDisabledReason) return actionState.runDisabledReason;
            if (!activeTimeColumn) return 'Select a time column to run';
            return undefined;
          })(),
          clearDisabled: actionState.clearDisabled,
          isRunning: isAnalyzing,
          isStopping,
          hasResult: Boolean(results),
          runLabel: actionState.runLabel,
          clearHelp: {
            targetKey: 'analysis.sequential-analysis.clear-results',
            label: 'Clear results',
          },
        }}
      >
        <SequentialAnalysisParameterPanel
          nodeInputs={nodeInputs}
          onColumnChange={(nodeId, column) => {
            setNodeColumnSelection(nodeId, column);
            setTimeColumn(column);
          }}
          derivedColumnType={derivedColumnType}
          inputsDisabled={isAnalyzing || isLoading.operations || !activeNodeId}
          activeNodeId={activeNodeId}
          selectedNodeId={activeNodeId}
          currentWorkspaceId={currentWorkspaceId}
          frequency={frequency}
          onFrequencyChange={setFrequency}
          customIntervalValueInput={customIntervalValueInput}
          onCustomIntervalValueChange={setCustomIntervalValueInput}
          customIntervalUnit={customIntervalUnit}
          onCustomIntervalUnitChange={setCustomIntervalUnit}
          numericOriginInput={numericOriginInput}
          onNumericOriginChange={setNumericOriginInput}
          numericIntervalInput={numericIntervalInput}
          onNumericIntervalChange={setNumericIntervalInput}
          availableColumns={availableColumns}
          groupByColumns={groupByColumns}
          onAddGroupByColumn={sequentialParameters.addGroupByColumn}
          onRemoveGroupByColumn={sequentialParameters.removeGroupByColumn}
          onGroupByColumnChange={sequentialParameters.changeGroupByColumn}
          caseSensitive={caseSensitive}
          onCaseSensitiveChange={setCaseSensitive}
        />
      </AnalysisCardLayout>

      {sequentialWaitingBanner && (
        <AnalysisTaskBanner
          analysisName="Trends and Sequence"
          status={sequentialWaitingBanner.status}
          taskId={sequentialWaitingBanner.taskId}
          message={sequentialWaitingBanner.message}
          className="mt-4"
        />
      )}

      {results && (
        <SequentialAnalysisResultsPanel
          resultsSummary={resultsSummary}
          model={chartModel}
          onChartTypeChange={(value) => {
            handleChartTypeChange(value);
          }}
          onXAxisTypeChange={setXAxisType}
          onDownloadClick={() => {
            setDownloadDialogOpen(true);
          }}
          onToggleKey={chartControls.toggleKey}
          onPeriodClick={(index, shiftHeld) => {
            chartControls.selectPeriod(index, shiftHeld, chartModel.chartData.length);
          }}
          onClearSelection={chartControls.clearPeriodSelection}
          containerRef={chartContainerRef}
        />
      )}
      <ChartImageDownloadDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        title="Download Trends Chart"
        onConfirm={(format) => {
          void handleDownloadChart(format);
        }}
      />
    </div>
  );
};

export default SequentialAnalysisFeature;
