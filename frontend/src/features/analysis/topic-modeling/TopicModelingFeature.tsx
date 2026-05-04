import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useAuth } from '../../../hooks/useAuth';
import { takeMostRecent } from '../../../utils/selectionUtils';
// Updated to use modular API object pattern
import { textApi, type TopicModelingResponse, type TopicModelingTopic } from '../../../api/text';
import { useAnalysisStore, type TaskItem } from '../../../stores/analysisStore';
import { useUIStore } from '../../../stores';
import useNodeColumnInfos from '../../../hooks/useNodeColumnInfos';
import { pruneTasksById } from '../../../hooks/analysisTaskUtils';
import {
  hasLockedParameterDiff,
  getNodeIdentifier,
  resetAnalysisSelectionAfterClear,
  restoreAnalysisLockFromRequest,
  useAnalysisLock,
  useAnalysisFeature,
  useSafeResult,
  useNodeColorManagement,
  DEFAULT_PALETTE,
  getAnalysisActionState,
  executeAnalysisRunOrUpdate,
} from '../common';
import { TopicModelingParameterPanel, type CorpusSample } from './components/panels/TopicModelingParameterPanel';
import { TopicModelingResultsPanel } from './components/panels/TopicModelingResultsPanel';
import { useTopicModelingTaskFlow } from './hooks/useTopicModelingTaskFlow';
import { useTopicModelingZoomBrush } from './hooks/useTopicModelingZoomBrush';
import { useTopicModelingBubbleChart } from './hooks/useTopicModelingBubbleChart';

