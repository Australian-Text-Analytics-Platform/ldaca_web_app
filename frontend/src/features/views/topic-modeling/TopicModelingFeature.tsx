import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  topicModelingTaskRequest,
  topicModelingTaskResult,
} from '@/api/generated/sdk.gen';
import type {
  AnalysisTabInput,
  TopicModelingResponse,
  TopicModelingTopic,
} from '@/api/generated/types.gen';
import { useAnalysisStore, type TaskItem } from '@/stores/analysisStore';
import { useUIStore } from '@/stores';
import { pruneTasksById } from '@/features/views/common/analysisTaskUtils';
import {
  getNodeIdentifier,
  useLastRunRequest,
  useAnalysisFeature,
  useSafeResult,
  useNodeColorManagement,
  DEFAULT_PALETTE,
  executeAnalysisRerun,
} from '../common';
import { useTabNodeInputs } from '../common/nodeInputs';
import { getRerunActionState, hasNodeSelectionChanged } from '../common/rerunActionState';
import { hasParameterDiff } from '../common/parameterComparison';
import {
  TopicModelingParameterPanel,
  type CorpusSample,
} from './components/panels/TopicModelingParameterPanel';
import { TopicModelingResultsPanel } from './components/panels/TopicModelingResultsPanel';
import { useTopicModelingTaskFlow } from './hooks/useTopicModelingTaskFlow';
import { useTopicModelingZoomBrush } from './hooks/useTopicModelingZoomBrush';
import { useTopicModelingBubbleChart } from './hooks/useTopicModelingBubbleChart';
import { usePersistNodeDocumentColumn } from '../common/hooks/usePersistNodeDocumentColumn';

const DEFAULT_TOPIC_SIZE_VALUE = 10;

/** Renders the topic-modeling workflow for live BERTopic runs and result exploration. */
/**
 * Rendered by: TopicModelingTabbedFeature, which mounts one instance per analysis tab and feeds it tab props.
 * Flow: read workspace/auth state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 *
 * Tab props: ``tabId`` identifies the active tab, ``tabTaskId`` seeds
 * deterministic hydration of that tab's task, and ``onTabTaskChange`` reports
 * task id assignment/clear back to the tab record.
 */
export interface TopicModelingFeatureProps {
  tabId?: string;
  tabTaskId?: string | null;
  onTabTaskChange?: (taskId: string | null) => void;
  tabInputs?: AnalysisTabInput[];
  onTabInputsChange?: (inputs: AnalysisTabInput[]) => void;
}

