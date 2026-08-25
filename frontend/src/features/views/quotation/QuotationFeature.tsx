import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  type QuotationAnalysisRequest,
  type QuotationEngineConfig,
  type QuotationResult,
  type QuotationRunAllResult,
  type DataBlockCreationSource,
} from '@/api';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import AnalysisTaskBanner from '@/features/views/common/components/AnalysisTaskBanner';
import { CONTEXTUAL_HINT_IDS } from '@/features/guidance/registry';
import { useProgressiveContextualHints } from '@/features/guidance/useProgressiveContextualHints';
import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import type { AnalysisTabFeatureProps } from '@/features/views/common/tabs/AnalysisTabsHost';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { getAnalysisOutputResource, getAnalysisResultResource } from '../common/analysisApi';
import { ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import { AnalysisCardLayout } from '../common/components/AnalysisCardLayout';
import { RowDetailPanel } from '../common/components/RowDetailPanel';
import { useAnalysisFeature } from '../common/hooks/useAnalysisFeature';
import { usePersistNodeDocumentColumn } from '../common/hooks/usePersistNodeDocumentColumn';
import { useTabNodeInputs } from '../common/nodeInputs';
import { hasParameterDiff } from '../common/parameterComparison';
import { getRerunActionState, hasNodeSelectionChanged } from '../common/rerunActionState';
import { getAnalysisActionLifecycle } from '../common/analysisActionLifecycle';
import { DEFAULT_TAB_INPUT_SET_ID } from '../common/tabs/tabStateOps';
import { analysisInputsFromRequest } from '../common/utils';
import { QuotationEngineSettingsFields } from './components/QuotationEngineSettingsFields';
import { type QuotationHoverState } from './components/QuotationHighlightedCell';
import { QuotationResultsPanel } from './components/QuotationResultsPanel';
import { useQuotationContextPreference } from './hooks/useQuotationContextPreference';
import { useQuotationEngineSettings } from './hooks/useQuotationEngineSettings';
import { useQuotationRowDetail } from './hooks/useQuotationRowDetail';
import { useQuotationTaskFlow } from './hooks/useQuotationTaskFlow';
import { useQuotationPage } from './hooks/useQuotationPage';
import { createNodeDataRequest, queryKeys } from '@/lib/queryKeys';
import { isArrowStringField } from '@/lib/arrow/arrowTable';
import type { QuotationReviewRowUnit } from './quotationArrowPage';
import { ResultAddToWorkspaceDialog } from '../common/components/ResultAddToWorkspaceDialog';

/** Renders the Quotation Preview and Run All workflow. */
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
    latestPreview,
    latestRunAll,
    activeAnalysis,
    analyses,
    refreshAnalyses,
    inputSets: tabInputSets,
    setInputSet: onTabInputSetChange,
  } = host;
  const tabTaskId = latestPreview?.id ?? null;
  const { currentWorkspaceId } = useWorkspaceData();
  const { runQuotationAll, createResultDataBlocks } = useWorkspaceActions();
  const nodeInputs = useTabNodeInputs({
    tabInputSets,
    onTabInputSetChange,
    constraints: {
      fieldPredicate: isArrowStringField,
      maxNodes: 1,
      docTypeOnly: true,
    },
  });
  const nodeColumnSelections = nodeInputs.nodeColumnSelections;
  const setNodeColumnSelection = nodeInputs.setColumn;
  const displayedNodes = nodeInputs.selectedNodes.slice(0, 1);
  const quotationRunAll = latestRunAll?.request.kind === 'quotation_run_all' ? latestRunAll : null;
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
  const [previewPageRequest, setPreviewPageRequest] = useState(() =>
    createNodeDataRequest({ page: 1, page_size: 50 }),
  );
  const [runAllReviewQuery, setRunAllReviewQuery] = useState(() =>
    createNodeDataRequest({
      page: 1,
      page_size: 20,
      sort_by: null,
      descending: false,
    }),
  );
  const [runAllReviewRowUnit, setRunAllReviewRowUnit] =
    useState<QuotationReviewRowUnit>('documents');
  const [isClearing, setIsClearing] = useState(false);
  const [isSubmittingRunAll, setIsSubmittingRunAll] = useState(false);
  const [addToWorkspaceDialogOpen, setAddToWorkspaceDialogOpen] = useState(false);
  const [isAddingToWorkspace, setIsAddingToWorkspace] = useState(false);
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
   * Passed to quotation task flows for user-visible failures.
   * Flow: normalize an empty failure message, store it, and open the shared error dialog.
   */
  const showErrorDialog = (message: string) => {
    setErrorDialogMessage(message || 'An unexpected error occurred.');
    setErrorDialogOpen(true);
  };

  const {
    request: serverRequest,
    setLocalTaskId,
    isRunning: isLoadingQuotations,
    setIsRunning: setIsLoadingQuotations,
    runningRef,
    banner: quotationWaitingBanner,
    taskStatus,
    analysisState,
    clearResults,
    stopTask,
    isStopping,
    result,
    isResultFetching,
  } = useAnalysisFeature<QuotationResult, QuotationAnalysisRequest>({
    taskType: ANALYSIS_TASK_TYPES.quotation,
    workspaceId: currentWorkspaceId,
    tabId: host.tabId,
    // The forest's newest Preview Analysis wins hydration over transient
    // submission state.
    hydrationTaskId: tabTaskId,
    requestHydration:
      !latestPreview && quotationRunAll?.request.kind === 'quotation_run_all'
        ? {
            analysisId: quotationRunAll.id,
            request: quotationRunAll.request.source,
          }
        : null,
    controlAnalysisId: activeAnalysis?.id ?? null,
    tabAnalysisIds: analyses.map((analysis) => analysis.id),
    retiredAnalysisIds: analyses.flatMap((analysis) =>
      analysis.state === 'succeeded' ? analysis.supersedes_analysis_ids : [],
    ),
    fetchResult: async (taskId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisResultResource<QuotationResult>(currentWorkspaceId, taskId);
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
    onCleared: () => {
      setIsClearing(false);
      setPreviewPageRequest(createNodeDataRequest({ page: 1, page_size: 50 }));
      // Refresh the canonical forest; curated inputs remain in the Tab draft.
      refreshAnalyses();
    },
  });
  const analysisActionLifecycle = getAnalysisActionLifecycle({
    isPreviewing: isLoadingQuotations,
    isSubmittingRunAll,
    runAllState: quotationRunAll?.state ?? null,
    hasActiveAnalysis: Boolean(activeAnalysis),
  });
  const runAllResultQuery = useQuery({
    queryKey:
      currentWorkspaceId && quotationRunAll
        ? queryKeys.analysisResult(currentWorkspaceId, quotationRunAll.id)
        : queryKeys.inactiveAnalysisResult(),
    enabled: Boolean(currentWorkspaceId) && quotationRunAll?.state === 'succeeded',
    queryFn: async (): Promise<QuotationRunAllResult> => {
      if (!currentWorkspaceId || !quotationRunAll) throw new Error('Run All Result is unavailable');
      const value = await getAnalysisOutputResource(currentWorkspaceId, quotationRunAll.id);
      if (value.kind !== 'quotation_run_all') {
        throw new Error('Quotation Run All Result is invalid');
      }
      return value;
    },
  });
  const runAllSource = runAllResultQuery.data?.source ?? null;
  const resultNodeId =
    serverRequest && typeof serverRequest.node_id === 'string'
      ? serverRequest.node_id
      : (displayedNodes[0]?.id ?? '');
  const resultColumn =
    serverRequest && typeof serverRequest.column === 'string'
      ? serverRequest.column
      : (activeSelections.find((selection) => selection.nodeId === resultNodeId)?.column ?? '');
  const pageRequest = runAllSource ? runAllReviewQuery : previewPageRequest;
  const quotationPage = useQuotationPage(
    currentWorkspaceId && quotationRunAll && runAllSource
      ? {
          kind: 'run_all',
          workspaceId: currentWorkspaceId,
          analysisId: quotationRunAll.id,
          source: runAllSource,
          rowUnit: runAllReviewRowUnit,
        }
      : currentWorkspaceId && tabTaskId && result && resultNodeId && resultColumn
        ? {
            kind: 'preview',
            workspaceId: currentWorkspaceId,
            analysisId: tabTaskId,
            nodeId: resultNodeId,
            documentColumn: resultColumn,
          }
        : null,
    pageRequest,
  );
  const resultNodeKey = runAllSource?.node_id ?? resultNodeId;
  const resultsByNode =
    quotationPage.data && resultNodeKey ? { [resultNodeKey]: quotationPage.data } : {};
  const hasLoaded = Boolean(result);
  const showPreviewTable =
    displayedNodes.length > 0 &&
    (hasLoaded ||
      (analysisState === 'succeeded' && (isResultFetching || quotationPage.isFetching)));

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

  const { handleSearchAll, handlePageChange, handlePageSizeChange, handleSort } =
    useQuotationTaskFlow({
      state: {
        currentWorkspaceId,
        tabId: host.tabId,
        hasLoaded,
        displayedNodes,
        activeSelections,
        previewRequest: previewPageRequest,
        originalColumnsByNode,
        buildEngineRequest,
        supersedesAnalysisIds: tabTaskId ? [tabTaskId] : [],
      },
      actions: {
        setIsLoadingQuotations,
        showErrorDialog,
        setPreviewRequest: (query) => {
          setPreviewPageRequest(query);
        },
        resetPreviewRequest: () => {
          setPreviewPageRequest(createNodeDataRequest({ page: 1, page_size: 50 }));
        },
        setLocalTaskId,
        runningRef,
        onSubmitted: refreshAnalyses,
      },
    });

  // Runs a fresh quotation analysis or updates a locked task depending on parameter changes.
  /**
   * Passed to the analysis action button as its run/update handler.
   */
  const handleRunOrUpdate = async () => {
    await handleSearchAll();
  };

  const handleRunAll = async () => {
    const node = displayedNodes[0];
    const column = node
      ? activeSelections.find((selection) => selection.nodeId === node.id)?.column
      : null;
    const engine = buildEngineRequest();
    if (!node || !column || !engine || analysisActionLifecycle.isRunningAll) return;
    const source: QuotationAnalysisRequest = {
      node_id: node.id,
      column,
      engine,
    };
    setIsSubmittingRunAll(true);
    try {
      await runQuotationAll(host.tabId, { source }, tabTaskId ? [tabTaskId] : []);
      refreshAnalyses();
    } catch (error) {
      showErrorDialog(
        error instanceof Error ? error.message : 'Could not start Quotation Run All.',
      );
    } finally {
      setIsSubmittingRunAll(false);
    }
  };

  const handleAddToWorkspace = async (sources: DataBlockCreationSource[]) => {
    const source = sources[0];
    if (!quotationRunAll || !source || sources.length !== 1) return;
    setIsAddingToWorkspace(true);
    try {
      await createResultDataBlocks(host.tabId, quotationRunAll.id, {
        kind: 'quotation_result_data_block_creation',
        source,
      });
      setAddToWorkspaceDialogOpen(false);
      toast.success('Adding Quotation Results to the Workspace.');
    } catch (cause) {
      toast.error('Could not add Quotation Results.', {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setIsAddingToWorkspace(false);
    }
  };

  /**
   * Passed to quotation result blocks as the page-change callback.
   */
  const effHandlePageChange = (newPage: number) => {
    if (runAllSource) {
      setRunAllReviewQuery((current) => ({ ...current, page: newPage }));
      return;
    }
    handlePageChange(newPage);
  };

  // Applies page-size changes to live task results.
  /**
   * Passed to quotation result blocks as the page-size callback.
   */
  const effHandlePageSizeChange = (newSize: number) => {
    if (runAllSource) {
      setRunAllReviewQuery((current) => ({ ...current, page: 1, page_size: newSize }));
      return;
    }
    handlePageSizeChange(newSize);
  };

  // Applies column sorting to live task results.
  /**
   * Passed to quotation result blocks as the column-sort callback.
   */
  const effHandleSort = (nodeId: string, columnName: string) => {
    if (runAllSource) {
      setRunAllReviewQuery((current) => ({
        ...current,
        page: 1,
        sort_by: columnName,
        descending: current.sort_by === columnName ? !current.descending : false,
      }));
      return;
    }
    handleSort(nodeId, columnName);
  };

  useProgressiveContextualHints([
    CONTEXTUAL_HINT_IDS.quotation.inputs,
    ...(canRunQuotation ? [CONTEXTUAL_HINT_IDS.quotation.engine] : []),
    ...(showPreviewTable ? [CONTEXTUAL_HINT_IDS.quotation.previewResults] : []),
    ...(runAllSource && quotationPage.data ? [CONTEXTUAL_HINT_IDS.quotation.runAllResults] : []),
    ...(runAllSource ? [CONTEXTUAL_HINT_IDS.quotation.addToWorkspace] : []),
  ]);

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
            onPreview: () => {
              void handleRunOrUpdate();
            },
            onRunAll: handleRunAll,
            // Stops the active quotation task from the shared layout action.
            onStop: activeAnalysis
              ? () => {
                  void stopTask();
                }
              : undefined,
            // Clears live quotation state and backend results from the shared layout action.
            onClear: async () => {
              if (!currentWorkspaceId) return;
              setIsClearing(true);
              await clearResults();
              setIsClearing(false);
            },
            previewDisabled:
              analysisActionLifecycle.previewDisabled ||
              actionState.runDisabled ||
              !canRunQuotation,
            previewDisabledReason: (() => {
              if (isLoadingQuotations) return undefined;
              if (actionState.runDisabledReason) return actionState.runDisabledReason;
              if (hasIncompleteSelections) return 'Select a column for each data block';
              if (!engineReady) return 'Configure the remote engine before running';
              return undefined;
            })(),
            runAllDisabled: !canRunQuotation || analysisActionLifecycle.runAllDisabled,
            clearDisabled:
              analyses.length === 0 ||
              analysisActionLifecycle.isPreviewing ||
              analysisActionLifecycle.isRunningAll ||
              Boolean(activeAnalysis) ||
              isClearing,
            clearDisabledReason: actionState.clearDisabledReason,
            isPreviewing: analysisActionLifecycle.isPreviewing,
            isRunningAll: analysisActionLifecycle.isRunningAll,
            isStopping,
            isClearing,
            hasResult: hasLoaded,
            previewLabel: analysisActionLifecycle.parametersLocked
              ? 'Preview'
              : actionState.runLabel === 'Re-run'
                ? 'Update Preview'
                : 'Preview',
            clearHelp: {
              targetKey: 'analysis.quotation.clear-results',
              label: 'Clear results',
            },
          }}
          actionsGuidanceTarget="quotation-actions"
          parametersLocked={analysisActionLifecycle.parametersLocked}
        >
          <NodeInputsPanel
            guidanceTarget="quotation-inputs"
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

        {quotationRunAll &&
        (quotationRunAll.state === 'queued' || quotationRunAll.state === 'running') ? (
          <AnalysisTaskBanner
            analysisName="Quotation Run All"
            status={quotationRunAll.state}
            taskId={quotationRunAll.id}
            message={quotationRunAll.progress.message ?? undefined}
          />
        ) : null}

        {runAllSource || showPreviewTable ? (
          <QuotationResultsPanel
            title={runAllSource ? 'Review' : 'Search Results'}
            guidanceTarget={
              runAllSource ? 'quotation-run-all-results' : 'quotation-preview-results'
            }
            headerAction={
              runAllSource ? (
                <Button
                  data-guidance="quotation-add-to-workspace"
                  type="button"
                  onClick={() => {
                    setAddToWorkspaceDialogOpen(true);
                  }}
                >
                  Add to Workspace
                </Button>
              ) : null
            }
            displayedNodes={
              runAllSource
                ? [
                    {
                      id: runAllSource.node_id,
                      name: runAllSource.node_name,
                      color: runAllSource.color,
                      document: runAllSource.document_column,
                      shape: [null, null],
                      tokenizerModel: null,
                    },
                  ]
                : displayedNodes
            }
            activeSelections={
              runAllSource
                ? [{ nodeId: runAllSource.node_id, column: runAllSource.document_column }]
                : activeSelections
            }
            resultsByNode={resultsByNode}
            reviewRowUnit={runAllSource ? runAllReviewRowUnit : null}
            onReviewRowUnitChange={(rowUnit) => {
              setRunAllReviewRowUnit(rowUnit);
              setRunAllReviewQuery((current) => ({ ...current, page: 1 }));
            }}
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
            onSort={effHandleSort}
            onPageChange={effHandlePageChange}
            onPageSizeChange={effHandlePageSizeChange}
            onRowClick={handleQuotationRowClick}
            isPageLoading={quotationPage.isFetching || isResultFetching}
          />
        ) : null}
      </div>
      {addToWorkspaceDialogOpen && runAllSource ? (
        <ResultAddToWorkspaceDialog
          open
          onOpenChange={setAddToWorkspaceDialogOpen}
          title="Add Quotation Results to Workspace"
          nameSuffix="quotation"
          sources={[runAllSource]}
          isSubmitting={isAddingToWorkspace}
          onSubmit={(sources) => {
            void handleAddToWorkspace(sources);
          }}
        />
      ) : null}

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