const TopicModelingFeature: React.FC = () => {
  const { selectedNodes } = useWorkspaceSelection();
  const { currentWorkspaceId } = useWorkspaceData();
  const { getAuthHeaders } = useAuth();
  const queryClient = useQueryClient();
  const {
    isLocked,
    lockWithSnapshots,
    unlockSelection,
    nodeColumnSelections,
    setNodeColumnSelection,
    setNodeColumnSelections,
    recomputeAutoColumns,
    activeNodeIds,
    activeNodeColumnSelections,
    panelSelectedNodes,
    serverRequest,
  } = useAnalysisLock({
    analysisType: 'topic_modeling',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    allowedDataTypes: ['string'],
    maxNodes: 2,
    docTypeOnly: true,
  });

  const typedServerRequest = serverRequest as
    | {
        node_ids?: string[];
        node_columns?: Record<string, string>;
        min_topic_size?: number;
        random_seed?: number;
        representative_words_count?: number;
        topic_size_mode?: string;
        topic_size_value?: number;
      }
    | null;
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'topic-modeling';
  const setTasks = useAnalysisStore((state) => state.setTasks);
  const [error, setError] = useState<string | null>(null);
  const [result, resultRef, setResultSafely] = useSafeResult<TopicModelingResponse>();
  
  const [corpusSamples, setCorpusSamples] = useState<CorpusSample[]>([]);
  const [topicSizeMode, setTopicSizeMode] = useState<'target' | 'min' | 'exact'>('target');
  const [topicSizeValue, setTopicSizeValue] = useState(50);
  const [topicSizeUserSet, setTopicSizeUserSet] = useState(false);
  const [referenceTopicNo, setReferenceTopicNo] = useState(50);
  const [randomSeed, setRandomSeed] = useState(42);
  const [randomSeedUserSet, setRandomSeedUserSet] = useState(false);
  const [representativeWordsCount, setRepresentativeWordsCount] = useState(15);
  const [representativeWordsCountUserSet, setRepresentativeWordsCountUserSet] = useState(false);
  const [hoveredTopicId, setHoveredTopicId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{x:number;y:number; topic: TopicModelingTopic | null}>({x:0,y:0,topic:null});
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<number>>(new Set());
  const [topicSearchQuery, setTopicSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState<number>(800);
  const [isClearing, setIsClearing] = useState(false);

  const {
    resolveTaskId,
    isRunning,
    setIsRunning,
    runningRef,
    taskStatus,
    lastFetchedRef,
    clearResults,
    setLocalTaskId,
    banner: topicWaitingBanner,
    hasActiveTask,
  } = useAnalysisFeature<TopicModelingResponse>({
    analysisType: 'topic_modeling',
    taskType: 'topic_modeling',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    resultRef,
    fetchResult: async (taskId, headers) =>
      (await textApi.getTopicModelingTaskResult(taskId, headers)) as TopicModelingResponse | null,
    fetchRequest: async (taskId, headers) =>
      textApi.getTopicModelingTaskRequest(taskId, headers),
    onResultFetched: (resultData) => {
      setResultSafely(resultData);
      if (resultData.state === 'failed') {
        setError(resultData.message || 'Topic modeling failed');
      } else if (resultData.state === 'successful') {
        setError(null);
      }
    },
    onHydratedResult: (resultData) => {
      if (!resultData) return;
      setResultSafely(resultData);
      if (resultData.state === 'failed') {
        setError(resultData.message || 'Topic modeling failed');
      } else if (resultData.state === 'successful') {
        setError(null);
      }
    },
    onHydratedRequest: async (requestPayload) => {
      const req = ((requestPayload as Record<string, unknown>)?.data ?? requestPayload) as Record<string, unknown>;
      if (!req) return;
      const nodeIds: string[] = Array.isArray(req.node_ids) ? (req.node_ids as string[]).slice(0, 2) : [];
      const node_columns = (req.node_columns || {}) as Record<string, string>;
      const sels = nodeIds.map((id: string) => ({ nodeId: id, column: node_columns[id] || '' }));
      setNodeColumnSelections(sels, { replace: true });
      setRandomSeed(Number(req.random_seed ?? 42));
      setRandomSeedUserSet(true);
      setRepresentativeWordsCount(Number(req.representative_words_count ?? 15));
      setRepresentativeWordsCountUserSet(true);
      setTopicSizeMode((req.topic_size_mode as 'target' | 'min' | 'exact') || 'target');
      const hydratedTopicSizeValue = Number(req.topic_size_value ?? 50);
      setTopicSizeValue(hydratedTopicSizeValue);
      setReferenceTopicNo(hydratedTopicSizeValue);
      setTopicSizeUserSet(true);
      if (nodeIds.length && currentWorkspaceId) {
        try {
          await restoreAnalysisLockFromRequest({
            workspaceId: currentWorkspaceId,
            requestData: req,
            getAuthHeaders,
            lockWithSnapshots,
            maxNodes: 2,
          });
        } catch { /* ignore */ }
      }
    },
    onCleared: () => {
      setResultSafely(null);
      setError(null);
      resetAnalysisSelectionAfterClear({ unlockSelection });
    },
    pruneGlobalTasks: (taskIds) =>
      setTasks((prev: TaskItem[]) => Array.isArray(prev) ? pruneTasksById(prev, taskIds) : prev),
    getExtraTaskIdCandidates: () => [(resultRef.current as TopicModelingResponse | null)?.metadata?.task_id],
    getClearTaskIdSources: () => [(resultRef.current as TopicModelingResponse | null)?.metadata?.task_id],
    isResultRunning: (r) => r?.state === 'running',
  });

  const handleClear = async () => {
    setIsClearing(true);
    await clearResults();
    setSelectedTopicIds(new Set());
    setTopicSearchQuery('');
    setCorpusSamples([]);
    setTopicSizeMode('target');
    setTopicSizeValue(50);
    setTopicSizeUserSet(false);
    setReferenceTopicNo(50);
    setRandomSeedUserSet(false);
    setRepresentativeWordsCountUserSet(false);
    setIsClearing(false);
  };

  const handleTopicSizeModeChange = (mode: 'target' | 'min' | 'exact') => {
    setTopicSizeMode(mode);
    setTopicSizeUserSet(false);
    if (mode !== 'min') {
      setTopicSizeValue(referenceTopicNo);
    }
  };

  const handleTopicSizeValueChange = (value: number) => {
    setTopicSizeValue(value);
    setTopicSizeUserSet(true);
    if (topicSizeMode !== 'min') {
      setReferenceTopicNo(value);
    }
  };

  const handleToggleTopicSelection = (id: number) => {
    setSelectedTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClearTopicSelection = () => {
    setSelectedTopicIds(new Set());
  };

  const topicRunningTask = taskStatus.runningTask;
  const panelNodeIds = takeMostRecent(panelSelectedNodes, 2)
    .map((node, idx) => getNodeIdentifier(node, idx) || activeNodeIds[idx])
    .filter((id): id is string => Boolean(id));
  const panelNodeIdsKey = panelNodeIds.join('|');

  // Observe container width for responsive sizing
  useEffect(()=>{
    const el = chartRef.current;
    if(!el) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w) setChartWidth(w);
      }
    });
    observer.observe(el);
    setChartWidth(el.getBoundingClientRect().width);
    return ()=> observer.disconnect();
  },[]);

  const defaultPalette = DEFAULT_PALETTE;

  const { nodeColors, handleColorChange, defaultPalette: _dp } = useNodeColorManagement({
    activeNodeIds: takeMostRecent(panelNodeIds, 2),
  });

  const effectiveNodeColumnSelections = isLocked ? activeNodeColumnSelections : nodeColumnSelections;

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
  });

  const panelHasMissingColumns = panelNodeIds.some((nodeId) => {
    const selection = effectiveNodeColumnSelections.find((sel) => sel.nodeId === nodeId);
    return !selection || !selection.column;
  });

  const hasLockedParameterChanges = hasLockedParameterDiff({
    isLocked,
    serverRequest: typedServerRequest,
    currentParams: {
      random_seed: Number(randomSeed),
      representative_words_count: Number(representativeWordsCount),
      topic_size_mode: topicSizeMode,
      topic_size_value: Number(topicSizeValue),
    },
    getServerParams: (request) => ({
      random_seed: Number(request.random_seed),
      representative_words_count: Number(request.representative_words_count),
      topic_size_mode: request.topic_size_mode ?? 'target',
      topic_size_value: Number(request.topic_size_value ?? 50),
    }),
  });

  const actionState = getAnalysisActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    hasSelection: panelNodeIds.length > 0,
    isLocked,
    hasResults: Boolean(result),
    isBusy: isRunning,
    hasActiveTask,
    allowRunWhenLocked: hasLockedParameterChanges,
  });

  // Color assignment now handled by stack allocator - no auto-fill effect needed

  useEffect(() => {
    if (!isLocked && panelNodeIds.length > 0 && nodeColumnSelections.length === 0) {
      recomputeAutoColumns();
    }
  }, [isLocked, panelNodeIdsKey, nodeColumnSelections.length, recomputeAutoColumns, panelNodeIds.length]);

  // Auto-populate sampling fractions when selected nodes change
  useEffect(() => {
    setCorpusSamples(
      panelSelectedNodes.slice(0, 2).map((node) => {
        const nDocs = (node as { shape?: number[] }).shape?.[0] ?? 0;
        const autoPercent =
          nDocs > 0 ? Math.min(100, Math.ceil((4000 / nDocs) * 100 / 10) * 10) : 100;
        return { percent: String(autoPercent), enabled: autoPercent < 100 };
      })
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelNodeIdsKey]);

  const handleColumnChange = (nodeId: string, column: string) => {
    if (isLocked) return;
    setNodeColumnSelection(nodeId, column);
  };

  const nodeDocCounts = useMemo(
    () =>
      panelSelectedNodes
        .slice(0, 2)
        .map((n) => (n as { shape?: number[] }).shape?.[0] ?? 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panelNodeIdsKey]
  );

  const effectiveDocCounts = useMemo(
    () =>
      nodeDocCounts.map((n, idx) => {
        const s = corpusSamples[idx];
        if (!s?.enabled) return n;
        const pct = Math.min(100, Math.max(1, Number(s.percent) || 100));
        return Math.max(1, Math.round((n * pct) / 100));
      }),
    [nodeDocCounts, corpusSamples]
  );

  const combinedEffective = effectiveDocCounts.reduce((a, b) => a + b, 0);

  // Auto-recalculate min topic size when in 'min' mode and not overridden by user
  useEffect(() => {
    if (topicSizeMode !== 'min' || topicSizeUserSet || combinedEffective <= 0) return;
    const autoMin = Math.max(2, Math.floor(combinedEffective / (10 * referenceTopicNo)));
    setTopicSizeValue(autoMin);
  }, [topicSizeMode, topicSizeUserSet, combinedEffective, referenceTopicNo]);

  const showSamplingWarning =
    combinedEffective > 0 && combinedEffective < 5 * (topicSizeValue ?? 50);

  const sampleFractionsForRequest = useMemo(
    () =>
      corpusSamples.slice(0, panelNodeIds.length).map((s) => {
        if (!s?.enabled) return null;
        const pct = Math.min(100, Math.max(1, Number(s.percent) || 100));
        return pct >= 100 ? null : pct / 100;
      }),
    [corpusSamples, panelNodeIds.length]
  );
  const hasAnySampling = sampleFractionsForRequest.some((f) => f !== null);

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
      topicSizeMode,
      topicSizeValue,
    },
    actions: {
      setIsRunning,
      runningRef,
      setError,
      setResultSafely,
      lastFetchedRef,
      resolveTopicModelingTaskId: resolveTaskId,
      setLocalTaskId,
    },
    lock: {
      getAuthHeaders,
      lockWithSnapshots,
      queryClient,
    },
  });

  const topics: TopicModelingTopic[] = result?.data?.topics || [];
  const corpusCount = result?.data?.corpus_sizes?.length || 0;
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

  const colorNodeIds = isLocked ? takeMostRecent(activeNodeIds, 2) : panelNodeIds;

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

  const handleRunOrUpdate = async () => {
    await executeAnalysisRunOrUpdate({
      hasLockedParameterChanges,
      clearResults,
      runFreshAnalysis: handleRun,
    });
  };

  const shouldShowResultsPanel = Boolean(topicWaitingBanner || result || error);

  return (
    <div className="space-y-4">
      <TopicModelingParameterPanel
        selectedNodes={panelSelectedNodes}
        nodeColumnSelections={effectiveNodeColumnSelections}
        onColumnChange={handleColumnChange}
        nodeColors={nodeColors}
        onNodeColorChange={handleColorChange}
        defaultPalette={defaultPalette}
        isLocked={!!isLocked}
        getNodeColumns={getColumnInfos}
        actionState={actionState}
        corpusSamples={corpusSamples}
        nodeDocCounts={nodeDocCounts}
        onCorpusSampleChange={(idx, update) =>
          setCorpusSamples((prev) => {
            const next = [...prev];
            next[idx] = { ...(next[idx] ?? { percent: '100', enabled: false }), ...update };
            return next;
          })
        }
        topicSizeMode={topicSizeMode}
        onTopicSizeModeChange={handleTopicSizeModeChange}
        topicSizeValue={topicSizeValue}
        topicSizeUserSet={topicSizeUserSet}
        onTopicSizeValueChange={handleTopicSizeValueChange}
        showSamplingWarning={showSamplingWarning}
        randomSeed={randomSeed}
        randomSeedUserSet={randomSeedUserSet}
        onRandomSeedChange={(v) => { setRandomSeed(v); setRandomSeedUserSet(true); }}
        representativeWordsCount={representativeWordsCount}
        representativeWordsCountUserSet={representativeWordsCountUserSet}
        onRepresentativeWordsCountChange={(v) => { setRepresentativeWordsCount(v); setRepresentativeWordsCountUserSet(true); }}
        isRunning={isRunning}
        isClearing={isClearing}
        onRun={handleRunOrUpdate}
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
          nodeNames={panelSelectedNodes
            .map((n) => (n.name as string | undefined) ?? (n.id as string | undefined) ?? '')
            .filter(Boolean) as string[]}
          topicSizeMode={topicSizeMode}
          topicSizeValue={topicSizeValue}
          randomSeed={randomSeed}
          detachDialogOpen={detachDialogOpen}
          setDetachDialogOpen={setDetachDialogOpen}
          detachNodeOptions={detachNodeOptions}
          selectedDetachColumns={selectedDetachColumns}
          toggleDetachColumn={toggleDetachColumn}
          selectAllDetachColumns={selectAllDetachColumns}
          deselectAllDetachColumns={deselectAllDetachColumns}
          handleDetachConfirm={handleDetachConfirm}
        />
      )}
      </div>
  );
};

export default TopicModelingFeature;
