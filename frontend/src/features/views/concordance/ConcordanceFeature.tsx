import { useState, useEffect, useRef } from 'react';
import { useQueries } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  type ConcordanceAnalysisRequest,
  type ConcordanceAnalysisResponse,
  type ConcordanceRunAllResult,
  type ConcordanceDocumentPublicationSource,
  type ResultPublicationSource,
} from '@/api';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { CONTEXTUAL_HINT_IDS } from '@/features/guidance/registry';
import { useProgressiveContextualHints } from '@/features/guidance/useProgressiveContextualHints';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import AnalysisTaskBanner from '@/features/views/common/components/AnalysisTaskBanner';
import { useAnalysisFeature } from '../common/hooks/useAnalysisFeature';
import { useNodeColorControls } from '../common/hooks/useNodeColorControls';
import { ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import { nodeInputsFromSelections, useTabNodeInputs } from '../common/nodeInputs';
import { getAnalysisOutputResource, getAnalysisResultResource } from '../common/analysisApi';
import { getRerunActionState, hasNodeSelectionChanged } from '../common/rerunActionState';
import { getAnalysisActionLifecycle } from '../common/analysisActionLifecycle';
import { hasParameterDiff } from '../common/parameterComparison';
import { DEFAULT_TAB_INPUT_SET_ID } from '@/features/views/common/tabs/tabStateOps';
import type { AnalysisTabFeatureProps } from '@/features/views/common/tabs/AnalysisTabsHost';
import { useConcordanceTaskFlow } from './hooks/useConcordanceTaskFlow';
import { useConcordanceMetadataColumns } from './hooks/useConcordanceMetadataColumns';
import { useConcordanceViewModeSwap } from './hooks/useConcordanceViewModeSwap';
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
import { RowDetailPanel } from '../common/components/RowDetailPanel';
import { usePersistNodeDocumentColumn } from '../common/hooks/usePersistNodeDocumentColumn';
import { usePersistNodeTokenizerModel } from '../common/hooks/usePersistNodeTokenizerModel';
import { useConcordanceRowDetail } from './hooks/useConcordanceRowDetail';
import type { ConcordanceRunAllReviewSource } from './concordanceRunAllReview';
import { queryKeys } from '@/lib/queryKeys';
import { ResultPublicationDialog } from '../common/components/ResultPublicationDialog';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { CONCORDANCE_COMBINED_NODE_KEY } from './concordanceTableDomain';

/** Orchestrates the full Concordance Preview and Run All lifecycle. */
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
    latestPreview,
    latestRunAll,
    activeAnalysis,
    analyses,
    refreshAnalyses,
    inputSets: tabInputSets,
    setInputSet: onTabInputSetChange,
  } = host;
  const tabTaskId = latestPreview?.id ?? null;
  // Anchor ref for results container to stabilize scroll on view mode toggle
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const { isLoading } = useWorkspaceStatus();
  const { currentWorkspaceId } = useWorkspaceData();
  const {
    runConcordanceAll,
    publishAnalysisResult,
    setNodeColor: persistNodeColor,
  } = useWorkspaceActions();
  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
  });
  const persistTokenizerModel = usePersistNodeTokenizerModel({
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
    nodeInfoById,
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
  const concordanceRunAll =
    latestRunAll?.request.kind === 'concordance_run_all' ? latestRunAll : null;
  const concordanceRunAllChildren = concordanceRunAll
    ? analyses.filter(
        (analysis) =>
          analysis.execution_scope === 'supporting' &&
          analysis.parent_analysis_id === concordanceRunAll.id &&
          analysis.request.kind === 'concordance_run_all',
      )
    : [];
  const runAllSourceIds =
    concordanceRunAll?.request.kind === 'concordance_run_all'
      ? concordanceRunAll.request.source.node_ids
      : activeNodeIds;
  const runAllForSource = (nodeId: string | undefined) =>
    nodeId
      ? (concordanceRunAllChildren.find(
          (analysis) =>
            analysis.request.kind === 'concordance_run_all' &&
            analysis.request.source.node_ids[0] === nodeId,
        ) ?? null)
      : null;
  const firstConcordanceRunAll = runAllForSource(runAllSourceIds[0]);
  const secondConcordanceRunAll = runAllForSource(runAllSourceIds[1]);
  const concordanceRunAllEntries = [
    { sourceId: runAllSourceIds[0] ?? '', analysis: firstConcordanceRunAll },
    {
      sourceId: runAllSourceIds[1] ?? '',
      analysis: runAllSourceIds[1] ? secondConcordanceRunAll : null,
    },
  ];
  const runAllSourceAnalyses = concordanceRunAllEntries.flatMap(({ analysis }) =>
    analysis?.state === 'succeeded' ? [analysis] : [],
  );
  const runAllResultQueries = useQueries({
    queries: runAllSourceAnalyses.map((analysis) => ({
      queryKey: currentWorkspaceId
        ? queryKeys.analysisResult(currentWorkspaceId, analysis.id)
        : queryKeys.inactiveAnalysisResult({ analysisId: analysis.id }),
      enabled: Boolean(currentWorkspaceId) && concordanceRunAll?.state === 'succeeded',
      queryFn: async (): Promise<ConcordanceRunAllResult> => {
        if (!currentWorkspaceId) throw new Error('Run All Result is unavailable');
        const result = await getAnalysisOutputResource(currentWorkspaceId, analysis.id);
        if (result.kind !== 'concordance_run_all' || result.result_type !== 'source') {
          throw new Error('Concordance Run All child Result is invalid');
        }
        return result;
      },
    })),
  });
  const concordanceReviewSources: ConcordanceRunAllReviewSource[] =
    concordanceRunAll?.state === 'succeeded'
      ? runAllSourceAnalyses.flatMap((analysis, index) => {
          const result = runAllResultQueries[index]?.data;
          return result?.result_type === 'source' && result.source
            ? [{ analysisId: analysis.id, source: result.source }]
            : [];
        })
      : [];
  const runAllReviewError =
    concordanceRunAll?.state === 'succeeded'
      ? (runAllResultQueries.find((query) => query.error)?.error ??
        (concordanceRunAllChildren.length < runAllSourceIds.length
          ? new Error('Run All source Analyses are incomplete')
          : null))
      : null;
  const publicationSources = concordanceReviewSources.map((review) => review.source);
  const reviewNodes: WorkspaceNodeMetadata[] = concordanceReviewSources.map(({ source }) => ({
    id: source.node_id,
    name: source.node_name,
    color: source.color,
    document: source.document_column,
    shape: [source.document_count, null],
    tokenizerModel: null,
  }));
  const resultPanelNodes =
    concordanceRunAll?.state === 'succeeded' ? reviewNodes : panelSelectedNodes;
  const resultPanelColumnSelections =
    concordanceRunAll?.state === 'succeeded'
      ? concordanceReviewSources.map(({ source }) => ({
          nodeId: source.node_id,
          column: source.document_column,
        }))
      : nodeColumnSelections;
  const { nodeColorOverrides, setNodeColor, ensureNodeColors } = useNodeColorControls({
    nodeIds: activeNodeIds,
    nodes: panelSelectedNodes,
    persistNodeColor,
  });
  /** Replaces this tab's inputs from a node/column selection list (hydration + handoff). */
  const applyInputsFromSelections = (sels: { nodeId: string; column?: string | null }[]) => {
    onTabInputSetChange(DEFAULT_TAB_INPUT_SET_ID, nodeInputsFromSelections(sels));
  };
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
  const [isSubmittingRunAll, setIsSubmittingRunAll] = useState(false);
  const [publicationDialogOpen, setPublicationDialogOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  // Metadata visibility derives from the selected columns: any selection
  // shows the corresponding metadata columns in the results table.
  const showMetadata = selectedMetadataColumns.length > 0;
  const {
    concordanceView,
    setConcordanceView,
    showDispersion,
    proportionalDispersionBars,
    setProportionalDispersionBars,
    binCount,
    setBinCount,
    dispersionChartMode,
    setDispersionChartMode,
    selectedBinIndices,
    excludedMatchedTexts,
    toggleMatchedText,
    handleBinSelect,
    handleBinRangeSelect,
    handleClearBinSelection,
    resetDispersionFilters,
  } = useConcordanceDispersionControls();
  const [resultsViewportWidth, setResultsViewportWidth] = useState(0);
  const resultsViewportRef = useRef<HTMLDivElement | null>(null);
  const [viewMode, setViewMode] = useState<'separated' | 'combined'>('separated');
  const [combinedPage, setCombinedPage] = useState(1);

  // Concordance has two engines. ``regex`` walks raw text and remains the fresh
  // default, preserving ``equ\w*``-style affordances. ``tokens`` is an explicit
  // choice that walks the tokenization column prepared by the selected model.
  const {
    searchMode,
    tokensModeAvailable,
    effectiveTokenizerModelsByNode,
    setSearchModeFromUser,
    recordTokenizerModel,
    hydrateTokenizerState,
  } = useConcordanceTokenizerMode({
    effectiveNodeColumnSelections: nodeColumnSelections,
    nodeInfoById,
  });

  const {
    request: serverRequest,
    setLocalTaskId: setLocalConcordanceTaskId,
    isRunning: isSearching,
    setIsRunning: setIsSearching,
    runningRef,
    taskStatus: concordanceTaskStatus,
    banner: concordanceWaitingBanner,
    clearResults,
    stopTask,
    isStopping,
    analysisError,
    result: baseResult,
  } = useAnalysisFeature<ConcordanceAnalysisResponse, ConcordanceAnalysisRequest>({
    taskType: ANALYSIS_TASK_TYPES.concordance,
    workspaceId: currentWorkspaceId,
    tabId: host.tabId,
    // The forest's newest Preview Analysis wins hydration over transient
    // submission state.
    hydrationTaskId: tabTaskId,
    requestHydration:
      !latestPreview && concordanceRunAll?.request.kind === 'concordance_run_all'
        ? {
            analysisId: concordanceRunAll.id,
            request: concordanceRunAll.request.source,
          }
        : null,
    controlAnalysisId: activeAnalysis?.id ?? null,
    tabAnalysisIds: analyses.map((analysis) => analysis.id),
    retiredAnalysisIds: analyses.flatMap((analysis) =>
      analysis.state === 'succeeded' ? analysis.supersedes_analysis_ids : [],
    ),
    /** Fetches a completed concordance task result for polling and hydration. */
    fetchResult: async (taskId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisResultResource<ConcordanceAnalysisResponse>(currentWorkspaceId, taskId);
    },
    /** Restores concordance form controls from a saved request. */
    onRequest: (requestPayload) => {
      const reqObj = requestPayload as unknown as Record<string, unknown>;
      const hydratedSelections = concordanceParameters.applyHydratedRequest(reqObj);
      applyInputsFromSelections(hydratedSelections);
      const rawModels =
        reqObj.node_tokenizer_models && typeof reqObj.node_tokenizer_models === 'object'
          ? (reqObj.node_tokenizer_models as Record<string, unknown>)
          : {};
      hydrateTokenizerState(
        hydratedSelections.map((selection) => selection.nodeId),
        Object.fromEntries(
          Object.entries(rawModels).flatMap(([nodeId, model]) =>
            typeof model === 'string' ? [[nodeId, model]] : [],
          ),
        ),
        reqObj.search_mode === 'tokens' ? 'tokens' : 'regex',
      );
      // Combined view is a client-only synthesis and is never persisted, so
      // hydrated tasks always restore to separated; the user can re-enter
      // combined via the toggle (which re-pages both nodes on demand).
      setViewMode('separated');
    },
    onCleared: () => {
      setCombinedPage(1);
      // Refresh the cleared forest. Inputs remain intact so the user keeps the
      // curated selection after clearing.
      refreshAnalyses();
    },
  });
  const analysisActionLifecycle = getAnalysisActionLifecycle({
    isPreviewing: isSearching,
    isSubmittingRunAll,
    runAllState: concordanceRunAll?.state ?? null,
    hasActiveAnalysis: Boolean(activeAnalysis),
  });

  const {
    results,
    nodePagination,
    setNodePagination,
    nodeLoading,
    globalPageSize,
    applyGlobalPageSize,
    combinedLoading,
    labelToNodeId,
    defaultPalette,
    nodeColors,
    sourceColorMap,
    reviewDensityByNode,
    resolveNodeIdForKey,
    isReview,
    reviewError,
    handleReviewSort,
    handleReviewPageChange,
  } = useConcordanceResultSession({
    workspaceId: currentWorkspaceId,
    analysisId: tabTaskId,
    baseResult,
    viewMode,
    combinedPage,
    selectedNodes: resultPanelNodes,
    showDispersion,
    nodeColorOverrides,
    reviewSources: concordanceReviewSources,
    selectedBinIndices,
    excludedMatchedTexts,
    binCount,
  });

  useEffect(() => {
    setConcordanceView('table');
    resetDispersionFilters();
  }, [concordanceRunAll?.id, resetDispersionFilters, setConcordanceView]);

  useEffect(() => {
    const element = resultsViewportRef.current;
    if (!element) return;
    const updateWidth = () => {
      setResultsViewportWidth(element.clientWidth);
    };
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [results]);

  const { availableMetadataColumns, metadataColumnSections, metadataDisabledReason } =
    useConcordanceMetadataColumns({
      results,
      panelSelectedNodes: resultPanelNodes,
      effectiveNodeColumnSelections: resultPanelColumnSelections,
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

  const { handleSearch, handleSort, handlePageChange, persistResultPreferences } =
    useConcordanceTaskFlow({
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
        tokenizerModelsByNode: effectiveTokenizerModelsByNode,
        supersedesAnalysisIds: tabTaskId ? [tabTaskId] : [],
      },
      actions: {
        setNodePagination,
        setIsSearching,
        setLocalTaskId: setLocalConcordanceTaskId,
        runningRef,
        onSubmitted: refreshAnalyses,
      },
    });

  // Single source of truth for page size across every concordance result table.
  // Used by: each per-node / combined ServerPaginationFooter because changing
  // the size on any table must keep all tables in sync and persist once.
  // Flow: update globalPageSize, mirror it onto every node's internal pagination
  // (resetting to page 1), then persist unless the panel is read-only.
  const handleGlobalPageSizeChange = (newSize: number) => {
    applyGlobalPageSize(newSize);
    if (!isReview) persistResultPreferences({ pageSize: newSize });
  };

  // Run vs Re-run: with no locking, the primary button is gated purely by
  // whether the current params or node inputs differ from the last run.
  const lastRunRequest = serverRequest ?? null;
  const currentRequestParams = {
    ...currentConcordanceParams,
    search_mode: searchMode,
    node_tokenizer_models: Object.fromEntries(
      activeNodeIds.flatMap((nodeId) => {
        const model = (effectiveTokenizerModelsByNode[nodeId] ?? '').trim();
        return model ? [[nodeId, model]] : [];
      }),
    ),
  };
  const serverRequestParams = (request: Record<string, unknown>) => ({
    ...readConcordanceServerParams(request),
    search_mode: request.search_mode === 'tokens' ? 'tokens' : 'regex',
    node_tokenizer_models:
      request.node_tokenizer_models && typeof request.node_tokenizer_models === 'object'
        ? request.node_tokenizer_models
        : {},
  });
  const hasChanges = !lastRunRequest
    ? true
    : hasParameterDiff(currentRequestParams, serverRequestParams(lastRunRequest)) ||
      hasNodeSelectionChanged(
        nodeColumnSelections,
        lastRunRequest.node_ids,
        lastRunRequest.node_columns,
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
    isBusy: analysisActionLifecycle.isPreviewing,
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

  // No auto-column recompute: a node's default column is chosen at add-time by
  // the node-inputs model, so there is no unlocked recompute effect here.

  // Color assignment now handled by stack allocator - no auto-fill effect needed

  /**
   * Passed to the concordance node-input panel as its column-change handler.
   */
  const handleColumnChange = (nodeId: string, column: string) => {
    setNodeColumnSelection(nodeId, column);
    void persistDocumentColumn(nodeId, column);
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
    void persistTokenizerModel(nodeId, model);
  };

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
    await handleSearch();
  };

  const handleRunAll = async () => {
    const requestNodeIds = activeNodeIds.slice(0, 2);
    const nodeColumns = Object.fromEntries(
      nodeColumnSelections
        .filter((selection) => requestNodeIds.includes(selection.nodeId) && selection.column)
        .map((selection) => [selection.nodeId, selection.column]),
    );
    const nodeTokenizerModels = Object.fromEntries(
      requestNodeIds.flatMap((nodeId) => {
        const model = (effectiveTokenizerModelsByNode[nodeId] ?? '').trim();
        return model ? [[nodeId, model]] : [];
      }),
    );
    if (
      !currentWorkspaceId ||
      requestNodeIds.length === 0 ||
      Object.keys(nodeColumns).length !== requestNodeIds.length ||
      !searchWord.trim() ||
      (searchMode === 'tokens' &&
        Object.keys(nodeTokenizerModels).length !== requestNodeIds.length) ||
      analysisActionLifecycle.isRunningAll
    ) {
      return;
    }
    const source: ConcordanceAnalysisRequest = {
      node_ids: requestNodeIds,
      node_columns: nodeColumns,
      node_tokenizer_models: nodeTokenizerModels,
      search_word: searchWord.trim(),
      num_left_tokens: numLeftTokens,
      num_right_tokens: numRightTokens,
      regex,
      whole_word: wholeWord,
      case_sensitive: caseSensitive,
      search_mode: searchMode,
    };
    setIsSubmittingRunAll(true);
    try {
      await runConcordanceAll(host.tabId, { source }, tabTaskId ? [tabTaskId] : []);
      refreshAnalyses();
    } finally {
      setIsSubmittingRunAll(false);
    }
  };

  const handlePublishResult = async (sources: ResultPublicationSource[]) => {
    if (!concordanceRunAll) return;
    setIsPublishing(true);
    try {
      if (concordanceView === 'dispersion') {
        const documentSources: ConcordanceDocumentPublicationSource[] = sources.map((source) => {
          const descriptor = publicationSources.find(
            (candidate) => candidate.node_id === source.source_node_id,
          );
          const filterKey =
            viewMode === 'combined' ? CONCORDANCE_COMBINED_NODE_KEY : source.source_node_id;
          const selectedBins = Array.from(selectedBinIndices[filterKey] ?? []).sort(
            (left, right) => left - right,
          );
          return {
            source_node_id: source.source_node_id,
            new_node_name: source.new_node_name,
            selected_metadata_columns: source.selected_columns.filter((column) =>
              descriptor?.metadata_columns.includes(column),
            ),
            excluded_matched_texts: Array.from(excludedMatchedTexts[filterKey] ?? []).sort(),
            bin_count: selectedBins.length > 0 ? binCount : null,
            selected_bins: selectedBins.length > 0 ? selectedBins : null,
          };
        });
        await publishAnalysisResult(host.tabId, concordanceRunAll.id, {
          kind: 'concordance_document_publication',
          sources: documentSources,
        });
      } else {
        await publishAnalysisResult(host.tabId, concordanceRunAll.id, {
          kind: 'concordance_match_publication',
          sources,
        });
      }
      setPublicationDialogOpen(false);
      toast.success('Adding Concordance Results to the Workspace.');
    } catch (cause) {
      toast.error('Could not add Concordance Results.', {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const { handleViewModeChange } = useConcordanceViewModeSwap({
    viewMode,
    setViewMode,
    results,
    combinedLoading,
    resultsRef,
  });

  useProgressiveContextualHints([
    CONTEXTUAL_HINT_IDS.concordance.inputs,
    ...(panelSelectedNodes.length > 0 && nodeColumnSelections.every((selection) => selection.column)
      ? [CONTEXTUAL_HINT_IDS.concordance.search]
      : []),
    ...(results && !isReview ? [CONTEXTUAL_HINT_IDS.concordance.previewResults] : []),
    ...(results && isReview ? [CONTEXTUAL_HINT_IDS.concordance.runAllResults] : []),
    ...(isReview && publicationSources.length > 0 ? [CONTEXTUAL_HINT_IDS.concordance.publish] : []),
  ]);

  return (
    <div className="space-y-4">
      <ConcordanceParameterPanel
        nodeInputs={nodeInputs}
        handleColumnChange={handleColumnChange}
        nodeColors={nodeColors}
        onNodeColorChange={(nodeId, color) => {
          setNodeColor(nodeId, color);
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
            disabled={searchMode !== 'tokens'}
            disabledReason="Tokenizer models apply only in Tokens mode."
            onChange={(model, detectedLanguage) => {
              handleTokenizerModelChange(nodeId, column, model, detectedLanguage);
            }}
          />
        )}
        isSearching={analysisActionLifecycle.isPreviewing}
        actionState={{
          ...actionState,
          clearDisabled:
            analyses.length === 0 ||
            analysisActionLifecycle.isPreviewing ||
            analysisActionLifecycle.isRunningAll ||
            Boolean(activeAnalysis),
        }}
        handleRunOrUpdate={handleRunOrUpdate}
        handleRunAll={handleRunAll}
        runAllDisabled={
          analysisActionLifecycle.runAllDisabled ||
          panelSelectedNodes.length === 0 ||
          !searchWord.trim() ||
          nodeColumnSelections.some((selection) => !selection.column)
        }
        isRunningAll={analysisActionLifecycle.isRunningAll}
        parametersLocked={analysisActionLifecycle.parametersLocked}
        handleStopTask={activeAnalysis ? stopTask : undefined}
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
      {concordanceRunAllEntries.map(({ sourceId, analysis }) =>
        analysis && (analysis.state === 'queued' || analysis.state === 'running') ? (
          <AnalysisTaskBanner
            key={analysis.id}
            analysisName={`Concordance Run All${sourceId ? ` — ${sourceId}` : ''}`}
            status={analysis.state}
            taskId={analysis.id}
            message={analysis.progress.message ?? undefined}
            className="mt-4"
          />
        ) : null,
      )}
      {runAllReviewError ? (
        <p className="mt-4 text-sm text-destructive">
          Could not load Review: {runAllReviewError.message}
        </p>
      ) : null}
      {reviewError ? (
        <p className="mt-4 text-sm text-destructive">
          Could not load Review: {reviewError.message}
        </p>
      ) : null}

      {/* Results */}
      {results ? (
        <ConcordanceResultsPanel
          title={isReview ? 'Review' : 'Search Results'}
          guidanceTarget={isReview ? 'concordance-run-all-results' : 'concordance-preview-results'}
          isReview={isReview}
          headerAction={
            isReview && publicationSources.length > 0 ? (
              <Button
                data-guidance="concordance-publish"
                type="button"
                onClick={() => {
                  setPublicationDialogOpen(true);
                }}
              >
                Add to Workspace
              </Button>
            ) : null
          }
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
            dispersionChartMode,
            setDispersionChartMode,
            selectedBinIndices,
            excludedMatchedTexts,
            onToggleMatchedText: (blockKey, matchedText) => {
              if (blockKey === CONCORDANCE_COMBINED_NODE_KEY) setCombinedPage(1);
              toggleMatchedText(blockKey, matchedText);
            },
            onBinSelect: (blockKey, index, shiftHeld) => {
              if (blockKey === CONCORDANCE_COMBINED_NODE_KEY) setCombinedPage(1);
              handleBinSelect(blockKey, index, shiftHeld);
            },
            onBinRangeSelect: (blockKey, startIndex, endIndex, shiftHeld) => {
              if (blockKey === CONCORDANCE_COMBINED_NODE_KEY) setCombinedPage(1);
              handleBinRangeSelect(blockKey, startIndex, endIndex, shiftHeld);
            },
            onClearBinSelection: (blockKey) => {
              if (blockKey === CONCORDANCE_COMBINED_NODE_KEY) setCombinedPage(1);
              handleClearBinSelection(blockKey);
            },
            binCount,
            setBinCount: (value) => {
              setCombinedPage(1);
              setBinCount(value);
            },
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
            panelSelectedNodes: resultPanelNodes,
            effectiveNodeColumnSelections: resultPanelColumnSelections,
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
            reviewDensityByNode,
          }}
          commands={{
            handleSort: isReview
              ? (columnKey, paginationKey) => {
                  handleReviewSort(columnKey, paginationKey);
                }
              : handleSort,
            handlePageChange: isReview
              ? (newPage, paginationKey) => {
                  handleReviewPageChange(newPage, paginationKey);
                }
              : handlePageChange,
            handleRowClick,
          }}
        />
      ) : null}

      {analysisError && (
        <Card>
          <CardContent>
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {analysisError}
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
      {publicationDialogOpen ? (
        <ResultPublicationDialog
          open
          onOpenChange={setPublicationDialogOpen}
          title={`Add Concordance ${concordanceView === 'dispersion' ? 'Documents' : 'Matches'} to Workspace`}
          nameSuffix={concordanceView === 'dispersion' ? 'concordance_documents' : 'concordance'}
          sources={publicationSources}
          isSubmitting={isPublishing}
          mode={concordanceView === 'dispersion' ? 'document' : 'match'}
          allowSourceSelection
          onSubmit={(sources) => {
            void handlePublishResult(sources);
          }}
        />
      ) : null}

      {/* Loading State */}
      {isLoading.graph && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-gray-600 mt-2">Loading workspace...</p>
        </div>
      )}
    </div>
  );
}

export { ConcordanceFeature };
export default ConcordanceFeature;
