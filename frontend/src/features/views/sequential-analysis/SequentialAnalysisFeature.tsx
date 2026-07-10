import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AnalysisTabInput } from '@/api';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useUIStore } from '@/stores/uiStore';
import { useSchemaManagement } from '@/features/workspace/common/hooks/useSchemaManagement';

import { normalizeSchemaFromInfo } from '@/features/workspace/common/hooks/useSchemaManagement';
import { fetchNodeInfo } from '@/lib/nodeInfo';
import AnalysisTaskBanner from '@/features/views/common/components/AnalysisTaskBanner';
import { normalizeTypeName } from '@/features/workspace/data-view/utils/columnTypes';
import {
  useLastRunRequest,
  useAnalysisFeature,
  useSafeResult,
  executeAnalysisRerun,
} from '../common';
import { ANALYSIS_TAB_GROUPS, ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import { nodeInputsFromSelections, useTabNodeInputs } from '../common/nodeInputs';
import { getRerunActionState, hasNodeSelectionChanged } from '../common/rerunActionState';
import { hasParameterDiff } from '../common/parameterComparison';
import { getAnalysisTaskRequest, getAnalysisTaskResult } from '../common/analysisTasksApi';
import { AnalysisCardLayout } from '../common/components/AnalysisCardLayout';
import { useSequentialAnalysisTaskFlow } from './hooks/useSequentialAnalysisTaskFlow';
import { useSequentialAnalysisDetach } from './hooks/useSequentialAnalysisDetach';
import { useSequentialResultSummary } from './hooks/useSequentialResultSummary';
import { deriveSequentialResultVisibility } from './hooks/sequentialResultVisibility';
import { buildSequentialChartExportMetadata } from './hooks/sequentialChartExport';
import { isChartTypeOption, type ChartTypeOption } from './hooks/sequentialChartModel';
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
import {
  DEFAULT_TAB_INPUT_SET_ID,
  type AnalysisTabInputSets,
} from '@/features/views/common/tabs/tabStateOps';

const TIME_COMPATIBLE_TYPES = ['datetime', 'integer', 'float'] as const;
const NUMERIC_TYPE_SET = new Set(['integer', 'float']);

/** Renders the sequential-analysis workflow for live trends and result exploration. */
/**
 * Rendered by: the viewComponents tabbed loader, which mounts one instance per analysis tab and feeds it tab props.
 * Flow: read workspace/auth state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 *
 * Tab props: ``tabId`` identifies the active tab, ``tabTaskId`` seeds
 * deterministic hydration of that tab's task, ``onTabTaskChange`` reports task
 * id assignment/clear back to the tab record, and ``onTabInputSetChange`` owns
 * node-input persistence for add/remove/column actions.
 */
interface SequentialAnalysisFeatureProps {
  tabId?: string;
  tabTaskId?: string | null;
  onTabTaskChange?: (taskId: string | null) => void;
  tabInputSets?: AnalysisTabInputSets;
  onTabInputSetChange: (selectorId: string, inputs: AnalysisTabInput[]) => void;
}

const SequentialAnalysisFeature = ({
  tabId,
  tabTaskId,
  onTabTaskChange,
  tabInputSets,
  onTabInputSetChange,
}: SequentialAnalysisFeatureProps) => {
  const queryClient = useQueryClient();
  const { currentWorkspaceId } = useWorkspaceData();
  const { isLoading } = useWorkspaceStatus();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'analysis';

  const { getAuthHeaders } = useAuth();
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
    getAuthHeaders,
    taskId: tabTaskId ?? null,
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
    detachNodeName,
    setDetachNodeName,
  } = chartControls;
  const chartContainerRef = useRef<HTMLDivElement | null>(null);

  // Use schema management hook
  const { setLockedSchema, availableColumns, lockCurrentSchema } = useSchemaManagement({
    nodeId: activeNodeId,
    isLocked: false,
    workspaceId: currentWorkspaceId ?? undefined,
    getAuthHeaders,
  });

  const [liveResults, resultRef, setResults] = useSafeResult<Record<string, unknown>>();
  const [hydratingSelection, setHydratingSelection] = useState(false);
  const hydratedParamsRef = useRef<SequentialHydratedParams | null>(null);

  const {
    resolveTaskId,
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
    getAuthHeaders,
    isTabActive: isActiveTab,
    // Tab-driven deterministic hydration: the tab's persisted task id wins task
    // resolution over transient local state.
    hydrationTaskId: tabTaskId ?? null,
    resultRef,
    // Loads the latest sequential-analysis result for polling and task resumption.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config.
    fetchResult: async (taskId, headers) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisTaskResult<Record<string, unknown>>(currentWorkspaceId, taskId, headers);
    },
    // Retrieves the submitted request so hydration can restore parameters and locks.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config.
    fetchRequest: async (taskId, headers) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisTaskRequest(
        ANALYSIS_TAB_GROUPS.sequential,
        currentWorkspaceId,
        taskId,
        headers,
      );
    },
    // Applies freshly fetched task results to chart state after lifecycle polling completes.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config. Flow: normalize inputs, derive state, then return the analysis result expected by callers.
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
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config. Flow: normalize inputs, derive state, then return the analysis result expected by callers.
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
          const info = await fetchNodeInfo({
            queryClient,
            workspaceId: currentWorkspaceId,
            nodeId: nodeIdStr,
            getAuthHeaders,
          });
          setLockedSchema(normalizeSchemaFromInfo(info));
        }
      } finally {
        setHydratingSelection(false);
      }
    },
    // Clears sequential-specific state after the shared lifecycle removes the task result.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config.
    onCleared: (_, options) => {
      setResults(null);
      chartControls.resetAfterClear();
      if (options?.preserveLocalState) {
        return;
      }
      // Detach the cleared task from the owning tab so a reload doesn't rehydrate
      // a task the user explicitly cleared. Inputs are intentionally preserved.
      onTabTaskChange?.(null);
      setLockedSchema(null);
      setChartType('line');
      sequentialParameters.resetAfterClear();
    },
    // Finds task ids embedded in result metadata for status recovery.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config.
    getExtraTaskIdCandidates: () =>
      [resultRef.current?.metadata as Record<string, unknown> | undefined].map(
        (m) => m?.task_id as string | undefined,
      ),
    // Finds task ids embedded in result metadata for clear operations.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config.
    getClearTaskIdSources: () =>
      [resultRef.current?.metadata as Record<string, unknown> | undefined].map(
        (m) => m?.task_id as string | undefined,
      ),
    // Treats hydrated running results as active tasks for the shared banner/action state.
    // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config.
    isResultRunning: (r: Record<string, unknown> | null) => Boolean(r) && r?.state === 'running',
  });

  const results: Record<string, unknown> | null = liveResults;

  const timeCompatibleColumns = availableColumns
    .map((column) => ({
      ...column,
      dataType: normalizeTypeName(column.dataType),
    }))
    .filter((column) =>
      TIME_COMPATIBLE_TYPES.includes(column.dataType as (typeof TIME_COMPATIBLE_TYPES)[number]),
    )
    .sort((a, b) => {
      // Prioritizes datetime columns before numeric fallbacks in the default selector.
      /**
       * Called by: SequentialAnalysisFeature during this analysis workflow.
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
  const activeColumnType = normalizeTypeName(
    activeColumnInfo?.dataType ?? timeCompatibleColumns[0]?.dataType ?? 'datetime',
  );
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

  const {
    // Toggles or range-selects chart periods for the add-to-workspace detach flow.
    handleAnalyze,
    handleClearResults,
    handleChartTypeChange,
    chartData: liveChartData,
    groupKeys: liveGroupKeys,
    chartConfig: liveChartConfig,
    groupPointCounts: liveGroupPointCounts,
  } = useSequentialAnalysisTaskFlow({
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
      resolveTaskId,
      clearResults,
      // Persist the run's assigned task id onto the active tab so reload
      // rehydrates the same task.
      onTaskIdAssigned: (taskId) => {
        if (tabId) onTabTaskChange?.(taskId);
      },
    },
    lock: { getAuthHeaders },
  });

  const chartData = liveChartData;
  const groupKeys = liveGroupKeys;
  const chartConfig = liveChartConfig;
  const groupPointCounts = liveGroupPointCounts;

  // Runs a fresh trends analysis or updates a locked task after parameter changes.
  /**
   * Called by: SequentialAnalysisFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleRunOrUpdate = async () => {
    await executeAnalysisRerun({
      hasUnrunChanges: hasParamsChanged,
      clearResults,
      runFreshAnalysis: handleAnalyze,
      clearOptionsOnRerun: { preserveLocalState: true },
    });
  };

  const effHandleChartTypeChange = handleChartTypeChange;

  const {
    timeColumn: summaryTimeColumn,
    groupBy: summaryGroupBy,
    columnType: summaryColumnType,
    numericOrigin: summaryNumericOrigin,
    numericInterval: summaryNumericInterval,
    frequencyDisplay: summaryFrequency,
  } = useSequentialResultSummary(results, {
    timeColumn,
    groupBy: groupByColumns,
    columnType: derivedColumnType,
    numericOrigin: numericOriginValue ?? null,
    numericInterval: numericIntervalValue ?? null,
    frequency,
    customIntervalValue,
    customIntervalUnit: customIntervalUnitValue,
  });

  const rawResultRows = Array.isArray(results?.data)
    ? (results.data as Record<string, unknown>[])
    : [];

  const canDetach =
    selectedPeriodIndices.size > 0 &&
    selectedPeriodIndices.size < chartData.length &&
    groupKeys.length > 0;

  const { handleDetach, isDetaching, defaultNodeName } = useSequentialAnalysisDetach({
    currentWorkspaceId,
    resolveTaskId,
    getAuthHeaders,
    panelSelectedNodes,
    chartData,
    results,
    excludedGroupKeys: hiddenKeys,
    selectedPeriodIndices,
    requestedNodeName: detachNodeName,
    queryClient,
  });

  const {
    totalPointCount,
    totalDocumentCount,
    shownPointCount,
    shownDocumentCount,
    chosenPointCount,
    chosenDocumentCount,
  } = deriveSequentialResultVisibility({
    rows: rawResultRows,
    groupByColumns: summaryGroupBy,
    hiddenKeys,
    chartData,
    selectedPeriodIndices,
    resultTotalRecords: results?.total_records,
    sourceDocumentCount,
  });

  const resultsSummary = summaryTimeColumn
    ? summaryColumnType === 'numeric'
      ? `Numeric bin counts for ${summaryTimeColumn}`
      : `Frequency of records grouped by ${summaryTimeColumn}`
    : 'Aggregated frequency over time';

  // Exports the rendered chart SVG with contextual title and legend metadata.
  /**
   * Called by: SequentialAnalysisFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   * Flow: read workspace/auth state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
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
      timeColumn: summaryTimeColumn,
      frequencyDisplay: summaryFrequency,
      groupByColumns: summaryGroupBy,
      chartType,
      chartConfig,
      groupKeys,
      hiddenKeys,
      counts: {
        totalPointCount,
        totalDocumentCount,
        shownPointCount,
        shownDocumentCount,
        chosenPointCount,
        chosenDocumentCount,
      },
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
          // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config.
          onRun: () => {
            void handleRunOrUpdate();
          },
          // Stops the active sequential-analysis task from the shared layout action.
          // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config.
          onStop: () => {
            void stopTask();
          },
          // Clears live sequential-analysis results from the shared layout action.
          // Called by: SequentialAnalysisFeature through its owning hook, JSX prop, or analysis lifecycle config.
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
          summary={{
            timeColumn: summaryTimeColumn,
            groupBy: summaryGroupBy,
            columnType: summaryColumnType,
            numericOrigin: summaryNumericOrigin,
            numericInterval: summaryNumericInterval,
            frequencyDisplay: summaryFrequency,
          }}
          counts={{
            total: totalPointCount,
            totalDocuments: totalDocumentCount,
            shown: shownPointCount,
            shownDocuments: shownDocumentCount,
            chosen: chosenPointCount,
            chosenDocuments: chosenDocumentCount,
          }}
          chartType={chartType}
          onChartTypeChange={(value) => {
            void effHandleChartTypeChange(value);
          }}
          xAxisType={xAxisType}
          onXAxisTypeChange={setXAxisType}
          onDownloadClick={() => {
            setDownloadDialogOpen(true);
          }}
          chartData={chartData}
          chartConfig={chartConfig}
          groupKeys={groupKeys}
          groupPointCounts={groupPointCounts}
          hiddenKeys={hiddenKeys}
          selectedPeriodIndices={selectedPeriodIndices}
          canDetach={canDetach}
          isDetaching={isDetaching}
          onToggleKey={chartControls.toggleKey}
          onPeriodClick={(index, shiftHeld) => {
            chartControls.selectPeriod(index, shiftHeld, chartData.length);
          }}
          onClearSelection={chartControls.clearPeriodSelection}
          detachNodeName={detachNodeName}
          detachNodeNamePlaceholder={defaultNodeName}
          onDetachNodeNameChange={setDetachNodeName}
          onDetach={() => {
            void handleDetach();
          }}
          containerRef={chartContainerRef}
          readOnly={false}
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
