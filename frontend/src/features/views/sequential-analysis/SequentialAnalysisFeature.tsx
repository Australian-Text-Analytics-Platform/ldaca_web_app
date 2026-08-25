import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CONTEXTUAL_HINT_IDS } from '@/features/guidance/registry';
import { useProgressiveContextualHints } from '@/features/guidance/useProgressiveContextualHints';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { useSchemaManagement } from '@/features/workspace/common/hooks/useSchemaManagement';

import { arrowSchemaToFields } from '@/features/workspace/common/hooks/useSchemaManagement';
import {
  type ArrowField,
  isArrowFloatField,
  isArrowIntegerField,
  isArrowTemporalField,
} from '@/lib/arrow/arrowTable';
import { fetchNodeSchema } from '@/lib/nodeSchema';
import AnalysisTaskBanner from '@/features/views/common/components/AnalysisTaskBanner';
import { useAnalysisFeature } from '../common/hooks/useAnalysisFeature';
import { ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import { nodeInputsFromSelections, useTabNodeInputs } from '../common/nodeInputs';
import { analysisInputsFromRequest } from '../common/utils';
import { getRerunActionState } from '../common/rerunActionState';
import { hasClearRequiredAnalysis } from '../common/analysisActionLifecycle';
import { hasParameterDiff } from '../common/parameterComparison';
import { getAnalysisResultResource } from '../common/analysisApi';
import { AnalysisCardLayout } from '../common/components/AnalysisCardLayout';
import { useSequentialAnalysisTaskFlow } from './hooks/useSequentialAnalysisTaskFlow';
import { buildSequentialChartExportMetadata } from './hooks/sequentialChartExport';
import { buildSequentialChartModel, type ChartTypeOption } from './hooks/sequentialChartModel';
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
import type { SequentialAnalysisRequest, SequentialAnalysisResponse } from '@/api';

const isTimeCompatibleField = (field: ArrowField): boolean =>
  isArrowTemporalField(field) || isArrowIntegerField(field) || isArrowFloatField(field);

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
    latestRunAll,
    activeAnalysis,
    analyses,
    refreshAnalyses,
    inputSets: tabInputSets,
    setInputSet: onTabInputSetChange,
  } = host;
  const tabTaskId = latestRunAll?.id ?? null;
  const queryClient = useQueryClient();
  const { currentWorkspaceId } = useWorkspaceData();
  const { isLoading } = useWorkspaceStatus();

  const nodeInputs = useTabNodeInputs({
    tabInputSets,
    onTabInputSetChange,
    constraints: {
      fieldPredicate: isTimeCompatibleField,
      maxNodes: 1,
      docTypeOnly: false,
    },
  });
  const nodeColumnSelections = nodeInputs.nodeColumnSelections;
  const setNodeColumnSelection = nodeInputs.setColumn;
  const panelSelectedNodes = nodeInputs.selectedNodes;
  const activeNodeId = nodeInputs.resolvedNodes[0]?.id ?? '';
  const applyInputsFromSelections = (selections: { nodeId: string; column?: string | null }[]) => {
    onTabInputSetChange(DEFAULT_TAB_INPUT_SET_ID, nodeInputsFromSelections(selections));
  };
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
  const savedChartType = host.settings['sequential.chartType'];
  const [chartType, setChartTypeState] = useState<ChartTypeOption>(
    savedChartType === 'bar' || savedChartType === 'area' ? savedChartType : 'line',
  );
  const setChartType = (value: ChartTypeOption) => {
    setChartTypeState(value);
    host.setSetting('sequential.chartType', value);
  };
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

  const [hydratingSelection, setHydratingSelection] = useState(false);
  const hydratedParamsRef = useRef<SequentialHydratedParams | null>(null);

  const {
    request: serverRequest,
    isRunning: isAnalyzing,
    isStopping,
    runAnalysis,
    banner: sequentialWaitingBanner,
    taskStatus,
    clearResults,
    stopTask,
    result: results,
  } = useAnalysisFeature<SequentialAnalysisResponse, SequentialAnalysisRequest>({
    taskType: ANALYSIS_TASK_TYPES.sequential,
    workspaceId: currentWorkspaceId,
    tabId: host.tabId,
    // The forest's newest Run All Analysis wins hydration over transient
    // submission state.
    hydrationTaskId: tabTaskId,
    controlAnalysisId: activeAnalysis?.id ?? null,
    tabAnalysisIds: analyses.map((analysis) => analysis.id),
    // Loads the latest sequential-analysis result for polling and task resumption.
    fetchResult: async (taskId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisResultResource<SequentialAnalysisResponse>(currentWorkspaceId, taskId);
    },
    // Restores sequential request parameters, selection lock, and schema after reload.
    // Called by: useAnalysisFeature hydration because Trends restores must rebuild time-column selection, bucket settings, grouping columns, and case handling from the submitted request. Flow: unwrap request data, apply numeric or datetime controls, restore node/group selections, then release hydration state.
    onRequest: async (requestPayload) => {
      const req = requestPayload as unknown as Record<string, unknown>;
      setHydratingSelection(true);
      try {
        const hydrated = sequentialParameters.applyHydratedRequest(req);
        const nodeIdStr = hydrated.nodeId;
        onTabInputSetChange(DEFAULT_TAB_INPUT_SET_ID, analysisInputsFromRequest(req, 1));
        hydratedParamsRef.current = hydrated.hydratedParams;
        if (nodeIdStr && currentWorkspaceId) {
          const schema = await fetchNodeSchema({
            queryClient,
            workspaceId: currentWorkspaceId,
            nodeId: nodeIdStr,
          });
          setLockedSchema(arrowSchemaToFields(schema));
        }
      } finally {
        setHydratingSelection(false);
      }
    },
    // Clears sequential-specific state after the shared lifecycle removes the task result.
    onCleared: () => {
      chartControls.resetAfterClear();
      // Refresh the canonical forest; curated inputs remain in the Tab draft.
      refreshAnalyses();
      setLockedSchema(null);
      sequentialParameters.resetAfterClear();
    },
  });

  const timeCompatibleColumns = availableColumns
    .filter(
      (column) =>
        isArrowTemporalField(column.field) ||
        isArrowIntegerField(column.field) ||
        isArrowFloatField(column.field),
    )
    .sort((a, b) => {
      // Prioritizes datetime columns before numeric fallbacks in the default selector.
      /**
       * Called by the selectable-column sort comparator below.
       */
      return Number(!isArrowTemporalField(a.field)) - Number(!isArrowTemporalField(b.field));
    });

  const timeColumnOptions = timeCompatibleColumns.map((column) => column.name);

  const activeTimeColumn = (() => {
    if (!activeNodeId) return '';
    const selection = nodeColumnSelections.find((s) => s.nodeId === activeNodeId);
    if (selection?.column) return selection.column;
    if (timeColumn) return timeColumn;
    return '';
  })();

  const activeColumnInfo = timeCompatibleColumns.find((column) => column.name === activeTimeColumn);
  const activeColumnField = activeColumnInfo?.field ?? timeCompatibleColumns[0]?.field;
  const derivedColumnType: 'datetime' | 'numeric' =
    activeColumnField &&
    (isArrowIntegerField(activeColumnField) || isArrowFloatField(activeColumnField))
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
  const serverColumn = lastRunRequest ? lastRunRequest.time_column : '';
  const resultNodeId = serverNodeId || activeNodeId;
  const resultNodeInfo = resultNodeId ? nodeInputs.nodeInfoById[resultNodeId] : null;
  const sourceDocumentCount = (() => {
    const firstShapeValue = resultNodeInfo?.shape?.[0];
    return typeof firstShapeValue === 'number' && Number.isFinite(firstShapeValue)
      ? firstShapeValue
      : undefined;
  })();
  const currentRequestSignature = {
    ...currentSequentialParams,
    node_id: activeNodeId,
    time_column: activeTimeColumn,
  };
  const hasParamsChanged = !lastRunRequest
    ? true
    : hasParameterDiff(currentRequestSignature, {
        ...readSequentialServerParams(lastRunRequest),
        node_id: serverNodeId,
        time_column: serverColumn,
      });

  const parametersLocked = isAnalyzing || Boolean(activeAnalysis);
  const requiresClear = hasClearRequiredAnalysis(analyses);
  const actionState = getRerunActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    isRunnable: Boolean(activeNodeId),
    hasAttachedAnalysis: Boolean(tabTaskId),
    hasAnyAnalysis: analyses.length > 0,
    analysisState: taskStatus.tasks[0]?.state ?? null,
    hasChanges: hasParamsChanged,
    requiresClear,
    isBusy: parametersLocked,
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
        derivedColumnType,
        numericOriginValue,
        numericIntervalValue,
        numericOriginInput,
        customIntervalValue,
        customIntervalUnit: customIntervalUnitValue,
        caseSensitive,
      },
      actions: {
        runAnalysis,
        setChartType,
        setNodeColumnSelections: (selections) => {
          applyInputsFromSelections(selections);
        },
        setTimeColumn,
        lockCurrentSchema,
        clearResults,
      },
    });

  const handleRunOrUpdate = async () => {
    await handleAnalyze();
  };

  useProgressiveContextualHints([
    CONTEXTUAL_HINT_IDS.trends.inputs,
    ...(!actionState.runDisabled && activeTimeColumn ? [CONTEXTUAL_HINT_IDS.trends.run] : []),
    ...(results ? [CONTEXTUAL_HINT_IDS.trends.results] : []),
  ]);

  const chartModel = buildSequentialChartModel({
    results,
    parameters: serverRequest,
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
    const nodeName =
      resultNodeInfo?.name ?? panelSelectedNodes[0]?.name ?? panelSelectedNodes[0]?.id ?? 'data';
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
          onRunAll: () => {
            void handleRunOrUpdate();
          },
          // Stops the active sequential-analysis task from the shared layout action.
          onStop: activeAnalysis
            ? () => {
                void stopTask();
              }
            : undefined,
          // Clears live sequential-analysis results from the shared layout action.
          onClear: () => {
            void handleClearResults();
          },
          runAllDisabled:
            parametersLocked ||
            actionState.runDisabled ||
            isLoading.operations ||
            !activeTimeColumn,
          runAllDisabledReason: (() => {
            if (isAnalyzing || isLoading.operations) return undefined;
            if (actionState.runDisabledReason) return actionState.runDisabledReason;
            if (!activeTimeColumn) return 'Select a time column to run';
            return undefined;
          })(),
          clearDisabled: actionState.clearDisabled,
          clearDisabledReason: actionState.clearDisabledReason,
          isRunningAll: isAnalyzing,
          isStopping,
          hasResult: Boolean(results),
          runAllLabel: 'Run',
          clearHelp: {
            targetKey: 'analysis.sequential-analysis.clear-results',
            label: 'Clear results',
          },
        }}
        actionsGuidanceTarget="trends-actions"
        parametersLocked={parametersLocked}
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
