import { useEffect, useRef, useState } from 'react';
import type { QuotationAnalysisResponse, AnalysisTabInput, QuotationEngineConfig } from '@/api';

import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useUIStore } from '@/stores/uiStore';
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
import { getServerEngineConfig } from '../common/parameterComparison';
import { useLastRunRequest } from '../common/hooks/useLastRunRequest';
import { useAnalysisFeature } from '../common/hooks/useAnalysisFeature';
import { executeAnalysisRerun } from '../common/rerunAnalysis';
import { ANALYSIS_TAB_GROUPS, ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import { useTabNodeInputs } from '../common/nodeInputs';
import { getRerunActionState, hasNodeSelectionChanged } from '../common/rerunActionState';
import { hasParameterDiff } from '../common/parameterComparison';
import { getAnalysisTaskRequest, getAnalysisTaskResult } from '../common/analysisTasksApi';

import { useQuotationTaskFlow } from './hooks/useQuotationTaskFlow';
import { useQuotationContextPreference } from './hooks/useQuotationContextPreference';
import { useQuotationDetachDialog } from './hooks/useQuotationDetachDialog';
import { useQuotationEngineSettings } from './hooks/useQuotationEngineSettings';
import { useQuotationMaterializeLifecycle } from './hooks/useQuotationMaterializeLifecycle';
import { DetachColumnsDialog } from '../common/components/DetachColumnsDialog';
import { useQuotationResultControls } from './hooks/useQuotationResultControls';
import { useQuotationRowDetail } from './hooks/useQuotationRowDetail';
import { normalizeRemoteUrl } from './quotationRemoteUrl';
import { QuotationEngineSettingsFields } from './components/QuotationEngineSettingsFields';
import { type QuotationHoverState } from './components/QuotationHighlightedCell';
import { QuotationResultsPanel } from './components/QuotationResultsPanel';
import { AnalysisCardLayout } from '../common/components/AnalysisCardLayout';
import { RowDetailPanel } from '../common/components/RowDetailPanel';
import { usePersistNodeDocumentColumn } from '../common/hooks/usePersistNodeDocumentColumn';
import type { AnalysisTabInputSets } from '@/features/views/common/tabs/tabStateOps';

/** Renders the quotation extraction workflow, including live runs and result materialisation. */
/**
 * Rendered by: the viewComponents tabbed loader, which mounts one instance per analysis tab and feeds it tab props.
 * Flow: read workspace/tab state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 *
 * Tab props: ``tabId`` identifies the active tab, ``tabTaskId`` seeds
 * deterministic hydration of that tab's task, ``onTabTaskChange`` reports task
 * id assignment/clear back to the tab record, and ``onTabInputSetChange`` owns
 * node-input persistence for add/remove/column actions.
 */
interface QuotationFeatureProps {
  tabId?: string;
  tabTaskId?: string | null;
  onTabTaskChange?: (taskId: string | null) => void;
  tabInputSets?: AnalysisTabInputSets;
  onTabInputSetChange: (selectorId: string, inputs: AnalysisTabInput[]) => void;
}

/**
 * Narrows task/action union responses to terminal quotation table results.
 * Used by: QuotationFeature fetch/search callbacks because generated quotation
 * endpoints may return action-status payloads while a task is still running,
 * but the analysis lifecycle only accepts result tables.
 */
function isQuotationAnalysisResponse(value: unknown): value is QuotationAnalysisResponse {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    Array.isArray((value as { columns?: unknown }).columns) &&
    'pagination' in value &&
    'sorting' in value
  );
}

