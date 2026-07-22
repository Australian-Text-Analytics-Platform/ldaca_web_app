import { useState } from 'react';
import {
  getAnalysisResult,
  queryAnalysisResult,
  type QuotationAnalysisRequest,
  type QuotationAnalysisResponse,
  type QuotationEngineConfig,
  type QuotationResultQuery,
} from '@/api';

import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import AnalysisTaskBanner from '@/features/views/common/components/AnalysisTaskBanner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { analysisInputsFromRequest } from '../common/utils';
import { DEFAULT_TAB_INPUT_SET_ID } from '../common/tabs/tabStateOps';
import { useAnalysisFeature } from '../common/hooks/useAnalysisFeature';
import { executeAnalysisRerun } from '../common/rerunAnalysis';
import { ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import { useTabNodeInputs } from '../common/nodeInputs';
import { getRerunActionState, hasNodeSelectionChanged } from '../common/rerunActionState';
import { hasParameterDiff } from '../common/parameterComparison';

import { useQuotationTaskFlow } from './hooks/useQuotationTaskFlow';
import { useQuotationContextPreference } from './hooks/useQuotationContextPreference';
import { useQuotationDetachDialog } from './hooks/useQuotationDetachDialog';
import { useQuotationEngineSettings } from './hooks/useQuotationEngineSettings';
import { DetachColumnsDialog } from '../common/components/DetachColumnsDialog';
import { useQuotationResultControls } from './hooks/useQuotationResultControls';
import { useQuotationRowDetail } from './hooks/useQuotationRowDetail';
import { QuotationEngineSettingsFields } from './components/QuotationEngineSettingsFields';
import { type QuotationHoverState } from './components/QuotationHighlightedCell';
import { QuotationResultsPanel } from './components/QuotationResultsPanel';
import { AnalysisCardLayout } from '../common/components/AnalysisCardLayout';
import { RowDetailPanel } from '../common/components/RowDetailPanel';
import { usePersistNodeDocumentColumn } from '../common/hooks/usePersistNodeDocumentColumn';
import type { AnalysisTabFeatureProps } from '@/features/views/common/tabs/AnalysisTabsHost';

/** Renders the quotation extraction workflow, including live runs and result detachment. */
/**
 * Rendered by: the viewComponents tabbed loader, which mounts one instance per analysis tab and feeds it tab props.
 * Flow: read workspace/tab state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 *
 * The required host supplies normalized task/input state and closure-bound
 * persistence commands for the active tab; this feature has no standalone or
 * optional-tab compatibility path.
 */
/**
 * Narrows task/action union responses to terminal quotation table results.
 * Used by: QuotationFeature fetch/search callbacks because generated quotation
 * endpoints may return action-status payloads while a task is still running,
 * but the analysis lifecycle only accepts result tables.
 */
function QuotationFeature({ host }: AnalysisTabFeatureProps) {
  const {
    taskId: tabTaskId,
    setTaskId: onTabTaskChange,
    inputSets: tabInputSets,
    setInputSet: onTabInputSetChange,
  } = host;
  const { currentWorkspaceId } = useWorkspaceData();
  const { detachQuotation } = useWorkspaceActions();
  const nodeInputs = useTabNodeInputs({
    tabInputSets,
    onTabInputSetChange,
    constraints: {
      allowedDataTypes: ['string'],
      maxNodes: 1,
      docTypeOnly: true,
    },
  });
  const nodeColumnSelections = nodeInputs.nodeColumnSelections;
  const setNodeColumnSelection = nodeInputs.setColumn;
  const displayedNodes = nodeInputs.selectedNodes.slice(0, 1);
  const activeSelections = nodeColumnSelections;
  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
  });

  const {
    engineConfig,
    lastRemoteEngineId,
    engineError,
    resolvedEnginePayload,
    engineReady,
    setTaskEngineConfig,
    updateRemoteEngineId,
    hydrateEngineConfig,
    buildEngineRequest,
  } = useQuotationEngineSettings();
  const [selectedMetadataColumns, setSelectedMetadataColumns] = useState<string[]>([]);
  const [resultQuery, setResultQuery] = useState<QuotationResultQuery | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorDialogMessage, setErrorDialogMessage] = useState<string>('');
  const {
    detailPayload,
    detailOpen,
    setDetailOpen,
    quotationCustomization,
    handleRowClick: handleQuotationRowClick,
  } = useQuotationRowDetail();

  const originalColumnsByNode = (() => {
    const map: Record<string, string[]> = {};
    nodeInputs.resolvedNodes.forEach((resolved) => {
      map[resolved.id] = resolved.columnOptions.map((info) => info.name);
    });
    return map;
  })();

  // Opens the shared error dialog with a fallback message for unexpected quotation failures.
  /**
   * Passed to quotation task and detach flows for user-visible failures.
   * Flow: normalize an empty failure message, store it, and open the shared error dialog.
   */
  const showErrorDialog = (message: string) => {
    setErrorDialogMessage(message || 'An unexpected error occurred.');
    setErrorDialogOpen(true);
  };

  const {
    request: serverRequest,
    resolveTaskId,
    setLocalTaskId,
    isRunning: isLoadingQuotations,
    setIsRunning: setIsLoadingQuotations,
    runningRef,
    lastFetchedRef,
    banner: quotationWaitingBanner,
    taskStatus,
    clearResults,
    stopTask,
    isStopping,
    result,
  } = useAnalysisFeature<QuotationAnalysisResponse, QuotationAnalysisRequest>({
    taskType: ANALYSIS_TASK_TYPES.quotation,
    workspaceId: currentWorkspaceId,
    tabId: host.tabId,
    // Tab-driven deterministic hydration: the tab's persisted task id wins task
    // resolution over transient local state.
    hydrationTaskId: tabTaskId,
    resultQuery: resultQuery ?? undefined,
    // Initial hydration reads the stored canonical Result. Only an explicit
    // page or sort change requests an alternate immutable projection.
    fetchResult: async (taskId, rawQuery) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      if (!rawQuery) {
        const { data } = await getAnalysisResult({
          path: { workspace_id: currentWorkspaceId, analysis_id: taskId },
          throwOnError: true,
        });
        return data as QuotationAnalysisResponse;
      }
      const query = rawQuery as QuotationResultQuery;
      const { data } = await queryAnalysisResult({
        body: { kind: 'quotation', ...query },
        path: { workspace_id: currentWorkspaceId, analysis_id: taskId },
        throwOnError: true,
      });
      return data as QuotationAnalysisResponse;
    },
    // Restores saved request settings after reload.
    // Called by: useAnalysisFeature hydration to restore the quotation engine
    // configuration before rendering results.
    onRequest: (requestPayload) => {
      const requestData = requestPayload as unknown as Record<string, unknown>;
      const nodeId = typeof requestData.node_id === 'string' ? requestData.node_id : '';
      const column = typeof requestData.column === 'string' ? requestData.column : '';
      if (!nodeId || !column) return;
      onTabInputSetChange(DEFAULT_TAB_INPUT_SET_ID, analysisInputsFromRequest(requestData, 1));
      hydrateEngineConfig((requestData.engine as QuotationEngineConfig | null) ?? null);
      setSelectedMetadataColumns([]);
    },
    // Clears quotation-specific state after the shared lifecycle deletes the task result.
    onCleared: (_, options) => {
      setIsClearing(false);
      setResultQuery(null);
      if (options?.preserveLocalState) {
        return;
      }
      // Detach the cleared task from the owning tab so a reload doesn't rehydrate
      // a task the user explicitly cleared. Inputs are intentionally preserved.
      onTabTaskChange(null);
    },
  });

  const resultNodeId =
    serverRequest && typeof serverRequest.node_id === 'string'
      ? serverRequest.node_id
      : (displayedNodes[0]?.id ?? '');
  const resultColumn =
    serverRequest && typeof serverRequest.column === 'string'
      ? serverRequest.column
      : (activeSelections.find((selection) => selection.nodeId === resultNodeId)?.column ?? '');
  const { nodeState, nodeDetaching, setNodeDetaching, resultsByNode } = useQuotationResultControls({
    result,
    nodeId: resultNodeId,
    column: resultColumn,
  });
  const hasLoaded = Boolean(result);

  const savedContextLength = Number(host.settings['quotation.contextLength']);
  const {
    contextLength,
    contextLengthInput,
    contextLengthError,
    isSavingContextLength,
    setContextLengthInput,
    handleContextLengthBlur,
    handleContextLengthKeyDown,
  } = useQuotationContextPreference({
    currentWorkspaceId,
    hasLoaded,
    savedValue: Number.isFinite(savedContextLength) ? savedContextLength : undefined,
    persistPreference: (value) => {
      host.setSetting('quotation.contextLength', String(value));
      return Promise.resolve();
    },
  });

  const hasIncompleteSelections =
    !displayedNodes.length ||
    displayedNodes.some((node) => {
      const nodeId = node.id;
      const selection = activeSelections.find((sel) => sel.nodeId === nodeId);
      return !selection?.column;
    });

  const canRunQuotation =
    Boolean(currentWorkspaceId) &&
    displayedNodes.length > 0 &&
    !hasIncompleteSelections &&
    engineReady;

  const lastRunRequest = serverRequest ?? null;
  const currentQuotationParams = {
    type: resolvedEnginePayload.type,
    engine_id:
      resolvedEnginePayload.type === 'remote' && resolvedEnginePayload.isValid
        ? resolvedEnginePayload.engineId
        : null,
  };
  const quotationServerParams = (request: Record<string, unknown>) => {
    const serverEngine = request.engine;
    const engine =
      serverEngine && typeof serverEngine === 'object'
        ? (serverEngine as Record<string, unknown>)
        : {};
    return {
      type: engine.type === 'remote' ? 'remote' : 'local',
      engine_id: typeof engine.engine_id === 'string' ? engine.engine_id || null : null,
    };
  };
  const serverNodeId =
    lastRunRequest && typeof lastRunRequest.node_id === 'string' ? lastRunRequest.node_id : '';
  const serverColumn =
    lastRunRequest && typeof lastRunRequest.column === 'string' ? lastRunRequest.column : '';
  const hasParamsChanged = !lastRunRequest
    ? true
    : hasParameterDiff(currentQuotationParams, quotationServerParams(lastRunRequest)) ||
      hasNodeSelectionChanged(
        activeSelections,
        serverNodeId ? [serverNodeId] : [],
        serverNodeId ? { [serverNodeId]: serverColumn } : {},
      );

  const actionState = getRerunActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    isRunnable: displayedNodes.length > 0 && !hasIncompleteSelections && engineReady,
    hasAttachedAnalysis: Boolean(tabTaskId),
    analysisState: taskStatus.tasks[0]?.state ?? null,
    hasChanges: hasParamsChanged,
    isBusy: isLoadingQuotations,
  });

  // Updates the selected text column and persists it as the document column preference.
  /**
   * Passed to the quotation node-input panel as its column-change handler.
   */
  const handleColumnChange = (nodeId: string, column: string) => {
    setNodeColumnSelection(nodeId, column);
    void persistDocumentColumn(nodeId, column);
  };

  const [hoverState, setHoverState] = useState<QuotationHoverState | null>(null);

  const { handleSearchAll, handlePageChange, handlePageSizeChange, handleSort, handleDetach } =
    useQuotationTaskFlow({
      state: {
        currentWorkspaceId,
        tabId: host.tabId,
        hasLoaded,
        displayedNodes,
        activeSelections,
        nodeState,
        originalColumnsByNode,
        buildEngineRequest,
      },
      actions: {
        setIsLoadingQuotations,
        setNodeDetaching,
        showErrorDialog,
        setResultQuery: (query) => {
          setResultQuery(query);
        },
        resetResultQuery: () => {
          setResultQuery(null);
        },
        setLocalTaskId,
        runningRef,
        lastFetchedRef,
        // Persist the run's assigned task id onto the active tab so reload
        // rehydrates the same task.
        onTaskIdAssigned: (taskId) => {
          onTabTaskChange(taskId);
        },
      },
      lock: {
        resolveTaskId,
        detachQuotation,
      },
    });

  const { openDetachDialog, detachDialog } = useQuotationDetachDialog({
    activeSelections,
    originalColumnsByNode,
    handleDetach,
    nodeDetaching,
  });

  // Runs a fresh quotation analysis or updates a locked task depending on parameter changes.
  /**
   * Passed to the analysis action button as its run/update handler.
   */
  const handleRunOrUpdate = async () => {
    await executeAnalysisRerun({
      hasAttachedAnalysis: Boolean(tabTaskId),
      clearResults,
      runFreshAnalysis: handleSearchAll,
    });
  };

  /**
   * Passed to quotation result blocks as the page-change callback.
   */
  const effHandlePageChange = (newPage: number) => {
    handlePageChange(newPage);
  };

  // Applies page-size changes to live task results.
  /**
   * Passed to quotation result blocks as the page-size callback.
   */
  const effHandlePageSizeChange = (newSize: number) => {
    handlePageSizeChange(newSize);
  };

  // Applies column sorting to live task results.
  /**
   * Passed to quotation result blocks as the column-sort callback.
   */
  const effHandleSort = (nodeId: string, columnName: string) => {
    void handleSort(nodeId, columnName);
  };

  return (
    <>
      <div className="space-y-4">
        <AnalysisCardLayout
          title="Quotation Extraction"
          info={{
            targetKey: 'quotation.overview',
            label: 'About Quotation Extraction',
            tooltip: 'Learn what quotation extraction is and how it can help you.',
          }}
          help={{
            targetKey: 'analysis.quotation.parameters',
            label: 'Quotation parameters',
            tooltip: 'Select a data block, choose a text column, and configure quotation settings.',
          }}
          actions={{
            // Routes the Run button through live quotation execution.
            onRun: () => {
              void handleRunOrUpdate();
            },
            // Stops the active quotation task from the shared layout action.
            onStop: () => {
              void stopTask();
            },
            // Clears live quotation state and backend results from the shared layout action.
            onClear: async () => {
              if (!currentWorkspaceId) return;
              setIsClearing(true);
              await clearResults();
              setIsClearing(false);
            },
            runDisabled: actionState.runDisabled || !canRunQuotation,
            runDisabledReason: (() => {
              if (isLoadingQuotations) return undefined;
              if (actionState.runDisabledReason) return actionState.runDisabledReason;
              if (hasIncompleteSelections) return 'Select a column for each data block';
              if (!engineReady) return 'Configure the remote engine before running';
              return undefined;
            })(),
            clearDisabled: actionState.clearDisabled || isClearing,
            isRunning: isLoadingQuotations,
            isStopping,
            isClearing,
            hasResult: hasLoaded,
            runLabel: actionState.runLabel,
            clearHelp: {
              targetKey: 'analysis.quotation.clear-results',
              label: 'Clear results',
            },
          }}
        >
          <NodeInputsPanel
            resolvedNodes={nodeInputs.resolvedNodes}
            availableNodes={nodeInputs.availableNodes}
            graphSelectedIds={nodeInputs.graphSelectedIds}
            recentPresets={nodeInputs.recentPresets}
            canAddMore={nodeInputs.canAddMore}
            maxNodes={1}
            onAddNodes={nodeInputs.addNodes}
            getAddRejection={nodeInputs.getAddRejection}
            onRemoveNode={nodeInputs.removeNode}
            onClear={nodeInputs.clear}
            onColumnChange={handleColumnChange}
          />
          <QuotationEngineSettingsFields
            idPrefix="quotation-parameter-engine"
            engineConfig={engineConfig}
            lastRemoteEngineId={lastRemoteEngineId}
            error={engineError}
            onEngineConfigChange={setTaskEngineConfig}
            onRemoteEngineIdChange={updateRemoteEngineId}
          />
        </AnalysisCardLayout>
        {quotationWaitingBanner && (
          <AnalysisTaskBanner
            analysisName="Quotation"
            status={quotationWaitingBanner.status}
            taskId={quotationWaitingBanner.taskId}
            message={quotationWaitingBanner.message}
            className="mt-4"
          />
        )}

        {hasLoaded && displayedNodes.length > 0 && (
          <QuotationResultsPanel
            displayedNodes={displayedNodes}
            activeSelections={activeSelections}
            resultsByNode={resultsByNode}
            selectedMetadataColumns={selectedMetadataColumns}
            onSelectedMetadataColumnsChange={setSelectedMetadataColumns}
            contextLength={contextLength}
            contextLengthInput={contextLengthInput}
            contextLengthError={contextLengthError}
            isSavingContextLength={isSavingContextLength}
            onContextLengthInputChange={setContextLengthInput}
            onContextLengthBlur={handleContextLengthBlur}
            onContextLengthKeyDown={handleContextLengthKeyDown}
            hoverState={hoverState}
            onHoverChange={setHoverState}
            nodeDetaching={nodeDetaching}
            onSort={effHandleSort}
            onPageChange={effHandlePageChange}
            onPageSizeChange={effHandlePageSizeChange}
            onRowClick={handleQuotationRowClick}
            onOpenDetachDialog={(nodeId) => {
              openDetachDialog(nodeId);
            }}
          />
        )}
      </div>

      <AlertDialog open={errorDialogOpen} onOpenChange={setErrorDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quotation Error</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap wrap-break-word">
              {errorDialogMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setErrorDialogOpen(false);
              }}
            >
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DetachColumnsDialog
        open={detachDialog.open}
        onOpenChange={detachDialog.onOpenChange}
        isDetaching={detachDialog.isDetaching}
        title="Detach Quotation Results"
        description="Select optional source columns to include alongside the quotation results. Required output columns stay checked automatically."
        detachNodeOptions={detachDialog.detachNodeOptions}
        selectedDetachColumns={detachDialog.selectedDetachColumns}
        toggleDetachColumn={detachDialog.toggleDetachColumn}
        selectAllDetachColumns={detachDialog.selectAllDetachColumns}
        deselectAllDetachColumns={detachDialog.deselectAllDetachColumns}
        handleDetachConfirm={detachDialog.handleDetachConfirm}
      />

      <RowDetailPanel
        open={detailOpen}
        onOpenChange={setDetailOpen}
        payload={detailPayload}
        customization={quotationCustomization}
      />
    </>
  );
}

export default QuotationFeature;
