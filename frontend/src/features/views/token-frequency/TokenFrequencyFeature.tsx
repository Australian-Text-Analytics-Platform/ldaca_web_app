import { useCallback, useMemo, useState } from 'react';
import type { TokenFrequencyResponse } from '@/api';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';

import { useAnalysisFeature } from '../common/hooks/useAnalysisFeature';
import { useLastRunRequest } from '../common/hooks/useLastRunRequest';
import { useNodeColorControls } from '../common/hooks/useNodeColorControls';
import { useSafeResult } from '../common/useSafeResult';
import { DEFAULT_TOKEN_LIMIT, parseAnalysisNodeRequest } from '../common/utils';
import { ANALYSIS_TAB_GROUPS, ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import { getAnalysisTaskRequest, getAnalysisTaskResult } from '../common/analysisTasksApi';
import { useTabNodeInputs } from '../common/nodeInputs';
import { getRerunActionState, hasNodeSelectionChanged } from '../common/rerunActionState';
import { hasParameterDiff } from '../common/parameterComparison';
import { deriveTokenizerModelsByNode } from '../common/tokenizerModelPreferences';
import {
  buildNodeIdDisplayNameMap,
  buildSelectionNameById,
  derivePanelNodeIds,
  deriveBackendStopWordsKey,
  deriveBackendTokenLimit,
  deriveStudyNodeOrder,
  type NodeNameEntry,
} from './tokenFrequencyUtils';
import { TokenFrequencyDownloadDialog } from './components/TokenFrequencyDownloadDialog';
import FillDefaultStopWordsDialog from './components/FillDefaultStopWordsDialog';
import { useTokenFrequencyPreferences } from './hooks/useTokenFrequencyPreferences';
import { useTokenFrequencyResultModel } from './hooks/useTokenFrequencyResultModel';
import { useTokenFrequencyTaskFlow } from './hooks/useTokenFrequencyTaskFlow';
import { pruneTasksById } from '@/features/views/common/analysisTaskUtils';
import { TokenFrequencyParameterPanel } from './components/panels/TokenFrequencyParameterPanel';
import { TokenFrequencyResultsPanel } from './components/panels/TokenFrequencyResultsPanel';
import TokenizerModelSelector from '../common/components/TokenizerModelSelector';
import { useAnalysisStore } from '@/stores/analysisStore';
import { useUIStore } from '@/stores/uiStore';
import {
  usePersistNodeDocumentColumn,
  usePersistNodeTokenizationPreference,
} from '@/features/views/common/hooks/usePersistNodeDocumentColumn';
import type { AnalysisTabFeatureProps } from '@/features/views/common/tabs/AnalysisTabsHost';

const MAX_TOKEN_LIMIT_INPUT = 100;
const UNIFIED_WORDCLOUD_WIDTH = 640;
const UNIFIED_WORDCLOUD_HEIGHT = 340;

/** Coordinates token-frequency selection, execution, and export wiring for the analysis tab. */
/**
 * Rendered by: the viewComponents tabbed loader, which mounts one instance per analysis tab and feeds it tab props.
 * Flow: read workspace state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 *
 * The required host supplies normalized task/input state and closure-bound
 * persistence commands for the active tab; this feature has no standalone or
 * optional-tab compatibility path.
 */
const TokenFrequencyFeature = ({ host }: AnalysisTabFeatureProps) => {
  const {
    taskId: tabTaskId,
    setTaskId: onTabTaskChange,
    inputSets: tabInputSets,
    setInputSet: onTabInputSetChange,
  } = host;
  const [liveTokenizerModelsByNode, setLiveTokenizerModelsByNode] = useState<
    Record<string, string>
  >({});
  // Controls the "Add Default" stop-words dialog where the user confirms which
  // language's defaults to append (guessed on the fly, not stored per column).
  const [fillDialogOpen, setFillDialogOpen] = useState(false);
  const { currentWorkspace } = useWorkspaceData();
  const currentWorkspaceId = currentWorkspace?.id ?? null;
  const nodeInputs = useTabNodeInputs({
    tabInputSets,
    onTabInputSetChange,
    constraints: {
      allowedDataTypes: ['string'],
      docTypeOnly: true,
      maxNodes: 2,
    },
  });
  const nodeColumnSelections = nodeInputs.nodeColumnSelections;
  const setNodeColumnSelection = nodeInputs.setColumn;
  const panelSelectedNodes = nodeInputs.selectedNodes;
  const { replaceSelectedNodes, setNodeColor: persistNodeColor } = useWorkspaceActions();
  const currentView = useUIStore((state) => state.currentView);
  const setCurrentView = useUIStore((state) => state.setCurrentView);
  const setPendingConcordance = useAnalysisStore((state) => state.setPendingConcordance);
  const setTasks = useAnalysisStore((state) => state.setTasks);

  const [liveResults, resultRef, setResultSafely] = useSafeResult<TokenFrequencyResponse>();
  const [liveLastCompareNodeIds, setLastCompareNodeIds] = useState<string[]>([]);
  const [liveStudyNodeId, setStudyNodeId] = useState<string | null>(null);

  const results = liveResults;
  const lastCompareNodeIds = liveLastCompareNodeIds;
  const studyNodeId = liveStudyNodeId;

  const panelNodeIds = derivePanelNodeIds(panelSelectedNodes);
  const { effectiveStudyNodeId, orderedPanelNodeIds } = deriveStudyNodeOrder(
    panelNodeIds,
    studyNodeId,
  );

  // Per-source chart colours come from persisted node metadata, with palette
  // defaults written before a run when a selected node has no colour yet.
  const tokenActiveNodeIds = panelNodeIds.slice(0, 2);
  const { defaultPalette, nodeColors, setNodeColor, ensureNodeColors } = useNodeColorControls({
    nodeIds: tokenActiveNodeIds,
    nodes: panelSelectedNodes,
    persistNodeColor,
  });

  const isActiveTab = currentView === 'token-frequency';
  const { serverRequest } = useLastRunRequest({
    analysisType: ANALYSIS_TAB_GROUPS.tokenFrequencies,
    workspaceId: currentWorkspaceId,
    taskId: tabTaskId,
  });

  const {
    resolveTaskId,
    isRunning,
    isStopping,
    setIsRunning,
    runningRef,
    taskStatus,
    lastFetchedRef,
    clearResults,
    stopTask,
    setLocalTaskId,
  } = useAnalysisFeature<TokenFrequencyResponse>({
    analysisType: ANALYSIS_TAB_GROUPS.tokenFrequencies,
    taskType: ANALYSIS_TASK_TYPES.tokenFrequencies,
    workspaceId: currentWorkspaceId,
    isTabActive: isActiveTab,
    // Tab-driven deterministic hydration: the tab's persisted task id wins task
    // resolution over transient local state.
    hydrationTaskId: tabTaskId,
    resultRef,
    /** Fetches the latest task result so polling and hydration share one retrieval path. */
    fetchResult: async (taskId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisTaskResult<TokenFrequencyResponse>(currentWorkspaceId, taskId);
    },
    /** Fetches the saved task request so a reopened task can restore panel state. */
    fetchRequest: async (taskId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisTaskRequest(
        ANALYSIS_TAB_GROUPS.tokenFrequencies,
        currentWorkspaceId,
        taskId,
      );
    },
    /** Pushes fetched task results into guarded component state. */
    onResultFetched: (result) => {
      // Restore the compared node ids from the authoritative result, not just
      // the raw result blob. onResultFetched and onHydratedResult race on a
      // fresh tab mount (both share the hook's fetch-dedup refs); whichever
      // wins marks the task fetched and short-circuits the other. If the
      // task-flow refresh path won and we only set results here, the unified
      // word cloud + comparative statistics table would vanish on tab return
      // because they gate on lastCompareNodeIds.length === 2. Re-deriving the
      // ids from result.analysis_params keeps that gate satisfied regardless
      // of which path applies the result. During a live run these ids match
      // what the submit handler already set, so this is a no-op overwrite.
      const requestData = result.analysis_params ?? {};
      const { nodeIds } = parseAnalysisNodeRequest(requestData, 2);
      if (nodeIds.length > 0) {
        setLastCompareNodeIds(nodeIds);
        setStudyNodeId(nodeIds[1] ?? null);
      }
      setResultSafely(result);
    },
    /**
     * Rehydrates controls from a persisted result when the feature reconnects
     * to a task. Flow: restore compared/study nodes, token limit, guarded
     * results, and the normalized stop-word editor/filter state.
     */
    onHydratedResult: (result) => {
      if (!result) return;
      const requestData = result.analysis_params ?? {};
      const { nodeIds } = parseAnalysisNodeRequest(requestData, 2);
      setLastCompareNodeIds(nodeIds);
      setStudyNodeId(nodeIds[1] ?? null);
      applyTokenLimitState(
        typeof requestData.token_limit === 'number' ? requestData.token_limit : null,
      );
      setResultSafely(result);
      if (Array.isArray(result.stop_words)) {
        const normalizedStops = result.stop_words
          .map((word) => word.trim().toLowerCase())
          .filter(Boolean);
        setAppliedStopSet(new Set(normalizedStops));
        setStopWords(normalizedStops.join(', '));
      }
    },
    /**
     * Rehydrates node selections from a persisted request payload after task
     * recovery. Flow: unwrap the saved request, cap its node ids to the
     * two-input contract, and restore the study-node role.
     */
    onHydratedRequest: (requestPayload) => {
      const raw = requestPayload as Record<string, unknown> | null;
      const req = raw?.data ?? raw;
      if (!req || typeof req !== 'object') return;
      const reqObj = req as Record<string, unknown>;
      const nodeIds: string[] = Array.isArray(reqObj.node_ids)
        ? (reqObj.node_ids as string[]).slice(0, 2)
        : [];
      setStudyNodeId(nodeIds[1] ?? null);
    },
    /** Clears local result and selection state when the feature reset action runs. */
    onCleared: (_, options) => {
      setResultSafely(null);
      if (options?.preserveLocalState) {
        return;
      }
      // Detach the cleared task from the owning tab so a reload doesn't rehydrate
      // a task the user explicitly cleared. Inputs are intentionally preserved.
      onTabTaskChange(null);
      setLastCompareNodeIds([]);
      setStudyNodeId(null);
      resetPreferenceUiState();
    },
    /** Removes token-frequency tasks from the shared analysis store after local cleanup. */
    pruneGlobalTasks: (taskIds) => {
      setTasks((prev) => (Array.isArray(prev) ? pruneTasksById(prev, taskIds) : prev));
    },
  });

  const effectiveNodeColumnSelections = nodeColumnSelections;

  const effectiveTokenizerModelsByNode = useMemo(() => {
    // Seed with models persisted to the backend from previous sessions,
    // then apply any live overrides the user has made in this session.
    return deriveTokenizerModelsByNode(
      effectiveNodeColumnSelections,
      nodeInputs.nodeInfoCache,
      liveTokenizerModelsByNode,
    );
  }, [effectiveNodeColumnSelections, nodeInputs.nodeInfoCache, liveTokenizerModelsByNode]);

  // useCallback so the section components below stay React.memo-stable
  // across stopword-keystroke re-renders of this feature. Without it,
  // every render hands a fresh function ref to the sections, busting
  // memoisation and re-running d3-cloud layout per keystroke.
  const getColorForNode = useCallback(
    (nodeId: string, index = 0) => {
      return nodeColors[nodeId] ?? defaultPalette[index % defaultPalette.length] ?? '#000000';
    },
    [nodeColors, defaultPalette],
  );

  const backendTokenLimit = deriveBackendTokenLimit(results);
  const backendStopWordsKey = deriveBackendStopWordsKey(results);
  // Primary node/column the "Add Default" dialog samples to guess a language.
  // Language is not stored per column (a column may mix languages), so the guess
  // is derived on demand from the first selected text column and the user
  // confirms or overrides it in the dialog.
  const fillDefaultSelection = effectiveNodeColumnSelections.find((selection) => selection.column);
  const fillDefaultTarget = {
    nodeId: fillDefaultSelection?.nodeId ?? null,
    column: fillDefaultSelection?.column ?? null,
  };

  const {
    stopWords,
    setStopWords,
    isLoadingStopWords,
    appliedStopSet,
    setAppliedStopSet,
    tokenLimitInput,
    tokenLimitError,
    isApplyingTokenLimit,
    effectiveTokenLimit,
    applyTokenLimitState,
    applyStopSetFromText,
    sortStopWords,
    handleTokenLimitInputChange,
    handleTokenLimitBlur,
    applyTokenLimit,
    handleAddDefaultStopWords,
    resetPreferenceUiState,
  } = useTokenFrequencyPreferences({
    currentWorkspaceId,
    results,
    setResults: setResultSafely,
    resolveTokenFrequencyTaskId: resolveTaskId,
    backendTokenLimit,
    backendStopWordsKey,
    maxTokenLimitInput: MAX_TOKEN_LIMIT_INPUT,
  });

  const lockedNodeNameMap = useMemo(
    () =>
      buildSelectionNameById(
        panelSelectedNodes as NodeNameEntry[],
        panelSelectedNodes as NodeNameEntry[],
      ),
    [panelSelectedNodes],
  );

  const nodeIdToName = useMemo(
    () => buildNodeIdDisplayNameMap(panelSelectedNodes),
    [panelSelectedNodes],
  );

  const { handleAnalyze, handleTokenClick, handleTokenRightClick } = useTokenFrequencyTaskFlow({
    state: {
      currentWorkspaceId,
      panelNodeIds: orderedPanelNodeIds,
      panelSelectedNodes,
      effectiveNodeColumnSelections,
      tokenizerModelsByNode: effectiveTokenizerModelsByNode,
      stopWords,
      results,
      lockedNodeNameMap,
      nodeIdToName,
      lastCompareNodeIds,
    },
    actions: {
      setLocalTaskId,
      setIsRunning,
      runningRef,
      setResultsSafely: setResultSafely,
      setLastCompareNodeIds,
      setAppliedStopSet,
      setStopWords,
      lastFetchedRef,
      // Persist the run's assigned task id onto the active tab so reload
      // rehydrates the same task.
      onTaskIdAssigned: (taskId) => {
        onTabTaskChange(taskId);
      },
    },
    navigation: {
      replaceSelectedNodes,
      setPendingConcordance,
      setCurrentView,
      applyStopSetFromText,
    },
  });

  const handleAnalyzeWithNodeColors = async () => {
    await ensureNodeColors();
    await handleAnalyze();
  };

  const {
    computeDisplayName,
    normalizedNodeResults,
    nodeDisplayResults,
    downloadDialogOpen,
    setDownloadDialogOpen,
    downloadDialogMode,
    unifiedCloudContainerRef,
    registerWordCloudRef,
    openWordCloudDownload,
    openFrequencyDownload,
    confirmDownload,
  } = useTokenFrequencyResultModel({
    results,
    lastCompareNodeIds,
    nodeColumnSelections: effectiveNodeColumnSelections,
    lockedNodeNameMap,
    nodeIdToName,
    appliedStopSet,
    effectiveTokenLimit,
    stopWords,
  });

  /** Passed to TokenFrequencyResultsPanel to apply its stop-word editor text. */
  const handleApplyStopWords = () => {
    applyStopSetFromText(stopWords);
  };

  const hasIncompleteSelections = effectiveNodeColumnSelections.some(
    (selection) => !selection.column,
  );
  const selectedNodeIdsWithColumns = orderedPanelNodeIds.filter((nodeId) =>
    effectiveNodeColumnSelections.some(
      (selection) => selection.nodeId === nodeId && selection.column,
    ),
  );
  const missingTokenizerModelNodeIds = selectedNodeIdsWithColumns.filter(
    (nodeId) => !(effectiveTokenizerModelsByNode[nodeId] ?? '').trim(),
  );

  const lastRunRequest = serverRequest ?? null;
  const currentTokenFrequencyParams = {};
  const serverTokenFrequencyParams = (_request: Record<string, unknown>) => ({});
  const hasLastRun = Boolean(lastRunRequest);
  const hasChanges = !lastRunRequest
    ? true
    : hasParameterDiff(currentTokenFrequencyParams, serverTokenFrequencyParams(lastRunRequest)) ||
      hasNodeSelectionChanged(
        nodeColumnSelections,
        lastRunRequest.node_ids as string[] | undefined,
        lastRunRequest.node_columns as Record<string, string> | undefined,
      );
  const baseActionState = getRerunActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    isRunnable: panelSelectedNodes.length > 0 && !hasIncompleteSelections,
    hasLastRun,
    hasChanges,
    isBusy: isRunning,
    hasResults: Boolean(results),
  });
  const hasTokenizerModel = missingTokenizerModelNodeIds.length === 0;
  const actionState = {
    ...baseActionState,
    runDisabled: baseActionState.runDisabled || !hasTokenizerModel,
    runDisabledReason: !hasTokenizerModel
      ? 'Select a tokenizer model for each data block'
      : baseActionState.runDisabledReason,
  };

  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
  });
  const persistTokenizerPreference = usePersistNodeTokenizationPreference({
    workspaceId: currentWorkspaceId,
  });

  /** Passed to TokenFrequencyParameterPanel to update and persist a node's document column. */
  const handleColumnChange = (nodeId: string, column: string) => {
    setNodeColumnSelection(nodeId, column);
    void persistDocumentColumn(nodeId, column);
  };

  /**
   * Passed to each parameter-panel tokenizer selector to update its live model
   * and persist the model together with the detected language.
   */
  const handleTokenizerModelChange = (
    nodeId: string,
    column: string,
    model: string,
    language: string | null,
  ) => {
    setLiveTokenizerModelsByNode((prev) => {
      if (model) return { ...prev, [nodeId]: model };
      const { [nodeId]: _removed, ...rest } = prev;
      return rest;
    });
    void persistTokenizerPreference(nodeId, column, model, language);
  };

  return (
    <div className="space-y-4">
      <TokenFrequencyParameterPanel
        nodeInputs={nodeInputs}
        onColumnChange={handleColumnChange}
        actionState={actionState}
        isAnalyzing={isRunning}
        isStopping={isStopping}
        onAnalyze={() => {
          void handleAnalyzeWithNodeColors();
        }}
        onStop={() => {
          void stopTask();
        }}
        onClearResults={() => {
          void clearResults();
        }}
        hasIncompleteSelections={hasIncompleteSelections}
        hasResults={Boolean(results)}
        runLabel={actionState.runLabel}
        studyNodeId={effectiveStudyNodeId}
        onStudyNodeChange={(nodeId: string) => {
          setStudyNodeId(nodeId);
        }}
        nodeColors={nodeColors}
        onNodeColorChange={(nodeId, color) => {
          void setNodeColor(nodeId, color);
        }}
        computeDisplayName={computeDisplayName}
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
      />

      <TokenFrequencyResultsPanel
        results={results}
        isRunning={isRunning || Boolean(taskStatus.runningTask)}
        runningTask={taskStatus.runningTask}
        stopWords={stopWords}
        onStopWordsChange={setStopWords}
        onStopWordsApply={handleApplyStopWords}
        isLoadingStopWords={isLoadingStopWords}
        onFillDefaultStopWords={() => {
          setFillDialogOpen(true);
        }}
        onSortStopWords={sortStopWords}
        tokenLimitInput={tokenLimitInput}
        onTokenLimitInputChange={handleTokenLimitInputChange}
        onTokenLimitBlur={handleTokenLimitBlur}
        applyCloudTokenLimit={applyTokenLimit}
        tokenLimitError={tokenLimitError}
        isApplyingTokenLimit={isApplyingTokenLimit}
        appliedStopCount={appliedStopSet.size}
        normalizedNodeResults={normalizedNodeResults}
        nodeDisplayResults={nodeDisplayResults}
        lastCompareNodeIds={lastCompareNodeIds}
        appliedStopSet={appliedStopSet}
        effectiveTokenLimit={effectiveTokenLimit}
        defaultTokenLimit={DEFAULT_TOKEN_LIMIT}
        computeDisplayName={computeDisplayName}
        getColorForNode={getColorForNode}
        onDownloadWordCloud={openWordCloudDownload}
        onTokenClick={handleTokenClick}
        onTokenRightClick={handleTokenRightClick}
        unifiedCloudWidth={UNIFIED_WORDCLOUD_WIDTH}
        unifiedCloudHeight={UNIFIED_WORDCLOUD_HEIGHT}
        unifiedCloudContainerRef={unifiedCloudContainerRef}
        registerWordCloudRef={registerWordCloudRef}
        onDownloadFrequencyCsv={openFrequencyDownload}
      />

      <TokenFrequencyDownloadDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        mode={downloadDialogMode}
        onConfirm={(options) => {
          void confirmDownload(options);
        }}
      />

      <FillDefaultStopWordsDialog
        key={fillDialogOpen ? 'fill-dialog-open' : 'fill-dialog-closed'}
        open={fillDialogOpen}
        onOpenChange={setFillDialogOpen}
        workspaceId={currentWorkspaceId}
        nodeId={fillDefaultTarget.nodeId}
        column={fillDefaultTarget.column}
        isLoading={isLoadingStopWords}
        onFill={handleAddDefaultStopWords}
      />
    </div>
  );
};

export default TokenFrequencyFeature;
