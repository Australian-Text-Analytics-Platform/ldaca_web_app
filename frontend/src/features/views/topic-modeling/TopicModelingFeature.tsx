import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import type { AnalysisTabInput, TopicModelingResponse, TopicModelingTopic } from '@/api';
import { useAnalysisStore, type TaskItem } from '@/stores/analysisStore';
import { useUIStore } from '@/stores';
import { pruneTasksById } from '@/features/views/common/analysisTaskUtils';
import {
  getNodeIdentifier,
  useLastRunRequest,
  useAnalysisFeature,
  useNodeColorControls,
  useSafeResult,
  executeAnalysisRerun,
} from '../common';
import { ANALYSIS_TAB_GROUPS, ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import { useTabNodeInputs } from '../common/nodeInputs';
import { getRerunActionState, hasNodeSelectionChanged } from '../common/rerunActionState';
import { hasParameterDiff } from '../common/parameterComparison';
import { getAnalysisTaskRequest, getAnalysisTaskResult } from '../common/analysisTasksApi';
import { TopicModelingParameterPanel } from './components/panels/TopicModelingParameterPanel';
import { TopicModelingResultsPanel } from './components/panels/TopicModelingResultsPanel';
import { useTopicModelingTaskFlow } from './hooks/useTopicModelingTaskFlow';
import { useTopicModelingZoomBrush } from './hooks/useTopicModelingZoomBrush';
import { useTopicModelingBubbleChart } from './hooks/useTopicModelingBubbleChart';
import {
  DEFAULT_TOPIC_SIZE_VALUE,
  normalizeTopicSampleFractions,
  useTopicModelingParameters,
} from './hooks/useTopicModelingParameters';
import { usePersistNodeDocumentColumn } from '../common/hooks/usePersistNodeDocumentColumn';
import { useTopicModelingResultControls } from './hooks/useTopicModelingResultControls';
import type { AnalysisTabInputSets } from '@/features/views/common/tabs/tabStateOps';

/** Renders the topic-modeling workflow for live BERTopic runs and result exploration. */
/**
 * Rendered by: the viewComponents tabbed loader, which mounts one instance per analysis tab and feeds it tab props.
 * Flow: read workspace/tab state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 *
 * Tab props: ``tabId`` identifies the active tab, ``tabTaskId`` seeds
 * deterministic hydration of that tab's task, ``onTabTaskChange`` reports task
 * id assignment/clear back to the tab record, and ``onTabInputSetChange`` owns
 * node-input persistence for add/remove/column actions.
 */
interface TopicModelingFeatureProps {
  tabId?: string;
  tabTaskId?: string | null;
  onTabTaskChange?: (taskId: string | null) => void;
  tabInputSets?: AnalysisTabInputSets;
  onTabInputSetChange: (selectorId: string, inputs: AnalysisTabInput[]) => void;
}

function TopicModelingFeature({
  tabId,
  tabTaskId,
  onTabTaskChange,
  tabInputSets,
  onTabInputSetChange,
}: TopicModelingFeatureProps) {
  const { currentWorkspaceId } = useWorkspaceData();
  const { setNodeColor: persistNodeColor } = useWorkspaceActions();
  const queryClient = useQueryClient();
  const nodeInputs = useTabNodeInputs({
    tabInputSets,
    onTabInputSetChange,
    constraints: {
      allowedDataTypes: ['string'],
      maxNodes: 2,
      docTypeOnly: true,
    },
  });
  const nodeColumnSelections = nodeInputs.nodeColumnSelections;
  const setNodeColumnSelection = nodeInputs.setColumn;
  const panelSelectedNodes = nodeInputs.selectedNodes;
  const panelNodeIds = panelSelectedNodes
    .slice(0, 2)
    .map((node) => getNodeIdentifier(node))
    .filter((id): id is string => Boolean(id));
  const panelNodeIdsKey = panelNodeIds.join('|');
  const { serverRequest } = useLastRunRequest({
    analysisType: ANALYSIS_TAB_GROUPS.topicModeling,
    workspaceId: currentWorkspaceId,
    taskId: tabTaskId ?? null,
  });
  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
  });

  const typedServerRequest = serverRequest as {
    node_ids?: string[];
    node_columns?: Record<string, string>;
    min_topic_size?: number;
    random_seed?: number;
    representative_words_count?: number;
    sample_fractions?: (number | null)[];
  } | null;
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'topic-modeling';
  const setTasks = useAnalysisStore((state) => state.setTasks);
  const [error, setError] = useState<string | null>(null);
  const [liveResult, resultRef, setResultSafely] = useSafeResult<TopicModelingResponse>();

  const result: TopicModelingResponse | null = liveResult;

  const {
    corpusSamples,
    updateCorpusSample,
    topicSizeValue,
    topicSizeUserSet,
    setTopicSizeValueFromUser,
    randomSeed,
    randomSeedUserSet,
    setRandomSeedFromUser,
    representativeWordsCount,
    representativeWordsCountUserSet,
    setRepresentativeWordsCountFromUser,
    nodeDocCounts,
    topicSizeWarning,
    showSamplingWarning,
    sampleFractionsForRequest,
    hasAnySampling,
    hydrateParameters,
    resetAfterClear,
  } = useTopicModelingParameters({
    panelSelectedNodes,
    panelNodeIds,
    panelNodeIdsKey,
    nodeInfoCache: nodeInputs.nodeInfoCache,
  });
  const {
    hoveredTopicId,
    setHoveredTopicId,
    tooltip,
    setTooltip,
    selectedTopicIds,
    topicSearchQuery,
    setTopicSearchQuery,
    handleToggleTopicSelection,
    handleClearTopicSelection,
  } = useTopicModelingResultControls();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState<number>(800);
  const chartResizeFrameRef = useRef<number | null>(null);
  const [isClearing, setIsClearing] = useState(false);

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
    banner: topicWaitingBanner,
  } = useAnalysisFeature<TopicModelingResponse>({
    analysisType: ANALYSIS_TAB_GROUPS.topicModeling,
    taskType: ANALYSIS_TASK_TYPES.topicModeling,
    workspaceId: currentWorkspaceId,
    isTabActive: isActiveTab,
    // Tab-driven deterministic hydration: the tab's persisted task id wins task
    // resolution over transient local state.
    hydrationTaskId: tabTaskId ?? null,
    resultRef,
    // Loads the latest topic-modeling result for polling and task resumption.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config.
    fetchResult: async (taskId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisTaskResult<TopicModelingResponse>(currentWorkspaceId, taskId);
    },
    // Retrieves the submitted request so hydration can restore parameter and lock state.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config.
    fetchRequest: async (taskId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisTaskRequest(
        ANALYSIS_TAB_GROUPS.topicModeling,
        currentWorkspaceId,
        taskId,
      );
    },
    // Applies freshly fetched task results and surfaces failed/successful status messages.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config.
    onResultFetched: (resultData) => {
      setResultSafely(resultData);
      if (resultData.state === 'failed') {
        setError(resultData.message || 'Topic modeling failed');
      } else if (resultData.state === 'successful') {
        setError(null);
      }
    },
    // Rebuilds live result state from a hydrated task payload after reload.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config.
    onHydratedResult: (resultData) => {
      if (!resultData) return;
      setResultSafely(resultData);
      if (resultData.state === 'failed') {
        setError(resultData.message || 'Topic modeling failed');
      } else if (resultData.state === 'successful') {
        setError(null);
      }
    },
    // Restores selected nodes, columns, and topic parameters from the stored request.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config. Flow: normalize inputs, derive state, then return the analysis result expected by callers.
    onHydratedRequest: (requestPayload) => {
      const raw = requestPayload as Record<string, unknown> | null;
      const req = (raw?.data ?? requestPayload) as Record<string, unknown> | null;
      if (!req) return;
      hydrateParameters(req);
    },
    // Clears topic-specific result and error state after the shared lifecycle deletes results.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config.
    onCleared: (_, options) => {
      setResultSafely(null);
      setError(null);
      if (options?.preserveLocalState) {
        return;
      }
      // Detach the cleared task from the owning tab so a reload doesn't rehydrate
      // a task the user explicitly cleared. Inputs are intentionally preserved.
      onTabTaskChange?.(null);
    },
    // Removes completed topic tasks from the global task list after clear/delete operations.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config.
    pruneGlobalTasks: (taskIds) => {
      setTasks((prev: TaskItem[]) => (Array.isArray(prev) ? pruneTasksById(prev, taskIds) : prev));
    },
    // Finds task ids embedded in result metadata for status recovery.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config.
    getExtraTaskIdCandidates: () => [resultRef.current?.metadata?.task_id],
    // Finds task ids embedded in result metadata for clear operations.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config.
    getClearTaskIdSources: () => [resultRef.current?.metadata?.task_id],
    // Treats hydrated running results as active tasks for shared banner/action state.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config.
    isResultRunning: (r) => r?.state === 'running',
  });

  // Clears live topic results while preserving user-tuned sampling only when explicitly set.
  /**
   * Called by: TopicModelingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleClear = async () => {
    setIsClearing(true);
    await clearResults();
    handleClearTopicSelection();
    setTopicSearchQuery('');
    resetAfterClear();
    setIsClearing(false);
  };

  const topicRunningTask = taskStatus.runningTask;

  // Observe container width for responsive sizing
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    // Debounces resize observer updates into a stable chart width state.
    /**
     * Called by: TopicModelingFeature during this analysis workflow.
     */
    const updateChartWidth = (width: number) => {
      const nextWidth = Math.round(width);
      if (!nextWidth) return;
      setChartWidth((prevWidth) => (prevWidth === nextWidth ? prevWidth : nextWidth));
    };
    const observer = new ResizeObserver((entries) => {
      const latestEntry = entries.at(-1);
      if (!latestEntry) return;
      if (chartResizeFrameRef.current !== null) {
        cancelAnimationFrame(chartResizeFrameRef.current);
      }
      const nextWidth = latestEntry.contentRect.width;
      chartResizeFrameRef.current = requestAnimationFrame(() => {
        chartResizeFrameRef.current = null;
        updateChartWidth(nextWidth);
      });
    });
    observer.observe(el);
    updateChartWidth(el.getBoundingClientRect().width);
    return () => {
      observer.disconnect();
      if (chartResizeFrameRef.current !== null) {
        cancelAnimationFrame(chartResizeFrameRef.current);
        chartResizeFrameRef.current = null;
      }
    };
  }, []);

  // Per-source bubble-chart colours come from persisted node metadata, with
  // palette defaults written before a run when a selected node has no colour yet.
  const topicActiveNodeIds = panelNodeIds.slice(0, 2);
  const { defaultPalette, nodeColors, setNodeColor, ensureNodeColors } = useNodeColorControls({
    nodeIds: topicActiveNodeIds,
    nodes: panelSelectedNodes,
    persistNodeColor,
  });

  const effectiveNodeColumnSelections = nodeColumnSelections;

  const panelHasMissingColumns = panelNodeIds.some((nodeId) => {
    const selection = effectiveNodeColumnSelections.find((sel) => sel.nodeId === nodeId);
    return !selection?.column;
  });

  const currentTopicParams = {
    random_seed: randomSeed,
    min_topic_size: topicSizeValue,
    sample_fractions: sampleFractionsForRequest,
  };
  const serverTopicParams = (request: Record<string, unknown>) => ({
    random_seed: Number(request.random_seed),
    min_topic_size: Number(request.min_topic_size ?? DEFAULT_TOPIC_SIZE_VALUE),
    sample_fractions: normalizeTopicSampleFractions(
      (request as unknown as { sample_fractions?: unknown }).sample_fractions,
      panelNodeIds.length,
    ),
  });
  const hasLastRun = Boolean(typedServerRequest);
  const hasTopicChanges = !typedServerRequest
    ? true
    : hasParameterDiff(currentTopicParams, serverTopicParams(typedServerRequest)) ||
      hasNodeSelectionChanged(
        effectiveNodeColumnSelections,
        typedServerRequest.node_ids,
        typedServerRequest.node_columns,
      );

  const actionState = getRerunActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    isRunnable: panelNodeIds.length > 0 && !panelHasMissingColumns,
    hasLastRun,
    hasChanges: hasTopicChanges,
    isBusy: isRunning,
    hasResults: Boolean(result),
  });

  // Updates a node's selected text column and persists it as the document column preference.
  /**
   * Called by: TopicModelingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleColumnChange = (nodeId: string, column: string) => {
    setNodeColumnSelection(nodeId, column);
    void persistDocumentColumn(nodeId, column);
  };

  const rawTopics: TopicModelingTopic[] = result?.data?.topics ?? [];
  // Rebuild each topic's label from its representative_words sliced to the
  // current "Words per topic" display cap, so changing that input updates
  // the bottom list without a rerun. Falls back to the server-built label
  // when representative_words is missing.
  const topics: TopicModelingTopic[] = (() => {
    const cap = Math.max(1, Math.floor(representativeWordsCount));
    const filtered: TopicModelingTopic[] = [];
    for (const topic of rawTopics) {
      const words = Array.isArray(topic.representative_words) ? topic.representative_words : null;
      if (!words || words.length === 0) {
        filtered.push(topic);
        continue;
      }
      const sliced = words.slice(0, cap).join(', ');
      filtered.push(sliced ? { ...topic, label: sliced } : { ...topic });
    }
    return filtered;
  })();

  // Task-flow hook is intentionally placed after ``topics`` so it can
  // receive the already-filtered display list as ``displayedTopics`` —
  // detach builds its ``topic_meanings_override`` from this so the
  // detached node mirrors what's on screen (post-fit slice + stopword
  // toggle), not the fit-time artifact.
  const {
    handleRun,
    openDetachDialog,
    toggleDetachColumn,
    selectAllDetachColumns,
    deselectAllDetachColumns,
    handleDetachConfirm,
    isDetachLoading,
    isDetaching,
    detachDialogOpen,
    setDetachDialogOpen,
    detachNodeOptions,
    selectedDetachColumns,
  } = useTopicModelingTaskFlow({
    state: {
      currentWorkspaceId,
      panelNodeIds,
      panelHasMissingColumns,
      effectiveNodeColumnSelections,
      randomSeed,
      representativeWordsCount,
      selectedTopicIds,
      sampleFractions: hasAnySampling ? sampleFractionsForRequest : null,
      minTopicSize: topicSizeValue,
      displayedTopics: topics,
    },
    actions: {
      setIsRunning,
      runningRef,
      setError,
      setResultSafely,
      lastFetchedRef,
      resolveTopicModelingTaskId: resolveTaskId,
      setLocalTaskId,
      // Persist the run's assigned task id onto the active tab so reload
      // rehydrates the same task.
      onTaskIdAssigned: (taskId) => {
        if (tabId) onTabTaskChange?.(taskId);
      },
    },
    lock: {
      queryClient,
    },
  });

  const corpusCount = result?.data?.corpus_sizes.length ?? 0;
  const chartPadding = 40;
  const chartHeight = Math.min(520, Math.max(320, Math.round(chartWidth * 0.55)));

  const {
    activeDomain,
    brushRect,
    chartSvgRef,
    isBrushing,
    handleBrushStart,
    handleBrushMove,
    handleBrushEnd,
    handleResetZoom,
    isAtGlobalZoom,
  } = useTopicModelingZoomBrush({
    topics,
    chartWidth,
    chartHeight,
    chartPadding,
    setHoveredTopicId,
    setTooltip,
  });

  const colorNodeIds = panelNodeIds;

  const { bubbleElements, renderSizeComposition } = useTopicModelingBubbleChart({
    topics,
    activeDomain,
    chartWidth,
    chartHeight,
    chartPadding,
    brushRect,
    chartSvgRef,
    chartRef,
    isBrushing,
    handleBrushStart,
    handleBrushMove,
    handleBrushEnd,
    hoveredTopicId,
    setHoveredTopicId,
    setTooltip,
    corpusCount,
    panelNodeIds: colorNodeIds,
    nodeColors,
    defaultPalette,
    selectedTopicIds,
    onToggleTopicSelection: handleToggleTopicSelection,
    topicSearchQuery,
    handleResetZoom,
  });

  // Runs a fresh topic-modeling task or updates a locked task after parameter changes.
  /**
   * Called by: TopicModelingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleRunOrUpdate = async () => {
    await ensureNodeColors();
    await executeAnalysisRerun({
      hasUnrunChanges: hasTopicChanges,
      clearResults,
      runFreshAnalysis: handleRun,
    });
  };

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- this is a truthiness OR: a falsy banner/result/error must fall through to the next, so ?? would short-circuit incorrectly
  const shouldShowResultsPanel = Boolean(topicWaitingBanner || result || error);

  return (
    <div className="space-y-4">
      <TopicModelingParameterPanel
        nodeInputs={nodeInputs}
        onColumnChange={handleColumnChange}
        actionState={actionState}
        corpusSamples={corpusSamples}
        nodeDocCounts={nodeDocCounts}
        onCorpusSampleChange={updateCorpusSample}
        topicSizeValue={topicSizeValue}
        topicSizeUserSet={topicSizeUserSet}
        topicSizeWarning={topicSizeWarning}
        onTopicSizeValueChange={setTopicSizeValueFromUser}
        showSamplingWarning={showSamplingWarning}
        randomSeed={randomSeed}
        randomSeedUserSet={randomSeedUserSet}
        onRandomSeedChange={setRandomSeedFromUser}
        representativeWordsCount={representativeWordsCount}
        representativeWordsCountUserSet={representativeWordsCountUserSet}
        representativeWordsCountServerMax={
          typedServerRequest ? Number(typedServerRequest.representative_words_count) || null : null
        }
        onRepresentativeWordsCountChange={setRepresentativeWordsCountFromUser}
        isRunning={isRunning}
        isStopping={isStopping}
        isClearing={isClearing}
        onRun={handleRunOrUpdate}
        onStop={() => {
          void stopTask();
        }}
        onClear={handleClear}
        hasMissingColumns={panelHasMissingColumns}
        resultState={result?.state}
        nodeColors={nodeColors}
        onNodeColorChange={(nodeId, color) => {
          void setNodeColor(nodeId, color);
        }}
        defaultPalette={defaultPalette}
      />

      {shouldShowResultsPanel && (
        <TopicModelingResultsPanel
          topicWaitingBanner={topicWaitingBanner}
          runningTask={topicRunningTask}
          error={error}
          result={result}
          topics={topics}
          containerRef={containerRef}
          isDetachLoading={isDetachLoading}
          isDetaching={isDetaching}
          openDetachDialog={openDetachDialog}
          chartRef={chartRef}
          handleResetZoom={handleResetZoom}
          isAtGlobalZoom={isAtGlobalZoom}
          bubbleElements={bubbleElements}
          tooltip={tooltip}
          renderSizeComposition={renderSizeComposition}
          hoveredTopicId={hoveredTopicId}
          setHoveredTopicId={setHoveredTopicId}
          selectedTopicIds={selectedTopicIds}
          onToggleTopicSelection={handleToggleTopicSelection}
          onClearSelection={handleClearTopicSelection}
          topicSearchQuery={topicSearchQuery}
          onTopicSearchQueryChange={setTopicSearchQuery}
          activeDomain={activeDomain}
          nodeNames={panelSelectedNodes.map((n) => n.name ?? n.id)}
          randomSeed={randomSeed}
          detachDialogOpen={detachDialogOpen}
          setDetachDialogOpen={setDetachDialogOpen}
          detachNodeOptions={detachNodeOptions}
          selectedDetachColumns={selectedDetachColumns}
          toggleDetachColumn={toggleDetachColumn}
          selectAllDetachColumns={selectAllDetachColumns}
          deselectAllDetachColumns={deselectAllDetachColumns}
          handleDetachConfirm={handleDetachConfirm}
          readOnly={false}
        />
      )}
    </div>
  );
}

export default TopicModelingFeature;
