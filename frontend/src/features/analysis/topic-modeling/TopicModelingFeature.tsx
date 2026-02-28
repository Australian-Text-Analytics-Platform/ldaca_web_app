import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useAuth } from '../../../hooks/useAuth';
// Updated to use modular API object pattern
import { textApi } from '../../../api/text';
import { useAnalysisStore } from '../../../stores/analysisStore';
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
} from '../common';
import { TopicModelingParameterPanel } from './components/panels/TopicModelingParameterPanel';
import { TopicModelingResultsPanel } from './components/panels/TopicModelingResultsPanel';
import { useTopicModelingTaskFlow } from './hooks/useTopicModelingTaskFlow';
import { useTopicModelingZoomBrush } from './hooks/useTopicModelingZoomBrush';
import { useTopicModelingBubbleChart } from './hooks/useTopicModelingBubbleChart';
interface TopicModelingTopic { id: number; label: string; size: number[]; total_size: number; x: number; y: number; }
interface TopicModelingResponse { state?: 'running' | 'successful' | 'failed' | 'cancelled'; message?: string; data?: { topics: TopicModelingTopic[]; corpus_sizes?: number[] }; metadata?: { task_id?: string; [k: string]: any } }

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
      }
    | null;
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'topic-modeling';
  const setTasks = useAnalysisStore((state: any) => state.setTasks);
  const [error, setError] = useState<string | null>(null);
  const [result, resultRef, setResultSafely] = useSafeResult<TopicModelingResponse>();
  
  const [minTopicSize, setMinTopicSize] = useState(10);
  const [hoveredTopicId, setHoveredTopicId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{x:number;y:number; topic: TopicModelingTopic | null; containerW: number; containerH: number}>({x:0,y:0,topic:null,containerW:0,containerH:0});
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
    setLocalTaskId: _setLocalTaskId,
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
      const req = (requestPayload as any)?.data ?? requestPayload;
      if (!req) return;
      const nodeIds: string[] = Array.isArray(req.node_ids) ? req.node_ids.slice(0, 2) : [];
      const node_columns: Record<string, string> = req.node_columns || {};
      const sels = nodeIds.map((id: string) => ({ nodeId: id, column: node_columns[id] || '' }));
      setNodeColumnSelections(sels, { replace: true });
      setMinTopicSize(Number(req.min_topic_size ?? 10));
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
      setTasks((prev: any[]) => Array.isArray(prev) ? pruneTasksById(prev, taskIds) : prev),
    getExtraTaskIdCandidates: () => [(resultRef.current as any)?.metadata?.task_id],
    getClearTaskIdSources: () => [(resultRef.current as any)?.metadata?.task_id],
    isResultRunning: (r) => r?.state === 'running',
  });

  const handleClear = useCallback(async () => {
    setIsClearing(true);
    await clearResults();
    setSelectedTopicIds(new Set());
    setTopicSearchQuery('');
    setIsClearing(false);
  }, [clearResults]);

  const handleToggleTopicSelection = useCallback((id: number) => {
    setSelectedTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleClearTopicSelection = useCallback(() => {
    setSelectedTopicIds(new Set());
  }, []);

  const topicRunningTask = taskStatus.runningTask;
  const panelNodeIds = panelSelectedNodes
    .slice(0, 2)
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
    activeNodeIds: panelNodeIds.slice(0, 2),
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
      min_topic_size: Number(minTopicSize),
    },
    getServerParams: (request) => ({
      min_topic_size: Number(request.min_topic_size),
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
  }, [isLocked, panelNodeIdsKey, nodeColumnSelections.length, recomputeAutoColumns]);

  const handleColumnChange = (nodeId: string, column: string) => {
    if (isLocked) return;
    setNodeColumnSelection(nodeId, column);
  };

  const {
    handleRun,
    openDetachDialog,
    toggleDetachColumn,
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
      panelSelectedNodes,
      panelHasMissingColumns,
      effectiveNodeColumnSelections,
      minTopicSize,
      selectedTopicIds,
    },
    actions: {
      setIsRunning,
      runningRef,
      setError,
      setResultSafely,
      lastFetchedRef,
      resolveTopicModelingTaskId: resolveTaskId,
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
    panelNodeIds,
    nodeColors,
    defaultPalette,
    selectedTopicIds,
    onToggleTopicSelection: handleToggleTopicSelection,
    topicSearchQuery,
    handleResetZoom,
  });

  const shouldShowResultsPanel = Boolean(topicWaitingBanner || result || error);

  return (
    <div className="space-y-6">
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
        minTopicSize={minTopicSize}
        onMinTopicSizeChange={setMinTopicSize}
        isRunning={isRunning}
        isClearing={isClearing}
        onRun={handleRun}
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
          detachDialogOpen={detachDialogOpen}
          setDetachDialogOpen={setDetachDialogOpen}
          detachNodeOptions={detachNodeOptions}
          selectedDetachColumns={selectedDetachColumns}
          toggleDetachColumn={toggleDetachColumn}
          handleDetachConfirm={handleDetachConfirm}
        />
      )}
      </div>
  );
};

export default TopicModelingFeature;
