import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useAuth } from '../../../hooks/useAuth';
// Updated to use modular API object pattern
import { textApi } from '../../../api/text';
import { useAnalysisStore } from '../../../stores/analysisStore';
import { useUIStore } from '../../../stores';
import useNodeColumnInfos from '../../../hooks/useNodeColumnInfos';
import { useQueryClient } from '@tanstack/react-query';
import type { AnalysisTaskStatus } from '../../../hooks/useAnalysisTaskStatus';
import useAnalysisTaskLifecycle, { type AnalysisTaskRefreshContext } from '../../../hooks/useAnalysisTaskLifecycle';
import { getAnalysisActionState } from '../common/analysisActionState';
import {
  getNodeIdentifier,
  restoreAnalysisLockFromRequest,
  useAnalysisHydration,
  useAnalysisLockMachine,
  useColorStackAllocator,
} from '../common';
import { resolveAnalysisTaskId } from '../../../hooks/analysisTaskUtils';
import { TopicModelingParameterPanel } from './components/panels/TopicModelingParameterPanel';
import { TopicModelingResultsPanel } from './components/panels/TopicModelingResultsPanel';
import { useTopicModelingTaskFlow } from './hooks/useTopicModelingTaskFlow';
import { useTopicModelingZoomBrush } from './hooks/useTopicModelingZoomBrush';
import { useTopicModelingBubbleChart } from './hooks/useTopicModelingBubbleChart';
interface TopicModelingTopic { id: number; label: string; size: number[]; total_size: number; x: number; y: number; }
interface TopicModelingResponse { state?: 'running' | 'successful' | 'failed' | 'cancelled'; message?: string; data?: { topics: TopicModelingTopic[]; corpus_sizes?: number[] }; metadata?: { task_id?: string; [k: string]: any } }

const DEFAULT_PALETTE = ['#2563eb','#dc2626','#16a34a','#9333ea','#0d9488','#db2777'];