function QuotationFeature({
  tabId,
  tabTaskId,
  onTabTaskChange,
  tabInputSets,
  onTabInputSetChange,
}: QuotationFeatureProps) {
  const { currentWorkspaceId } = useWorkspaceData();
  const { quotationSearch, detachQuotation, materializeQuotation } = useWorkspaceActions();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'quotation';
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
  const { serverRequest } = useLastRunRequest({
    analysisType: ANALYSIS_TAB_GROUPS.quotation,
    workspaceId: currentWorkspaceId,
    taskId: tabTaskId ?? null,
  });
  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
  });

  const {
    engineConfig,
    lastRemoteUrl,
    engineError,
    resolvedEnginePayload,
    engineReady,
    setTaskEngineConfig,
    updateRemoteUrl,
    hydrateEngineConfig,
    buildEngineRequest,
  } = useQuotationEngineSettings();
  const [selectedMetadataColumns, setSelectedMetadataColumns] = useState<string[]>([]);
  const [liveHasLoaded, setHasLoaded] = useState(false);
  const [isLoadingQuotations, setIsLoadingQuotations] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorDialogMessage, setErrorDialogMessage] = useState<string>('');
  const persistContextPreferenceRef = useRef<(value: number) => Promise<unknown>>(() =>
    Promise.resolve(undefined),
  );
  const {
    contextLength,
    contextLengthInput,
    contextLengthError,
    isSavingContextLength,
    setContextLengthInput,
    handleContextLengthBlur,
    handleContextLengthKeyDown,
    applyPreferenceFromResult: applyContextLengthPreferenceFromResult,
  } = useQuotationContextPreference({
    currentWorkspaceId,
    hasLoaded: liveHasLoaded,
    persistPreference: (value) => persistContextPreferenceRef.current(value),
  });
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
   * Passed to quotation task/materialization/detach flows for user-visible failures.
   * Flow: normalize an empty failure message, store it, and open the shared error dialog.
   */
  const showErrorDialog = (message: string) => {
    setErrorDialogMessage(message || 'An unexpected error occurred.');
    setErrorDialogOpen(true);
  };

  const quotationResultRef = useRef<QuotationAnalysisResponse | null>(null);
  const {
    nodeState,
    nodeDetaching,
    setNodeDetaching,
    nodeMaterializing,
    setNodeMaterializing,
    materializeTaskIds,
    setMaterializeTaskIds,
    materializedPaths,
    materializeSummary,
    resultsByNode,
    updateResultState,
    applyMaterializedRequest,
    resetAfterClear,
  } = useQuotationResultControls();

  const {
    resolveTaskId,
    setLocalTaskId,
    banner: quotationWaitingBanner,
    clearResults,
    stopTask,
    isStopping,
  } = useAnalysisFeature<QuotationAnalysisResponse>({
    analysisType: ANALYSIS_TAB_GROUPS.quotation,
    taskType: ANALYSIS_TASK_TYPES.quotation,
    workspaceId: currentWorkspaceId,
    isTabActive: isActiveTab,
    // Tab-driven deterministic hydration: the tab's persisted task id wins task
    // resolution over transient local state.
    hydrationTaskId: tabTaskId ?? null,
    resultRef: quotationResultRef,
    // Loads the latest quotation result for polling and task resumption.
    fetchResult: async (taskId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      const data = await getAnalysisTaskResult<QuotationAnalysisResponse>(
        currentWorkspaceId,
        taskId,
      );
      return isQuotationAnalysisResponse(data) ? data : null;
    },
    // Retrieves the submitted quotation request so hydration can restore engine and selection state.
    fetchRequest: async (taskId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisTaskRequest(ANALYSIS_TAB_GROUPS.quotation, currentWorkspaceId, taskId);
    },
    // Applies freshly fetched results to the active node table after lifecycle polling finishes.
    // Resolve the active node/column, apply persisted context length, then replace its result.
    onResultFetched: (result, _taskId) => {
      // defensive: the analysis lifecycle may deliver an empty result on edge cases
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!result) return;
      const targetNode = displayedNodes[0];
      const nodeId = targetNode?.id ?? '';
      const selection = activeSelections.find((s) => s.nodeId === nodeId);
      const column = selection?.column ?? '';
      applyContextLengthPreferenceFromResult(result);
      if (nodeId && column) {
        updateResultState(nodeId, column, result);
      }
      setHasLoaded(true);
    },
    // Rebuilds result state from a cached task payload when the quotation tab hydrates.
    onHydratedResult: (resultPayload) => {
      const res = resultPayload;
      if (!res) return;
      const selection = nodeColumnSelections[0];
      const nodeId = selection?.nodeId ?? '';
      const column = selection?.column ?? '';
      if (!nodeId) return;
      applyContextLengthPreferenceFromResult(res);
      updateResultState(nodeId, column, res);
      setHasLoaded(true);
    },
    // Restores saved request settings and materialization metadata after reload.
    // Called by: useAnalysisFeature hydration because quotation restores must reapply engine settings, materialized path, and context length before rendering results. Flow: unwrap request data, normalize remote engine state, then restore materialization metadata.
    onHydratedRequest: (requestPayload) => {
      const requestData = ((requestPayload as Record<string, unknown>).data ??
        requestPayload) as Record<string, unknown> | null;
      if (!requestData) return;
      const nodeId = typeof requestData.node_id === 'string' ? requestData.node_id : '';
      if (!nodeId) return;
      hydrateEngineConfig((requestData.engine as QuotationEngineConfig | null) ?? null);
      setSelectedMetadataColumns([]);
      applyMaterializedRequest(
        nodeId,
        requestData.materialized_path,
        requestData.materialize_summary as Record<string, unknown> | undefined,
      );
    },
    // Clears quotation-specific state after the shared lifecycle deletes the task result.
    onCleared: (_, options) => {
      setIsClearing(false);
      setHasLoaded(false);
      resetAfterClear();
      if (options?.preserveLocalState) {
        return;
      }
      // Detach the cleared task from the owning tab so a reload doesn't rehydrate
      // a task the user explicitly cleared. Inputs are intentionally preserved.
      onTabTaskChange?.(null);
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

  const hasLoaded = liveHasLoaded;

  const lastRunRequest = serverRequest ?? null;
  const currentQuotationParams = {
    type: resolvedEnginePayload.type,
    url:
      resolvedEnginePayload.type === 'remote' && resolvedEnginePayload.isValid
        ? resolvedEnginePayload.normalizedUrl
        : null,
  };
  const quotationServerParams = (request: Record<string, unknown>) => {
    const serverEngine = getServerEngineConfig(
      request,
      (url) => normalizeRemoteUrl(url).normalized,
    );
    return {
      type: serverEngine.type,
      // an empty remote engine URL should resolve to null
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      url: serverEngine.type === 'remote' ? serverEngine.url || null : null,
    };
  };
  const serverNodeId =
    lastRunRequest && typeof lastRunRequest.node_id === 'string' ? lastRunRequest.node_id : '';
  const serverColumn =
    lastRunRequest && typeof lastRunRequest.column === 'string' ? lastRunRequest.column : '';
  const hasLastRun = Boolean(lastRunRequest);
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
    hasLastRun,
    hasChanges: hasParamsChanged,
    isBusy: isLoadingQuotations,
    hasResults: hasLoaded,
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

  const {
    persistContextLengthPreference,
    handleSearchAll,
    handlePageChange,
    handlePageSizeChange,
    handleSort,
    handleDetach,
    handleMaterialize,
  } = useQuotationTaskFlow({
    state: {
      currentWorkspaceId,
      hasLoaded,
      displayedNodes,
      activeSelections,
      nodeState,
      originalColumnsByNode,
      buildEngineRequest,
    },
    actions: {
      setIsLoadingQuotations,
      setHasLoaded,
      setNodeDetaching,
      setNodeMaterializing,
      setMaterializeTaskIds,
      showErrorDialog,
      updateResultState,
      applyContextLengthPreferenceFromResult,
      setLocalTaskId,
      // Persist the run's assigned task id onto the active tab so reload
      // rehydrates the same task.
      onTaskIdAssigned: (taskId) => {
        if (tabId) onTabTaskChange?.(taskId);
      },
    },
    lock: {
      resolveTaskId,
      quotationSearch: async (nodeId, request) => {
        const response = await quotationSearch(nodeId, request);
        return isQuotationAnalysisResponse(response) ? response : null;
      },
      detachQuotation,
      materializeQuotation,
    },
  });

  useEffect(() => {
    persistContextPreferenceRef.current = persistContextLengthPreference;
  }, [persistContextLengthPreference]);

  useQuotationMaterializeLifecycle({
    workspaceId: currentWorkspaceId,
    materializeTaskIds,
    setNodeMaterializing,
    setMaterializeTaskIds,
    resolveTaskId,
    handlePageSizeChange,
    applyMaterializedRequest,
  });

  const { openDetachDialog, detachDialog } = useQuotationDetachDialog({
    workspaceId: currentWorkspaceId,
    activeSelections,
    resolveTaskId,
    handleDetach,
    materializedPaths,
    nodeDetaching,
    showErrorDialog,
  });

  // Runs a fresh quotation analysis or updates a locked task depending on parameter changes.
  /**
   * Passed to the analysis action button as its run/update handler.
   */
  const handleRunOrUpdate = async () => {
    await executeAnalysisRerun({
      hasUnrunChanges: hasParamsChanged,
      clearResults,
      runFreshAnalysis: handleSearchAll,
    });
  };

  /**
   * Passed to quotation result blocks as the page-change callback.
   */
  const effHandlePageChange = (newPage: number) => {
    void handlePageChange(newPage);
  };

  // Applies page-size changes to live task results.
  /**
   * Passed to quotation result blocks as the page-size callback.
   */
  const effHandlePageSizeChange = (newSize: number) => {
    void handlePageSizeChange(newSize);
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
            lastRemoteUrl={lastRemoteUrl}
            error={engineError}
            onEngineConfigChange={setTaskEngineConfig}
            onRemoteUrlChange={updateRemoteUrl}
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
            materializedPaths={materializedPaths}
            materializeSummary={materializeSummary}
            nodeMaterializing={nodeMaterializing}
            nodeDetaching={nodeDetaching}
            onSort={effHandleSort}
            onPageChange={effHandlePageChange}
            onPageSizeChange={effHandlePageSizeChange}
            onRowClick={handleQuotationRowClick}
            onMaterialize={(nodeId) => {
              void handleMaterialize(nodeId);
            }}
            onOpenDetachDialog={(nodeId) => {
              void openDetachDialog(nodeId);
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