function TopicModelingFeature({
  tabId,
  tabTaskId,
  onTabTaskChange,
  tabInputs,
  onTabInputsChange,
}: TopicModelingFeatureProps = {}) {
  const { currentWorkspaceId } = useWorkspaceData();
  const { getAuthHeaders } = useAuth();
  const queryClient = useQueryClient();
  const nodeInputs = useTabNodeInputs({
    tabInputs,
    onTabInputsChange,
    constraints: {
      allowedDataTypes: ['string'],
      maxNodes: 2,
      docTypeOnly: true,
    },
  });
  const nodeColumnSelections = nodeInputs.nodeColumnSelections;
  const setNodeColumnSelection = nodeInputs.setColumn;
  const panelSelectedNodes = nodeInputs.selectedNodes;
  const activeNodeIds = nodeInputs.resolvedNodes.map((node) => node.id);
  const applyInputsFromSelections = (
    selections: { nodeId: string; column?: string | null }[],
  ) => {
    onTabInputsChange?.(
      selections
        .filter((selection) => selection.nodeId)
        .map((selection) => ({ node_id: selection.nodeId, column: selection.column ?? null })),
    );
  };
  const { serverRequest } = useLastRunRequest({
    analysisType: 'topic_modeling',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    taskId: tabTaskId ?? null,
  });
  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
  });

  const typedServerRequest = serverRequest as {
    node_ids?: string[];
    node_columns?: Record<string, string>;
    min_topic_size?: number;
    random_seed?: number;
    representative_words_count?: number;
  } | null;
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'topic-modeling';
  const setTasks = useAnalysisStore((state) => state.setTasks);
  const [error, setError] = useState<string | null>(null);
  const [liveResult, resultRef, setResultSafely] = useSafeResult<TopicModelingResponse>();

  const result: TopicModelingResponse | null = liveResult;

  const [corpusSamples, setCorpusSamples] = useState<CorpusSample[]>([]);
  // Sample values reset on data-block change (auto-populate) but persist
  // through Clear Results if the user explicitly touched them, so the user
  // doesn't lose tuned sampling when re-running on the same corpora.
  const [corpusSamplesUserSet, setCorpusSamplesUserSet] = useState(false);
  // "Minimum topic size" = HDBSCAN min_cluster_size: the smallest group of
  // chunks that counts as a topic. The topic count is whatever emerges (the
  // only native topic-count control; there is no post-fit merge to a target).
  const [topicSizeValue, setTopicSizeValue] = useState(DEFAULT_TOPIC_SIZE_VALUE);
  const [topicSizeUserSet, setTopicSizeUserSet] = useState(false);
  const [randomSeed, setRandomSeed] = useState(42);
  const [randomSeedUserSet, setRandomSeedUserSet] = useState(false);
  const [representativeWordsCount, setRepresentativeWordsCount] = useState(15);
  const [representativeWordsCountUserSet, setRepresentativeWordsCountUserSet] = useState(false);
  const [hoveredTopicId, setHoveredTopicId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    topic: TopicModelingTopic | null;
  }>({ x: 0, y: 0, topic: null });
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<number>>(new Set());
  const [topicSearchQuery, setTopicSearchQuery] = useState('');
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
    analysisType: 'topic_modeling',
    taskType: 'topic_modeling',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    // Tab-driven deterministic hydration: the tab's persisted task id wins task
    // resolution over transient local state.
    hydrationTaskId: tabTaskId ?? null,
    resultRef,
    // Loads the latest topic-modeling result for polling and task resumption.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    fetchResult: async (taskId, headers) => {
      const { data } = await topicModelingTaskResult({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    // Retrieves the submitted request so hydration can restore parameter and lock state.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    fetchRequest: async (taskId, headers) => {
      const { data } = await topicModelingTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    // Applies freshly fetched task results and surfaces failed/successful status messages.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    onResultFetched: (resultData) => {
      setResultSafely(resultData);
      if (resultData.state === 'failed') {
        setError(resultData.message || 'Topic modeling failed');
      } else if (resultData.state === 'successful') {
        setError(null);
      }
    },
    // Rebuilds live result state from a hydrated task payload after reload.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
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
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned. Flow: normalize inputs, derive state, then return the analysis result expected by callers.
    onHydratedRequest: (requestPayload) => {
      const raw = requestPayload as Record<string, unknown> | null;
      const req = (raw?.data ?? requestPayload) as Record<string, unknown> | null;
      if (!req) return;
      const nodeIds: string[] = Array.isArray(req.node_ids)
        ? (req.node_ids as string[]).slice(0, 2)
        : [];
      const node_columns = (req.node_columns ?? {}) as Record<string, string>;
      const sels = nodeIds.map((id: string) => ({ nodeId: id, column: node_columns[id] ?? '' }));
      if (!tabInputs || tabInputs.length === 0) {
        applyInputsFromSelections(sels);
      }
      setRandomSeed(Number(req.random_seed ?? 42));
      setRandomSeedUserSet(true);
      setRepresentativeWordsCount(Number(req.representative_words_count ?? 15));
      setRepresentativeWordsCountUserSet(true);
      const hydratedTopicSizeValue = Number(req.min_topic_size ?? DEFAULT_TOPIC_SIZE_VALUE);
      setTopicSizeValue(hydratedTopicSizeValue);
      setTopicSizeUserSet(true);
    },
    // Clears topic-specific result and error state after the shared lifecycle deletes results.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
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
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    pruneGlobalTasks: (taskIds) =>
      { setTasks((prev: TaskItem[]) => (Array.isArray(prev) ? pruneTasksById(prev, taskIds) : prev)); },
    // Finds task ids embedded in result metadata for status recovery.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    getExtraTaskIdCandidates: () => [
      (resultRef.current)?.metadata?.task_id,
    ],
    // Finds task ids embedded in result metadata for clear operations.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    getClearTaskIdSources: () => [
      (resultRef.current)?.metadata?.task_id,
    ],
    // Treats hydrated running results as active tasks for shared banner/action state.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    isResultRunning: (r) => r?.state === 'running',
  });

  // Computes default per-corpus sampling controls from selected node row counts.
  /**
   * Called by: TopicModelingFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   * Flow: read the first two selected node row counts, compute a rounded sample percent capped at 100, then enable sampling only below full corpus.
   */
  const computeDefaultCorpusSamples = (): CorpusSample[] =>
    panelSelectedNodes.slice(0, 2).map((node) => {
      const nDocs = (node as { shape?: number[] }).shape?.[0] ?? 0;
      const autoPercent =
        nDocs > 0 ? Math.min(100, Math.ceil(((4000 / nDocs) * 100) / 10) * 10) : 100;
      return { percent: String(autoPercent), enabled: autoPercent < 100 };
    });

  // Clears live topic results while preserving user-tuned sampling only when explicitly set.
  /**
   * Called by: TopicModelingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleClear = async () => {
    setIsClearing(true);
    await clearResults();
    setSelectedTopicIds(new Set());
    setTopicSearchQuery('');
    // Only reset sampling defaults when the user hasn't customized them — if
    // they have, the same corpora deserve the same tuned sampling on the
    // next run. The node-change effect below still resets these when the
    // selected blocks differ.
    if (!corpusSamplesUserSet) {
      setCorpusSamples(computeDefaultCorpusSamples());
    }
    setTopicSizeValue(DEFAULT_TOPIC_SIZE_VALUE);
    setTopicSizeUserSet(false);
    setRandomSeedUserSet(false);
    setRepresentativeWordsCountUserSet(false);
    setIsClearing(false);
  };

  // Records the next-run minimum topic size (HDBSCAN min_cluster_size).
  /**
   * Called by: TopicModelingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleTopicSizeValueChange = (value: number) => {
    setTopicSizeValue(value);
    setTopicSizeUserSet(true);
  };

  // Toggles topics selected for detach/export workflows.
  /**
   * Called by: TopicModelingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleToggleTopicSelection = (id: number) => {
    setSelectedTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Clears the current topic selection set.
  /**
   * Called by: TopicModelingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleClearTopicSelection = () => {
    setSelectedTopicIds(new Set());
  };

  const topicRunningTask = taskStatus.runningTask;
  const panelNodeIds = panelSelectedNodes.slice(0, 2)
    .map((node, idx) => getNodeIdentifier(node, idx) || activeNodeIds[idx])
    .filter((id): id is string => Boolean(id));
  const panelNodeIdsKey = panelNodeIds.join('|');

  // Observe container width for responsive sizing
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    // Debounces resize observer updates into a stable chart width state.
    /**
     * Called by: TopicModelingFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
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

  const defaultPalette = DEFAULT_PALETTE;

  // ``tabKey`` routes colour changes through the per-tab temp layer
  // (commit on Run via ``promoteTempColors`` below).
  const topicActiveNodeIds = panelNodeIds.slice(0, 2);
  const {
    nodeColors: liveNodeColors,
    handleColorChange,
    defaultPalette: _dp,
    promoteTempColors,
  } = useNodeColorManagement({
    activeNodeIds: topicActiveNodeIds,
    tabKey: 'topic-modeling',
  });
  const nodeColors: Record<string, string> = liveNodeColors;

  const effectiveNodeColumnSelections = nodeColumnSelections;

  const panelHasMissingColumns = panelNodeIds.some((nodeId) => {
    const selection = effectiveNodeColumnSelections.find((sel) => sel.nodeId === nodeId);
    return !selection?.column;
  });

  // sample_fractions diff: server stores `null` (or absent) when sampling
  // is disabled per corpus; mirror that shape so the comparison is stable
  // across "no sampling specified" vs "explicit 100%".
  /**
   * Called by: TopicModelingFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   */
  const normalizeSampleFractions = (raw: unknown, nodeCount: number): (number | null)[] => {
    const list: unknown[] = Array.isArray(raw) ? raw : [];
    return Array.from({ length: nodeCount }, (_, idx) => {
      const value = list[idx];
      if (typeof value === 'number' && value > 0 && value < 1) return value;
      return null;
    });
  };

  const currentSampleFractions = corpusSamples.slice(0, panelNodeIds.length).map((s) => {
    if (!s.enabled) return null;
    const pct = Math.min(100, Math.max(1, Number(s.percent) || 100));
    return pct >= 100 ? null : pct / 100;
  });

  const currentTopicParams = {
    random_seed: randomSeed,
    min_topic_size: topicSizeValue,
    sample_fractions: normalizeSampleFractions(currentSampleFractions, panelNodeIds.length),
  };
  const serverTopicParams = (request: Record<string, unknown>) => ({
    random_seed: Number(request.random_seed),
    min_topic_size: Number(request.min_topic_size ?? DEFAULT_TOPIC_SIZE_VALUE),
    sample_fractions: normalizeSampleFractions(
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

  // Color assignment now handled by stack allocator - no auto-fill effect needed

  // Auto-populate sampling fractions when selected nodes change, and treat
  // these auto-values as not-user-set so Clear Results can re-derive them.
  useEffect(() => {
    const samples = computeDefaultCorpusSamples();
    void Promise.resolve().then(() => {
      setCorpusSamples(samples);
      setCorpusSamplesUserSet(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelNodeIdsKey]);

  // Updates a node's selected text column and persists it as the document column preference.
  /**
   * Called by: TopicModelingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleColumnChange = (nodeId: string, column: string) => {
    setNodeColumnSelection(nodeId, column);
    void persistDocumentColumn(nodeId, column);
  };

  const nodeDocCounts = useMemo(
    () => panelSelectedNodes.slice(0, 2).map((n) => (n as { shape?: number[] }).shape?.[0] ?? 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panelNodeIdsKey],
  );

  const effectiveDocCounts = useMemo(
    () =>
      nodeDocCounts.map((n, idx) => {
        const s = corpusSamples[idx];
        if (!s?.enabled) return n;
        const pct = Math.min(100, Math.max(1, Number(s.percent) || 100));
        return Math.max(1, Math.round((n * pct) / 100));
      }),
    [nodeDocCounts, corpusSamples],
  );

  const combinedEffective = effectiveDocCounts.reduce((a, b) => a + b, 0);

  // "Minimum topic size" is the HDBSCAN min_cluster_size, i.e. the floor on
  // documents (chunks) per topic. A very small floor produces noisy/unstable
  // micro-topics, so warn as it drops below readable thresholds.
  const topicSizeWarning: 'orange' | 'red' | null = useMemo(() => {
    if (combinedEffective <= 0 || topicSizeValue <= 0) return null;
    if (topicSizeValue < 3) return 'red';
    if (topicSizeValue < 10) return 'orange';
    return null;
  }, [topicSizeValue, combinedEffective]);

  const showSamplingWarning =
    combinedEffective > 0 && combinedEffective < 5 * topicSizeValue;

  const sampleFractionsForRequest = useMemo(
    () =>
      corpusSamples.slice(0, panelNodeIds.length).map((s) => {
        if (!s.enabled) return null;
        const pct = Math.min(100, Math.max(1, Number(s.percent) || 100));
        return pct >= 100 ? null : pct / 100;
      }),
    [corpusSamples, panelNodeIds.length],
  );
  const hasAnySampling = sampleFractionsForRequest.some((f) => f !== null);

  const rawTopics: TopicModelingTopic[] = result?.data?.topics ?? [];
  // Rebuild each topic's label from its representative_words sliced to the
  // current "Words per topic" display cap, so changing that input updates
  // the bottom list without a rerun. Falls back to the server-built label
  // when representative_words is missing.
  const topics: TopicModelingTopic[] = useMemo(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, representativeWordsCount]);

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
      getAuthHeaders,
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
    // Promote this tab's pending temp colours to assigned — Run is the
    // commit trigger per the node-colour strategy doc.
    promoteTempColors(topicActiveNodeIds);
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
        nodeColors={nodeColors}
        onNodeColorChange={handleColorChange}
        defaultPalette={defaultPalette}
        actionState={actionState}
        corpusSamples={corpusSamples}
        nodeDocCounts={nodeDocCounts}
        onCorpusSampleChange={(idx, update) => {
          setCorpusSamplesUserSet(true);
          setCorpusSamples((prev) => {
            const next = [...prev];
            next[idx] = { ...(next[idx] ?? { percent: '100', enabled: false }), ...update };
            return next;
          });
        }}
        topicSizeValue={topicSizeValue}
        topicSizeUserSet={topicSizeUserSet}
        topicSizeWarning={topicSizeWarning}
        onTopicSizeValueChange={handleTopicSizeValueChange}
        showSamplingWarning={showSamplingWarning}
        randomSeed={randomSeed}
        randomSeedUserSet={randomSeedUserSet}
        onRandomSeedChange={(v) => {
          setRandomSeed(v);
          setRandomSeedUserSet(true);
        }}
        representativeWordsCount={representativeWordsCount}
        representativeWordsCountUserSet={representativeWordsCountUserSet}
        representativeWordsCountServerMax={
          typedServerRequest ? Number(typedServerRequest.representative_words_count) || null : null
        }
        onRepresentativeWordsCountChange={(v) => {
          setRepresentativeWordsCount(v);
          setRepresentativeWordsCountUserSet(true);
        }}
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
          nodeNames={
            panelSelectedNodes
              .map((n) => (n.name) ?? (n.id) ?? '')
              .filter(Boolean)
          }
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