const TopicModelingFeature: React.FC = () => {
  const { selectedNodes } = useWorkspaceSelection();
  const { currentWorkspaceId } = useWorkspaceData();
  const { getAuthHeaders } = useAuth();
  const queryClient = useQueryClient();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'topic-modeling';
  const setTasks = useAnalysisStore((state: any) => state.setTasks);
  const [isRunning, setIsRunning] = useState(false);
  const {
    isLocked,
    setIsLocked,
    lockWithSnapshots,
    unlockSelection,
    nodeColumnSelections,
    setNodeColumnSelection,
    setNodeColumnSelections,
    recomputeAutoColumns,
    activeNodeIds,
    activeNodeColumnSelections,
    panelSelectedNodes,
  } = useAnalysisLockMachine({
    allowedDataTypes: ['string'],
    maxNodes: 2,
    docTypeOnly: true,
    enableHeuristicGuess: false,
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
  });
  const runningRef = useRef<boolean>(false);
  const fetchingTaskIdRef = useRef<string | null>(null); // Prevent duplicate inflight requests
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TopicModelingResponse | null>(null);
  const resultRef = useRef<TopicModelingResponse | null>(null); // Track result to prevent downgrades
  const [localTopicModelingTaskId, setLocalTopicModelingTaskId] = useState<string | null>(null);
  
  // Safe setResult wrapper that prevents downgrades from successful to running
  const setResultSafely = (newResult: TopicModelingResponse | null) => {
    // Prevent downgrading from successful to running (race condition fix)
    if (resultRef.current?.state === 'successful' && newResult?.state === 'running') {
      return;
    }

    setResult(newResult);
    resultRef.current = newResult;
  };
  
  const [minTopicSize, setMinTopicSize] = useState(10);
  const [useCtTfidf, setUseCtTfidf] = useState(true);
  const [manualColors, setManualColors] = useState<Record<string,string>>({});
  const [hoveredTopicId, setHoveredTopicId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{x:number;y:number; topic: TopicModelingTopic | null}>({x:0,y:0,topic:null});
  const containerRef = useRef<HTMLDivElement | null>(null); // overall card
  const chartRef = useRef<HTMLDivElement | null>(null); // chart area
  const [chartWidth, setChartWidth] = useState<number>(800);
  const lastFetchedRef = useRef<{ taskId: string | null; state: 'successful' | 'failed' | null }>({ taskId: null, state: null });
  useEffect(() => {
    lastFetchedRef.current = { taskId: null, state: null };
    setLocalTopicModelingTaskId(null);
  }, [currentWorkspaceId]);

  const resolveTopicModelingTaskId = useCallback(async (): Promise<string | null> => {
    if (!currentWorkspaceId) return null;

    return resolveAnalysisTaskId({
      candidateIds: [
        localTopicModelingTaskId,
        (resultRef.current as any)?.metadata?.task_id,
        topicTaskStatus.activeTaskId,
        topicRunningTask?.task_id,
        topicTaskStatus.queuedTask?.task_id,
        topicTaskStatus.terminalTask?.task_id,
      ],
      fetchCurrentTaskId: async () => {
        const headers = getAuthHeaders();
        const current = (await textApi.getAnalysisCurrent(
          'topic_modeling',
          headers
        )) as any;
        const taskId = Array.isArray(current?.task_ids) ? current.task_ids[0] : null;
        return typeof taskId === 'string' && taskId.trim().length > 0 ? taskId : null;
      },
      onResolved: setLocalTopicModelingTaskId,
    });
  }, [currentWorkspaceId, localTopicModelingTaskId, getAuthHeaders]);

  const fetchTopicModelingResult = useCallback(async (taskId: string | null, expectedState: 'successful' | 'failed') => {
    if (!isActiveTab) return;
    if (!currentWorkspaceId) return;
    const resolvedTaskId = taskId ?? await resolveTopicModelingTaskId();
    if (!resolvedTaskId) return;
    
    // Prevent duplicate fetching if already executing for this ID
    if (fetchingTaskIdRef.current === resolvedTaskId) {
      return;
    }

    if (
      lastFetchedRef.current.taskId === resolvedTaskId &&
      lastFetchedRef.current.state === expectedState
    ) {
      return;
    }

    try {
      fetchingTaskIdRef.current = resolvedTaskId;
      const rr = await textApi.getTopicModelingTaskResult(resolvedTaskId, getAuthHeaders());
      if (!rr) return;

      // Ensure lock snapshot + node-column selections are restored from task request,
      // so Topic Modeling matches other tabs on tab re-entry.
      try {
        const reqPayload = await textApi.getTaskRequest(resolvedTaskId, getAuthHeaders());
        const req = (reqPayload as any)?.data ?? reqPayload;
        const nodeIds: string[] = Array.isArray(req?.node_ids)
          ? req.node_ids
              .slice(0, 2)
              .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
          : [];
        const nodeColumns: Record<string, string> =
          req?.node_columns && typeof req.node_columns === 'object'
            ? req.node_columns
            : {};

        if (nodeIds.length) {
          setNodeColumnSelections(
            nodeIds.map((nodeId) => ({ nodeId, column: nodeColumns[nodeId] || '' })),
            { replace: true }
          );
          await restoreAnalysisLockFromRequest({
            workspaceId: currentWorkspaceId,
            requestData: req,
            getAuthHeaders,
            lockWithSnapshots,
            maxNodes: 2,
          });
        }
      } catch {
        /* best effort restore */
      }

      const processedResult = rr as TopicModelingResponse;

      setResultSafely(processedResult);

      if (processedResult.state === 'successful') {
        setIsLocked(true);
        setIsRunning(false);
        runningRef.current = false;
        setError(null);
        lastFetchedRef.current = { taskId: resolvedTaskId ?? null, state: 'successful' };
      } else if (processedResult.state === 'failed') {
        setIsLocked(true);
        setIsRunning(false);
        runningRef.current = false;
        setError(processedResult.message || 'Topic modeling failed');
        lastFetchedRef.current = { taskId: resolvedTaskId ?? null, state: 'failed' };
      }
    } catch (error) {
      console.warn('Failed to fetch topic modeling result', error);
    } finally {
      fetchingTaskIdRef.current = null;
    }
  }, [isActiveTab, currentWorkspaceId, resolveTopicModelingTaskId, getAuthHeaders, setIsLocked]);

  const topicFallbackBanner = (status: AnalysisTaskStatus) => {
    if (result?.state !== 'running') {
      return null;
    }
    return {
      taskId: (result as any)?.metadata?.task_id ?? status.activeTaskId ?? null,
      message: status.bannerMessage?.trim() || undefined,
    };
  };

  const handleTopicTaskRefresh = useCallback(async (context: AnalysisTaskRefreshContext) => {
    if (context.reason !== 'terminal') {
      return;
    }
    if (!isActiveTab) {
      return;
    }
    if (context.taskState !== 'successful' && context.taskState !== 'failed') {
      return;
    }
    await fetchTopicModelingResult(context.taskId ?? null, context.taskState);
  }, [isActiveTab, fetchTopicModelingResult]);

  const {
    status: topicTaskStatus,
    banner: topicWaitingBanner,
  } = useAnalysisTaskLifecycle({
    taskType: 'topic_modeling',
    isTabActive: isActiveTab,
    workspaceId: currentWorkspaceId,
    fallbackRunningBanner: topicFallbackBanner,
    onRefresh: handleTopicTaskRefresh,
  });

  const topicModelingTasks = topicTaskStatus.tasks;
  const topicRunningTask = topicTaskStatus.runningTask;
  const topicSuccessfulTask = topicTaskStatus.successfulTask;
  const topicFailedTask = topicTaskStatus.failedTask;
  const hasActiveTask = Boolean(
    topicTaskStatus.activeTaskId ||
    topicRunningTask?.task_id ||
    topicTaskStatus.queuedTask?.task_id ||
    topicTaskStatus.terminalTask?.task_id ||
    topicTaskStatus.tasks.length > 0
  );

  const panelNodeIds = panelSelectedNodes
    .slice(0, 2)
    .map((node, idx) => getNodeIdentifier(node, idx) || activeNodeIds[idx])
    .filter((id): id is string => Boolean(id));
  const panelNodeIdsKey = panelNodeIds.join('|');
  const actionState = getAnalysisActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    hasSelection: panelNodeIds.length > 0,
    isLocked,
    hasResults: Boolean(result),
    isBusy: isRunning,
    hasActiveTask,
  });

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
  const stackPalette = React.useMemo(() => DEFAULT_PALETTE.slice(0, 6), []);

  // Use stack-based allocator for automatic color assignment
  const stackActiveNodeIds = panelNodeIds.slice(0, 2); // Topic modeling uses first 2 nodes from panel
  const { nodeColors: stackColors } = useColorStackAllocator({
    colors: stackPalette, // Use first six palette colors in stack order
    activeNodeIds: stackActiveNodeIds,
  });
  // Merge stack-allocated and manually set colors
  const nodeColors = React.useMemo(() => {
    const merged: Record<string, string> = {};
    // Start with stack-allocated colors
    Object.entries(stackColors).forEach(([id, color]) => {
      merged[id] = color;
    });
    // Override with manual selections
    Object.entries(manualColors).forEach(([id, color]) => {
      if (stackActiveNodeIds.includes(id)) {
        merged[id] = color;
      }
    });
    // Fallback for overflow (>6 nodes)
    panelNodeIds.forEach((id, index) => {
      if (!merged[id]) {
        merged[id] = DEFAULT_PALETTE[index % DEFAULT_PALETTE.length];
      }
    });
    return merged;
  }, [stackColors, manualColors, stackActiveNodeIds, panelNodeIds]);

  const effectiveNodeColumnSelections = isLocked ? activeNodeColumnSelections : nodeColumnSelections;

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
  });

  const panelHasMissingColumns = panelNodeIds.some((nodeId) => {
    const selection = effectiveNodeColumnSelections.find((sel) => sel.nodeId === nodeId);
    return !selection || !selection.column;
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
  const handleColorChange = (nodeId: string, color: string) => setManualColors(p=>({...p,[nodeId]:color}));

  const {
    handleRun,
    handleClear,
    openDetachDialog,
    toggleDetachColumn,
    handleDetachConfirm,
    isClearing,
    isDetachLoading,
    isDetaching,
    detachDialogOpen,
    setDetachDialogOpen,
    detachNodeOptions,
    selectedDetachColumns,
  } = useTopicModelingTaskFlow({
    currentWorkspaceId,
    panelNodeIds,
    panelSelectedNodes,
    panelHasMissingColumns,
    effectiveNodeColumnSelections,
    minTopicSize,
    useCtTfidf,
    getAuthHeaders,
    lockWithSnapshots,
    setIsLocked,
    setIsRunning,
    runningRef,
    setError,
    setResultSafely,
    result,
    localTopicModelingTaskId,
    setLocalTopicModelingTaskId,
    topicTaskStatus,
    topicRunningTask,
    topicSuccessfulTask,
    topicFailedTask,
    unlockSelection,
    setNodeColumnSelections,
    recomputeAutoColumns,
    setTasks,
    lastFetchedRef,
    resolveTopicModelingTaskId,
    queryClient,
  });

  const topics: TopicModelingTopic[] = result?.data?.topics || [];
  const corpusCount = result?.data?.corpus_sizes?.length || 0;
  const chartPadding = 40;
  const chartHeight = React.useMemo(
    () => Math.min(520, Math.max(320, Math.round(chartWidth * 0.55))),
    [chartWidth]
  );

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
  });

  const applyHydratedRequest = async (requestPayload: unknown) => {
    const req = (requestPayload as any)?.data ?? requestPayload;
    if (!req) return;

    const nodeIds: string[] = Array.isArray(req.node_ids) ? req.node_ids.slice(0,2) : [];
    const node_columns: Record<string,string> = req.node_columns || {};
    const sels = nodeIds.map((id: string) => ({ nodeId: id, column: node_columns[id] || '' }));
    setNodeColumnSelections(sels, { replace: true });
    setMinTopicSize(Number(req.min_topic_size ?? 10));
    setUseCtTfidf(req.use_ctfidf === undefined ? true : !!req.use_ctfidf);

    if (nodeIds.length && currentWorkspaceId) {
      try {
        await restoreAnalysisLockFromRequest({
          workspaceId: currentWorkspaceId,
          requestData: req,
          getAuthHeaders,
          lockWithSnapshots,
          maxNodes: 2,
        });
      } catch {
        /* ignore snapshot failures */
      }
    }
  };

  const applyHydratedResult = async (resultPayload: unknown) => {
    if (!resultPayload) return;
    const resStatus = (resultPayload as any)?.state;
    setResultSafely(resultPayload as any);
    setIsLocked(true);

    if (resStatus === 'running') {
      if (!resultRef.current || resultRef.current.state !== 'successful') {
        runningRef.current = true;
        setIsRunning(true);
      }
    } else if (resStatus === 'failed') {
      runningRef.current = false;
      setIsRunning(false);
    } else if (resStatus === 'successful') {
      runningRef.current = false;
      setIsRunning(false);
      setError(null);
    }
  };

  const fetchTopicRequest = async (taskId?: string | null) => {
    if (!currentWorkspaceId || !taskId) return null;
    return textApi.getTaskRequest(taskId, getAuthHeaders());
  };

  const fetchTopicResult = async (taskId?: string | null) => {
    if (!currentWorkspaceId || !taskId) return null;
    return textApi.getTopicModelingTaskResult(taskId, getAuthHeaders());
  };

  const { hydrateFromServer } = useAnalysisHydration({
    workspaceId: currentWorkspaceId,
    analysisKey: 'topic_modeling',
    getAuthHeaders,
    onTaskIdResolved: setLocalTopicModelingTaskId,
    fetchRequest: fetchTopicRequest,
    fetchResult: fetchTopicResult,
    applyRequest: applyHydratedRequest,
    applyResult: applyHydratedResult,
    autoHydrateOnFocus: false,
    autoHydrateOnVisibility: false,
  });

  const hydratedOnceRef = useRef<boolean>(false);
  useEffect(() => {
    hydratedOnceRef.current = false;
  }, [currentWorkspaceId]);
  useEffect(() => {
    if (!isActiveTab || !currentWorkspaceId || hydratedOnceRef.current) return;
    hydratedOnceRef.current = true;
    void hydrateFromServer();
  }, [currentWorkspaceId, hydrateFromServer, isActiveTab]);

  // React to task state changes for running state management
  useEffect(() => {
    if (!topicModelingTasks.length) {
      if (runningRef.current) {
        setIsRunning(false);
        runningRef.current = false;
      }
      return;
    }

    if (topicRunningTask) {
      setIsLocked(true);
      setIsRunning(true);
      runningRef.current = true;
    } else if (!topicFailedTask) {
      if (runningRef.current) {
        setIsRunning(false);
        runningRef.current = false;
      }
    }

    if (topicSuccessfulTask?.task_id) {
      setIsLocked(true);
      setIsRunning(false);
      runningRef.current = false;
      void fetchTopicModelingResult(topicSuccessfulTask.task_id, 'successful');
    } else if (topicFailedTask?.task_id) {
      setIsLocked(true);
      setIsRunning(false);
      runningRef.current = false;
      void fetchTopicModelingResult(topicFailedTask.task_id, 'failed');
    }
  }, [
    topicModelingTasks,
    topicRunningTask,
    topicSuccessfulTask,
    topicFailedTask,
    fetchTopicModelingResult,
    setIsLocked,
  ]);

  // If result failed, keep the panel locked and run disabled until cleared
  useEffect(() => {
  if (result && result.state === 'failed') {
      setIsLocked(true);
      setIsRunning(false);
      runningRef.current = false;
    }
  }, [result, setIsLocked]);

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
        useCtTfidf={useCtTfidf}
        onUseCtTfidfChange={setUseCtTfidf}
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
