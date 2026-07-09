import { useEffect, useRef, useState } from 'react';
import type {
  QuotationAnalysisResponse,
  AnalysisTabInput,
  QuotationEngineConfig,
} from '@/api';

import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useAuth } from '@/features/auth/hooks/useAuth';
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
import {
  getNodeIdentifier,
  getServerEngineConfig,
  useLastRunRequest,
  useAnalysisFeature,
  executeAnalysisRerun,
} from '../common';
import { ANALYSIS_TAB_GROUPS, ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import { nodeInputsFromSelections, useTabNodeInputs } from '../common/nodeInputs';
import { getRerunActionState, hasNodeSelectionChanged } from '../common/rerunActionState';
import { hasParameterDiff } from '../common/parameterComparison';
import { getAnalysisTaskRequest, getAnalysisTaskResult } from '../common/analysisTasksApi';

import { useQuotationTaskFlow } from './hooks/useQuotationTaskFlow';
import { useQuotationContextPreference } from './hooks/useQuotationContextPreference';
import { useQuotationDetachDialog } from './hooks/useQuotationDetachDialog';
import { useQuotationEngineSettings } from './hooks/useQuotationEngineSettings';
import { useQuotationMaterializeLifecycle } from './hooks/useQuotationMaterializeLifecycle';
import { useQuotationResultControls } from './hooks/useQuotationResultControls';
import { useQuotationRowDetail } from './hooks/useQuotationRowDetail';
import { normalizeRemoteUrl } from './quotationRemoteUrl';
import { QuotationDetachDialog } from './components/QuotationDetachDialog';
import { QuotationEngineSettingsFields } from './components/QuotationEngineSettingsFields';
import { type QuotationHoverState } from './components/QuotationHighlightedCell';
import { QuotationResultsPanel } from './components/QuotationResultsPanel';
import { AnalysisCardLayout } from '../common/components/AnalysisCardLayout';
import { RowDetailPanel } from '../common/components/RowDetailPanel';
import { usePersistNodeDocumentColumn } from '../common/hooks/usePersistNodeDocumentColumn';

/** Renders the quotation extraction workflow, including live runs and result materialisation. */
/**
 * Rendered by: QuotationTabbedFeature, which mounts one instance per analysis tab and feeds it tab props.
 * Flow: read workspace/auth state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 *
 * Tab props: ``tabId`` identifies the active tab, ``tabTaskId`` seeds
 * deterministic hydration of that tab's task, and ``onTabTaskChange`` reports
 * task id assignment/clear back to the tab record.
 */
interface QuotationFeatureProps {
  tabId?: string;
  tabTaskId?: string | null;
  onTabTaskChange?: (taskId: string | null) => void;
  tabInputs?: AnalysisTabInput[];
  onTabInputsChange?: (inputs: AnalysisTabInput[]) => void;
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
  tabInputs,
  onTabInputsChange,
}: QuotationFeatureProps = {}) {
  const { handlePageChange: baseHandlePageChange, handlePageSizeChange: baseHandlePageSizeChange } =
    useWorkspaceSelection();
  const { currentWorkspaceId } = useWorkspaceData();
  const { quotationSearch, detachQuotation, materializeQuotation } = useWorkspaceActions();
  const { getAuthHeaders } = useAuth();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'quotation';
  const nodeInputs = useTabNodeInputs({
    tabInputs,
    onTabInputsChange,
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
  const applyInputsFromSelections = (selections: { nodeId: string; column?: string | null }[]) => {
    onTabInputsChange?.(nodeInputsFromSelections(selections));
  };
  const { serverRequest } = useLastRunRequest({
    analysisType: ANALYSIS_TAB_GROUPS.quotation,
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    taskId: tabTaskId ?? null,
  });
  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
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
   * Called by: QuotationFeature during this analysis workflow.
   * Flow: read workspace/auth state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
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
    getAuthHeaders,
    isTabActive: isActiveTab,
    // Tab-driven deterministic hydration: the tab's persisted task id wins task
    // resolution over transient local state.
    hydrationTaskId: tabTaskId ?? null,
    resultRef: quotationResultRef,
    // Loads the latest quotation result for polling and task resumption.
    // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config.
    fetchResult: async (taskId, headers) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      const data = await getAnalysisTaskResult<QuotationAnalysisResponse>(
        currentWorkspaceId,
        taskId,
        headers,
      );
      return isQuotationAnalysisResponse(data) ? data : null;
    },
    // Retrieves the submitted quotation request so hydration can restore engine and selection state.
    // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config.
    fetchRequest: async (taskId, headers) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisTaskRequest(
        ANALYSIS_TAB_GROUPS.quotation,
        currentWorkspaceId,
        taskId,
        headers,
      );
    },
    // Applies freshly fetched results to the active node table after lifecycle polling finishes.
    // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config. Flow: normalize inputs, derive state, then return the analysis result expected by callers.
    onResultFetched: (result, _taskId) => {
      // defensive: the analysis lifecycle may deliver an empty result on edge cases
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!result) return;
      const targetNode = displayedNodes[0];
      const nodeId = targetNode ? getNodeIdentifier(targetNode) : '';
      const selection = activeSelections.find((s) => s.nodeId === nodeId);
      const column = selection?.column ?? '';
      applyContextLengthPreferenceFromResult(result);
      if (nodeId && column) {
        updateResultState(nodeId, column, result);
      }
      setHasLoaded(true);
    },
    // Rebuilds result state from a cached task payload when the quotation tab hydrates.
    // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config.
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
    // Restores saved request settings, materialization metadata, and legacy tab inputs after reload.
    // Called by: useAnalysisFeature hydration because quotation restores must reapply engine settings, selected node/column, materialized path, and context length before rendering results. Flow: unwrap request data, normalize remote engine state, restore selection/materialization, then seed inputs once when a pre-input tab is loaded.
    onHydratedRequest: (requestPayload) => {
      const requestData = ((requestPayload as Record<string, unknown>).data ??
        requestPayload) as Record<string, unknown> | null;
      if (!requestData) return;
      // legacy node_id/nodeId fields are unknown strings; '' must fall through to the next source
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      const nodeId = (requestData.node_id || requestData.nodeId || '') as string;
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      const column = (requestData.column || '') as string;
      if (!nodeId) return;
      hydrateEngineConfig((requestData.engine as QuotationEngineConfig | null) ?? null);
      if (!tabInputs || tabInputs.length === 0) {
        applyInputsFromSelections([{ nodeId, column }]);
      }
      setSelectedMetadataColumns([]);
      applyMaterializedRequest(
        nodeId,
        requestData.materialized_path,
        requestData.materialize_summary as Record<string, unknown> | undefined,
      );
    },
    // Clears quotation-specific state after the shared lifecycle deletes the task result.
    // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config.
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
      const nodeId = getNodeIdentifier(node);
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
    engine_type: resolvedEnginePayload.type,
    engine_url:
      resolvedEnginePayload.type === 'remote' && resolvedEnginePayload.isValid
        ? resolvedEnginePayload.normalizedUrl
        : null,
  };
  const quotationServerParams = (request: Record<string, unknown>) => {
    const { type: serverEngineType, url: serverEngineUrl } = getServerEngineConfig(
      request,
      (url) => normalizeRemoteUrl(url).normalized,
    );
    return {
      engine_type: serverEngineType,
      // an empty remote engine URL should resolve to null
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      engine_url: serverEngineType === 'remote' ? serverEngineUrl || null : null,
    };
  };
  const serverNodeId = lastRunRequest
    ? // legacy node_id/nodeId fields are unknown strings; '' must fall through to the next source
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      ((lastRunRequest.node_id || lastRunRequest.nodeId || '') as string)
    : '';
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const serverColumn = lastRunRequest ? ((lastRunRequest.column || '') as string) : '';
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
   * Called by: QuotationFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
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
      baseHandlePageChange,
      baseHandlePageSizeChange,
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
      getAuthHeaders,
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
    getAuthHeaders,
    resolveTaskId,
    handlePageSizeChange,
    applyMaterializedRequest,
  });

  const { openDetachDialog, detachDialog } = useQuotationDetachDialog({
    workspaceId: currentWorkspaceId,
    activeSelections,
    resolveTaskId,
    getAuthHeaders,
    handleDetach,
    materializedPaths,
    nodeDetaching,
    showErrorDialog,
  });

  // Runs a fresh quotation analysis or updates a locked task depending on parameter changes.
  /**
   * Called by: QuotationFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleRunOrUpdate = async () => {
    await executeAnalysisRerun({
      hasUnrunChanges: hasParamsChanged,
      clearResults,
      runFreshAnalysis: handleSearchAll,
    });
  };

  /**
   * Called by: QuotationFeature during this analysis workflow.
   * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
   */
  const effHandlePageChange = (newPage: number) => {
    void handlePageChange(newPage);
  };

  // Applies page-size changes to live task results.
  /**
   * Called by: QuotationFeature during this analysis workflow.
   * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
   */
  const effHandlePageSizeChange = (newSize: number) => {
    void handlePageSizeChange(newSize);
  };

  // Applies column sorting to live task results.
  /**
   * Called by: QuotationFeature during this analysis workflow.
   * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
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
            // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config.
            onRun: () => {
              void handleRunOrUpdate();
            },
            // Stops the active quotation task from the shared layout action.
            // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config.
            onStop: () => {
              void stopTask();
            },
            // Clears live quotation state and backend results from the shared layout action.
            // Called by: QuotationFeature through its owning hook, JSX prop, or analysis lifecycle config.
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

      <QuotationDetachDialog
        open={detachDialog.open}
        onOpenChange={detachDialog.onOpenChange}
        isDetaching={detachDialog.isDetaching}
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
