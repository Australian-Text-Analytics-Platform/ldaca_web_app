import { useState, useEffect, useRef } from 'react';
import type { ConcordanceAnalysisResponse } from '@/api';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useAnalysisStore } from '@/stores/analysisStore';
import { useUIStore } from '@/stores';
import { Card, CardContent } from '@/components/ui/card';
import AnalysisTaskBanner from '@/features/views/common/components/AnalysisTaskBanner';
import { useLastRunRequest } from '../common/hooks/useLastRunRequest';
import { useAnalysisFeature } from '../common/hooks/useAnalysisFeature';
import { useNodeColorControls } from '../common/hooks/useNodeColorControls';
import { executeAnalysisRerun } from '../common/rerunAnalysis';
import { ANALYSIS_TAB_GROUPS, ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import { nodeInputsFromSelections, useTabNodeInputs } from '../common/nodeInputs';
import { getAnalysisRequest, getAnalysisResultResource } from '../common/analysisApi';
import { getRerunActionState, hasNodeSelectionChanged } from '../common/rerunActionState';
import { hasParameterDiff } from '../common/parameterComparison';
import { DEFAULT_TAB_INPUT_SET_ID } from '@/features/views/common/tabs/tabStateOps';
import type { AnalysisTabFeatureProps } from '@/features/views/common/tabs/AnalysisTabsHost';
import { pruneTasksById } from '@/features/views/common/analysisTaskUtils';
import { useConcordanceTaskFlow } from './hooks/useConcordanceTaskFlow';
import { useConcordanceMetadataColumns } from './hooks/useConcordanceMetadataColumns';
import { useConcordancePendingHandoff } from './hooks/useConcordancePendingHandoff';
import { useConcordanceViewModeSwap } from './hooks/useConcordanceViewModeSwap';
import { useConcordanceDetachDialogs } from './hooks/useConcordanceDetachDialogs';
import { useConcordanceDispersionControls } from './hooks/useConcordanceDispersionControls';
import { useConcordanceTokenizerMode } from './hooks/useConcordanceTokenizerMode';
import { useConcordanceResultSession } from './hooks/useConcordanceResultSession';
import {
  readConcordanceServerParams,
  useConcordanceParameters,
} from './hooks/useConcordanceParameters';
import { ConcordanceParameterPanel } from './components/ConcordanceParameterPanel';
import TokenizerModelSelector from '../common/components/TokenizerModelSelector';
import { ConcordanceResultsPanel } from './components/ConcordanceResultsPanel';
import { DetachColumnsDialog } from '../common/components/DetachColumnsDialog';
import { RowDetailPanel } from '../common/components/RowDetailPanel';
import { usePersistNodeDocumentColumn } from '../common/hooks/usePersistNodeDocumentColumn';
import { useConcordanceRowDetail } from './hooks/useConcordanceRowDetail';

/** Orchestrates the full concordance analysis UI, task lifecycle, and detach flows. */
/**
 * Rendered by: the analysis feature registry when this panel is selected.
 * Flow: read workspace/tab state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 *
 * The required host supplies normalized task/input state and closure-bound
 * persistence commands for the active tab; this feature has no standalone or
 * optional-tab compatibility path.
 */
function ConcordanceFeature({ host }: AnalysisTabFeatureProps) {
  const {
    taskId: tabTaskId,
    setTaskId: onTabTaskChange,
    inputSets: tabInputSets,
    setInputSet: onTabInputSetChange,
  } = host;
  // Anchor ref for results container to stabilize scroll on view mode toggle
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const { selectedNodes } = useWorkspaceSelection();
  const { isLoading } = useWorkspaceStatus();
  const { currentWorkspaceId } = useWorkspaceData();
  const {
    detachConcordance,
    detachConcordanceDispersion,
    replaceSelectedNodes,
    setNodeColor: persistNodeColor,
  } = useWorkspaceActions();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'concordance';
  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
  });
  const {
    nodeColumnSelections,
    setColumn: setNodeColumnSelection,
    selectedNodes: panelSelectedNodes,
    resolvedNodes: inputResolvedNodes,
    addNodes,
    removeNode,
    clear: clearInputs,
    getAddRejection,
    availableNodes,
    canAddMore,
    graphSelectedIds,
    getColumnInfos,
    nodeInfoCache,
  } = useTabNodeInputs({
    tabInputSets,
    onTabInputSetChange,
    constraints: {
      allowedDataTypes: ['string'],
      maxNodes: 2,
      docTypeOnly: true,
    },
  });
  // Shared node-inputs result re-bundled for the parameter panel.
  const nodeInputs = {
    nodeColumnSelections,
    setColumn: setNodeColumnSelection,
    selectedNodes: panelSelectedNodes,
    resolvedNodes: inputResolvedNodes,
    addNodes,
    removeNode,
    clear: clearInputs,
    getAddRejection,
    availableNodes,
    canAddMore,
    graphSelectedIds,
  } as ReturnType<typeof useTabNodeInputs>;
  // Add-node-as-needed model has no lock; ids derive from the inputs.
  const activeNodeIds = inputResolvedNodes.map((r) => r.id);
  const { nodeColorOverrides, setNodeColor, ensureNodeColors } = useNodeColorControls({
    nodeIds: activeNodeIds,
    nodes: panelSelectedNodes,
    persistNodeColor,
  });
  // Last-run request, used only to compute the Run vs Re-run button state.
  const { serverRequest } = useLastRunRequest({
    analysisType: ANALYSIS_TAB_GROUPS.concordance,
    workspaceId: currentWorkspaceId,
    taskId: tabTaskId,
  });
  /** Replaces this tab's inputs from a node/column selection list (hydration + handoff). */
  const applyInputsFromSelections = (sels: { nodeId: string; column?: string | null }[]) => {
    onTabInputSetChange(DEFAULT_TAB_INPUT_SET_ID, nodeInputsFromSelections(sels));
  };
  const pendingConcordance = useAnalysisStore((state) => state.pendingConcordance);
  const clearPendingConcordance = useAnalysisStore((state) => state.clearPendingConcordance);
  const setTasks = useAnalysisStore((state) => state.setTasks);
  const concordanceParameters = useConcordanceParameters();
  const {
    searchWord,
    setSearchWord,
    numLeftTokens,
    setNumLeftTokens,
    numRightTokens,
    setNumRightTokens,
    regex,
    setRegex,
    wholeWord,
    setWholeWord,
    caseSensitive,
    setCaseSensitive,
    currentParams: currentConcordanceParams,
  } = concordanceParameters;
  const [selectedMetadataColumns, setSelectedMetadataColumns] = useState<string[]>([]);
  // Metadata visibility derives from the selected columns: any selection
  // shows the corresponding metadata columns in the results table.
  const showMetadata = selectedMetadataColumns.length > 0;
  const {
    concordanceView,
    setConcordanceView,
    showDispersion,
    proportionalDispersionBars,
    setProportionalDispersionBars,
    colourMatches,
    setColourMatches,
    lowercaseMatches,
    setLowercaseMatches,
    hiddenMatchedTexts,
    setHiddenMatchedTexts,
    binCount,
    setBinCount,
    combinedSourceMode,
    setCombinedSourceMode,
    dispersionChartMode,
    setDispersionChartMode,
    selectedBinIndices,
    handleBinSelect,
    handleBinRangeSelect,
    handleClearBinSelection,
  } = useConcordanceDispersionControls();
  const [resultsViewportWidth, setResultsViewportWidth] = useState(0);
  const resultsViewportRef = useRef<HTMLDivElement | null>(null);
  const {
    results,
    resultRef: concordanceResultsRef,
    setResults,
    nodePagination,
    setNodePagination,
    nodeLoading,
    setNodeLoading,
    nodeDetaching,
    setNodeDetaching,
    globalPageSize,
    applyGlobalPageSize,
    reset: resetResultSession,
    labelToNodeId,
    defaultPalette,
    nodeColors,
    sourceColorMap,
    allMatchedTexts,
    matchedTextColorMap,
    resolveNodeIdForKey,
  } = useConcordanceResultSession({
    selectedNodes: panelSelectedNodes,
    showDispersion,
    colourMatches,
    lowercaseMatches,
    nodeColorOverrides,
  });

  const [viewMode, setViewMode] = useState<'separated' | 'combined'>('separated');
  const [combinedPage, setCombinedPage] = useState(1);

  useEffect(() => {
    const element = resultsViewportRef.current;
    if (!element) {
      return;
    }

    /** Keeps dispersion column sizing synced with the rendered results viewport. */
    /**
     * Called by the layout effect and its ResizeObserver callback.
     */
    const updateWidth = () => {
      setResultsViewportWidth(element.clientWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [results]);

  // Concordance has two engines. ``regex`` walks raw text (the historical
  // default, preserving ``equ\w*``-style affordances); ``tokens`` walks the
  // tokenization column prepared by the selected tokenizer model for
  // actual-token context. The hook owns availability and auto-switching.
  const {
    searchMode,
    tokensModeAvailable,
    effectiveTokenizerModelsByNode,
    setSearchModeFromUser,
    recordTokenizerModel,
    clearTokenizerModel,
  } = useConcordanceTokenizerMode({
    effectiveNodeColumnSelections: nodeColumnSelections,
    nodeInfoCache,
  });

  const { availableMetadataColumns, metadataColumnSections, metadataDisabledReason } =
    useConcordanceMetadataColumns({
      results,
      panelSelectedNodes,
      effectiveNodeColumnSelections: nodeColumnSelections,
      getColumnInfos,
      viewMode,
      nodeColors,
      resolveNodeIdForKey,
    });
  const availableMetadataColumnsKey = availableMetadataColumns.join('|');

  const { detailPayload, detailOpen, setDetailOpen, concordanceCustomization, handleRowClick } =
    useConcordanceRowDetail({
      currentWorkspaceId,
      caseSensitive,
      searchWord,
    });

  const {
    resolveTaskId,
    setLocalTaskId: setLocalConcordanceTaskId,
    isRunning: isSearching,
    setIsRunning: setIsSearching,
    runningRef,
    lastFetchedRef,
    taskStatus: concordanceTaskStatus,
    banner: concordanceWaitingBanner,
    hydrationState,
    clearResults,
    stopTask,
    isStopping,
  } = useAnalysisFeature<ConcordanceAnalysisResponse>({
    analysisType: ANALYSIS_TAB_GROUPS.concordance,
    taskType: ANALYSIS_TASK_TYPES.concordance,
    workspaceId: currentWorkspaceId,
    tabId: host.tabId,
    isTabActive: isActiveTab,
    // The host's persisted task id wins task resolution over transient local state.
    hydrationTaskId: tabTaskId,
    resultRef: concordanceResultsRef,
    /** Fetches a completed concordance task result for polling and hydration. */
    fetchResult: async (taskId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisResultResource<ConcordanceAnalysisResponse>(currentWorkspaceId, taskId);
    },
    /** Fetches the saved request so hydration can restore the analysis controls. */
    fetchRequest: async (taskId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisRequest(currentWorkspaceId, taskId);
    },
    /** Copies freshly fetched task results into the feature's safe-result state. */
    onResultFetched: (resultData) => {
      setResults(resultData);
    },
    /** Accepts restored result payloads from persisted analysis tasks. */
    onHydratedResult: (resultPayload) => {
      const res = resultPayload?.data ?? resultPayload;
      if (res) {
        setResults(resultPayload);
      }
    },
    /** Restores concordance form controls from a saved request. */
    onHydratedRequest: (requestPayload) => {
      const req = (requestPayload as Record<string, unknown> | undefined)?.data ?? requestPayload;
      if (!req || typeof req !== 'object') return;
      const reqObj = req as Record<string, unknown>;
      applyInputsFromSelections(concordanceParameters.applyHydratedRequest(reqObj));
      // Combined view is a client-only synthesis and is never persisted, so
      // hydrated tasks always restore to separated; the user can re-enter
      // combined via the toggle (which re-pages both nodes on demand).
      setViewMode('separated');
    },
    /** Clears result-specific state while preserving local controls when requested by handoff flows. */
    onCleared: (_, options) => {
      resetResultSession();
      setCombinedPage(1);
      if (options?.preserveLocalState) {
        return;
      }
      // Detach the cleared task from the owning tab so a reload doesn't rehydrate
      // a task the user explicitly cleared. Preserve-local-state clears (handoff
      // flows) intentionally keep the tab→task link. Inputs are intentionally
      // left intact so the user keeps their curated selection after clearing.
      onTabTaskChange(null);
    },
    /** Keeps the shared task inbox free of concordance task duplicates after lifecycle updates. */
    pruneTaskInbox: (taskIds) => {
      setTasks((prev) => {
        if (!Array.isArray(prev)) return prev;
        return taskIds.length > 0 ? pruneTasksById(prev, taskIds) : prev;
      });
    },
    /** Lets the shared analysis lifecycle recognize in-flight concordance responses. */
    isResultRunning: (r) => r?.state === 'running',
  });

  // No auto-selection on activation: Show metadata starts empty and the user
  // explicitly ticks the columns they want. We just clean up any selections
  // that are no longer in the available set (e.g. after a re-run that drops
  // a column from the source data).
  useEffect(() => {
    void Promise.resolve().then(() => {
      setSelectedMetadataColumns((prev) => {
        const filtered = prev.filter((column) => availableMetadataColumns.includes(column));
        if (filtered.length === prev.length) return prev;
        return filtered;
      });
    });
  }, [availableMetadataColumns, availableMetadataColumnsKey]);

  const {
    handleSearch,
    handleHandoffSearch,
    updateStoredResult,
    handleSort,
    handlePageChange,
    persistResultPreferences,
    handleDetach,
    handleDispersionDetach,
  } = useConcordanceTaskFlow({
    state: {
      currentWorkspaceId,
      tabId: host.tabId,
      searchWord,
      activeNodeIds,
      effectiveNodeColumnSelections: nodeColumnSelections,
      globalPageSize,
      nodePagination,
      viewMode,
      combinedPage,
      numLeftTokens,
      numRightTokens,
      regex,
      wholeWord,
      caseSensitive,
      searchMode,
    },
    actions: {
      setNodePagination,
      setIsSearching,
      setResults,
      setLocalTaskId: setLocalConcordanceTaskId,
      runningRef,
      lastFetchedRef,
      setNodeLoading,
      setNodeDetaching,
      // Persist the run's assigned task id onto the active tab so reload
      // rehydrates the same task. No-op when not tab-mounted.
      onTaskIdAssigned: (taskId) => {
        onTabTaskChange(taskId);
      },
    },
    lock: {
      resolveTaskId,
      detachConcordance,
      detachConcordanceDispersion,
    },
  });

  const { openDetachDialog, openDispersionDetachDialog, detachDialog, dispersionDetachDialog } =
    useConcordanceDetachDialogs({
      workspaceId: currentWorkspaceId,
      handleDetach,
      handleDispersionDetach,
      nodeDetaching,
    });

  // Single source of truth for page size across every concordance result table.
  // Used by: each per-node / combined ServerPaginationFooter because changing
  // the size on any table must keep all tables in sync and persist once.
  // Flow: update globalPageSize, mirror it onto every node's internal pagination
  // (resetting to page 1), then persist unless the panel is read-only.
  const handleGlobalPageSizeChange = (newSize: number) => {
    applyGlobalPageSize(newSize);
    void persistResultPreferences({ pageSize: newSize });
  };

  // Run vs Re-run: with no locking, the primary button is gated purely by
  // whether the current params or node inputs differ from the last run.
  const lastRunRequest = serverRequest ?? null;
  const hasChanges = !lastRunRequest
    ? true
    : hasParameterDiff(currentConcordanceParams, readConcordanceServerParams(lastRunRequest)) ||
      hasNodeSelectionChanged(
        nodeColumnSelections,
        lastRunRequest.node_ids as string[] | undefined,
        lastRunRequest.node_columns as Record<string, string> | undefined,
      );

  const actionState = getRerunActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    isRunnable:
      panelSelectedNodes.length > 0 &&
      Boolean(searchWord.trim()) &&
      nodeColumnSelections.length > 0 &&
      nodeColumnSelections.every((s) => Boolean(s.column)),
    hasAttachedAnalysis: Boolean(tabTaskId),
    analysisState: concordanceTaskStatus.tasks[0]?.state ?? null,
    hasChanges,
    isBusy: isSearching,
  });

  // Preserve results across transient graph refetches. Under the add-node-as-
  // needed model, editing a tab's inputs does NOT wipe the displayed results;
  // it flips the primary button to "Re-run". So there is no selection-driven
  // auto-clear effect here anymore.

  useEffect(() => {
    if (!currentWorkspaceId) {
      setLocalConcordanceTaskId(null);
    }
  }, [currentWorkspaceId, setLocalConcordanceTaskId]);

  useEffect(() => {
    if (concordanceTaskStatus.tasks.length === 0) {
      setLocalConcordanceTaskId(null);
    }
  }, [concordanceTaskStatus.tasks.length, setLocalConcordanceTaskId]);

  const { autoSearchRequest } = useConcordancePendingHandoff({
    tabId: host.tabId,
    pendingConcordance,
    clearPendingConcordance,
    hydrationState,
    selectedNodes,
    setSearchWord,
    setNodeColumnSelections: (sels) => {
      applyInputsFromSelections(sels);
    },
    replaceSelectedNodes,
  });

  // No auto-column recompute: a node's default column is chosen at add-time by
  // the node-inputs model, so there is no unlocked recompute effect here.

  // Color assignment now handled by stack allocator - no auto-fill effect needed

  /**
   * Passed to the concordance node-input panel as its column-change handler.
   */
  const handleColumnChange = (nodeId: string, column: string) => {
    setNodeColumnSelection(nodeId, column);
    void persistDocumentColumn(nodeId, column);
    // Clear the tokenizer model for this node when the column changes; model
    // preferences are scoped to source columns.
    clearTokenizerModel(nodeId);
  };

  /** Persists the tokenizer model chosen for a node/column when tokens mode is available. */
  /**
   * Passed to the tokenizer selector in the node-input panel.
   */
  const handleTokenizerModelChange = (
    nodeId: string,
    _column: string,
    model: string,
    _language: string | null,
  ) => {
    recordTokenizerModel(nodeId, model);
  };

  const submittedAutoSearchRef = useRef<typeof autoSearchRequest>(null);
  useEffect(() => {
    if (!autoSearchRequest || submittedAutoSearchRef.current === autoSearchRequest) {
      return;
    }
    submittedAutoSearchRef.current = autoSearchRequest;
    void handleHandoffSearch(autoSearchRequest);
  }, [autoSearchRequest, handleHandoffSearch]);

  /** Delegates clearing to the shared analysis lifecycle only when a workspace is active. */
  /**
   * Passed to the analysis action controls as the clear handler.
   */
  const handleClearResults = async (): Promise<boolean> => {
    if (!currentWorkspaceId) return false;
    return clearResults();
  };

  /** Runs or updates concordance after shared update checks pass. */
  /**
   * Passed to the analysis action controls as the run/update handler.
   */
  const handleRunOrUpdate = async () => {
    await ensureNodeColors();
    await executeAnalysisRerun({
      hasAttachedAnalysis: Boolean(tabTaskId),
      clearResults: handleClearResults,
      /** Starts the feature-specific concordance search after shared update checks pass. */
      runFreshAnalysis: () => handleSearch(),
    });
  };

  const { combinedLoading, handleViewModeChange } = useConcordanceViewModeSwap({
    viewMode,
    setViewMode,
    results,
    setResults,
    combinedPage,
    globalPageSize,
    updateStoredResult,
    resultsRef,
  });

  return (
    <div className="space-y-4">
      <ConcordanceParameterPanel
        nodeInputs={nodeInputs}
        handleColumnChange={handleColumnChange}
        nodeColors={nodeColors}
        onNodeColorChange={(nodeId, color) => {
          void setNodeColor(nodeId, color);
        }}
        defaultPalette={defaultPalette}
        searchWord={searchWord}
        setSearchWord={setSearchWord}
        numLeftTokens={numLeftTokens}
        setNumLeftTokens={setNumLeftTokens}
        numRightTokens={numRightTokens}
        setNumRightTokens={setNumRightTokens}
        regex={regex}
        setRegex={setRegex}
        wholeWord={wholeWord}
        setWholeWord={setWholeWord}
        caseSensitive={caseSensitive}
        setCaseSensitive={setCaseSensitive}
        searchMode={searchMode}
        setSearchMode={setSearchModeFromUser}
        tokensModeAvailable={tokensModeAvailable}
        renderTokenizerModelSelector={({ nodeId, column }) => (
          <TokenizerModelSelector
            workspaceId={currentWorkspaceId}
            nodeId={nodeId}
            column={column}
            value={effectiveTokenizerModelsByNode[nodeId] ?? ''}
            onChange={(model, detectedLanguage) => {
              handleTokenizerModelChange(nodeId, column, model, detectedLanguage);
            }}
          />
        )}
        isSearching={isSearching}
        actionState={actionState}
        handleRunOrUpdate={handleRunOrUpdate}
        handleStopTask={stopTask}
        isStopping={isStopping}
        handleClearResults={handleClearResults}
      />

      {concordanceWaitingBanner && (
        <AnalysisTaskBanner
          analysisName="Concordance"
          status={concordanceWaitingBanner.status}
          taskId={concordanceWaitingBanner.taskId}
          message={concordanceWaitingBanner.message}
          className="mt-4"
        />
      )}

      {/* Results */}
      {results?.state === 'successful' && (
        <ConcordanceResultsPanel
          shell={{
            resultsRef,
            resultsViewportRef,
            resultsViewportWidth,
            viewMode,
            handleViewModeChange,
            combinedLoading,
          }}
          display={{
            concordanceView,
            setConcordanceView,
            proportionalDispersionBars,
            setProportionalDispersionBars,
            combinedSourceMode,
            setCombinedSourceMode,
            dispersionChartMode,
            setDispersionChartMode,
            selectedBinIndices,
            onBinSelect: handleBinSelect,
            onBinRangeSelect: handleBinRangeSelect,
            onClearBinSelection: handleClearBinSelection,
            colourMatches,
            setColourMatches,
            lowercaseMatches,
            setLowercaseMatches,
            hiddenMatchedTexts,
            setHiddenMatchedTexts,
            binCount,
            setBinCount,
            allMatchedTexts,
            matchedTextColorMap,
          }}
          metadata={{
            showMetadata,
            availableMetadataColumns,
            sections: metadataColumnSections,
            disabledReason: metadataDisabledReason,
            selectedColumns: selectedMetadataColumns,
            setSelectedColumns: setSelectedMetadataColumns,
          }}
          sources={{
            searchWord,
            selectedNodes,
            panelSelectedNodes,
            effectiveNodeColumnSelections: nodeColumnSelections,
            labelToNodeId,
            sourceColorMap,
            defaultPalette,
          }}
          session={{
            results,
            nodePagination,
            globalPageSize,
            onPageSizeChange: handleGlobalPageSizeChange,
            combinedPage,
            setCombinedPage,
            nodeLoading,
            nodeDetaching,
          }}
          commands={{
            handleSort,
            handlePageChange,
            handleRowClick,
            openDetachDialog: (nodes) => {
              openDetachDialog(nodes);
            },
            onDispersionDetach: openDispersionDetachDialog,
          }}
        />
      )}

      {results?.state === 'failed' && (
        <Card>
          <CardContent>
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {results.message}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detail Modal */}
      <RowDetailPanel
        open={detailOpen}
        onOpenChange={setDetailOpen}
        payload={detailPayload}
        customization={concordanceCustomization}
      />

      {/* Loading State */}
      {isLoading.graph && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-gray-600 mt-2">Loading workspace...</p>
        </div>
      )}

      {/* Dispersion (per-document aggregated) detach column dialog */}
      <DetachColumnsDialog
        {...dispersionDetachDialog}
        title="Add aggregated concordance to workspace"
        description="The detached data block always includes the per-document extract, matched-text list, and L1/R1 contexts as list columns. Optionally include the document column and any source metadata columns. The document column is selected by default — uncheck to omit it."
      />

      {/* Detach column selection dialog */}
      <DetachColumnsDialog
        {...detachDialog}
        title="Detach Concordance Results"
        description="Select optional source columns to include alongside the concordance results. Required output columns stay checked automatically."
      />
    </div>
  );
}

export { ConcordanceFeature };
export default ConcordanceFeature;
