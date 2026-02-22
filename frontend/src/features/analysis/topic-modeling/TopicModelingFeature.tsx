import React, { useCallback, useEffect, useRef, useState } from 'react';
import NodeSelectionPanel from '../../../components/NodeSelectionPanel';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useAuth } from '../../../hooks/useAuth';
// Updated to use modular API object pattern
import { textApi } from '../../../api/text';
import type { TopicModelingRequest } from '../../../api/text';
import { workspacesApi } from '../../../api/workspaces';
import { useAnalysisStore } from '../../../stores/analysisStore';
import { useUIStore } from '../../../stores';
import useNodeColumnInfos from '../../../hooks/useNodeColumnInfos';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { Input } from '../../../components/ui/input';
import { Checkbox } from '../../../components/ui/checkbox';
import HelpIcon from '../../../components/help/HelpIcon';
import { AlertTriangle, Loader2, Play, Scan, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../lib/queryKeys';
import { applySelectedColumnsToSnapshots } from '../../../hooks/useSchemaManagement';
import { ANALYSIS_LOCKED_MESSAGE } from '../../../components/tabs/AnalysisLockedNotice';
import AnalysisTaskBanner from '../../../components/tabs/AnalysisTaskBanner';
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
import {
  clearAnalysisTaskArtifacts,
  collectTaskIds,
  pruneTasksById,
  resolveAnalysisTaskId,
} from '../../../hooks/analysisTaskUtils';
import type {
  TopicModelingDetachNodeOption,
  TopicModelingDetachRequest,
} from '../../../api/text';
interface TopicModelingTopic { id: number; label: string; size: number[]; total_size: number; x: number; y: number; }
interface TopicModelingResponse { state?: 'running' | 'successful' | 'failed' | 'cancelled'; message?: string; data?: { topics: TopicModelingTopic[]; corpus_sizes?: number[] }; metadata?: { task_id?: string; [k: string]: any } }
interface ZoomDomain { xMin: number; xMax: number; yMin: number; yMax: number; }
interface BrushRect { startX: number; startY: number; currentX: number; currentY: number; }

// Simple linear gradient between two colors given t in [0,1]
function interpolateColor(c1: string, c2: string, t: number) {
  const parse = (c: string) => c.replace('#','').match(/.{2}/g)!.map(x=>parseInt(x,16));
  const [r1,g1,b1] = parse(c1); const [r2,g2,b2] = parse(c2);
  const r = Math.round(r1 + (r2-r1)*t); const g = Math.round(g1 + (g2-g1)*t); const b = Math.round(b1 + (b2-b1)*t);
  return `rgb(${r}, ${g}, ${b})`;
}

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
    displayNodeCount,
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
  const [isClearing, setIsClearing] = useState(false);
  const [hoveredTopicId, setHoveredTopicId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{x:number;y:number; topic: TopicModelingTopic | null}>({x:0,y:0,topic:null});
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [isDetachLoading, setIsDetachLoading] = useState(false);
  const [isDetaching, setIsDetaching] = useState(false);
  const [zoomDomain, setZoomDomain] = useState<ZoomDomain | null>(null);
  const [brushRect, setBrushRect] = useState<BrushRect | null>(null);
  const [isBrushing, setIsBrushing] = useState(false);
  const [detachNodeOptions, setDetachNodeOptions] = useState<TopicModelingDetachNodeOption[]>([]);
  const [selectedDetachColumns, setSelectedDetachColumns] = useState<Record<string, string[]>>({});
  const containerRef = useRef<HTMLDivElement | null>(null); // overall card
  const chartRef = useRef<HTMLDivElement | null>(null); // chart area
  const chartSvgRef = useRef<SVGSVGElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
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

  const handleRun = async () => {
    if (!currentWorkspaceId || panelNodeIds.length === 0) return;
    if (runningRef.current) return; // guard double click
    if (panelHasMissingColumns) {
      toast.error('Select a text column for all selected data blocks');
      return;
    }
  const requestNodeIds = panelNodeIds.slice(0, 2);
    lastFetchedRef.current = { taskId: null, state: null };
    // Optimistically enter running state immediately
    setIsRunning(true);
    runningRef.current = true;
    setError(null);
    setResultSafely(null);
    try {
      const node_columns: Record<string, string> = {};
      effectiveNodeColumnSelections.forEach((selection) => {
        if (selection.column && requestNodeIds.includes(selection.nodeId)) {
          node_columns[selection.nodeId] = selection.column;
        }
      });

      // Lock snapshot immediately (synchronous, no network) so parameter panel
      // remains stable even if workspace selection changes while the task runs.
      const snapshotById = new Map<string, { id: string; name: string; columns: string[] }>(
        panelSelectedNodes
          .filter((node): node is typeof node & { id: string } => typeof node.id === 'string' && node.id.length > 0)
          .map((node) => [
            node.id,
            {
              id: node.id,
              name: String(node.name || node.id),
              columns: Array.isArray(node.columns)
                ? node.columns.filter((col): col is string => typeof col === 'string')
                : [],
            },
          ])
      );
      const lockSnapshots = requestNodeIds.map((id) => snapshotById.get(id) || {
        id,
        name: id,
        columns: [],
      });
      const normalizedSnapshots = applySelectedColumnsToSnapshots(lockSnapshots, node_columns);
      lockWithSnapshots(normalizedSnapshots);
      setIsLocked(true);

      const req: TopicModelingRequest = {
        node_ids: requestNodeIds,
        node_columns,
        min_topic_size: minTopicSize,
        use_ctfidf: useCtTfidf,
      };

      const res = await textApi.topicModeling(req, getAuthHeaders());
      setResultSafely(res);

      if (res.state === 'running') {
        // already locked above
        // SSE will provide task updates automatically, no need to manually fetch
      } else if (res.state === 'failed') {
        // Immediate failure (validation etc.)
        setIsRunning(false);
        runningRef.current = false;
        setIsLocked(false);
      }

      if (res.state !== 'successful' && res.state !== 'running') {
        setError(res.message || 'Topic modeling failed');
      }

    } catch (e:any) {
      setError(e?.message || 'Error running topic modeling');
      // Exit running state on error
      setIsRunning(false);
      runningRef.current = false;
    }
  };

  const openDetachDialog = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const taskId = await resolveTopicModelingTaskId();
    if (!taskId) {
      toast.error('No topic modeling task available for detach');
      return;
    }

    try {
      setIsDetachLoading(true);
      const resp = await textApi.getTopicModelingDetachOptions(taskId, getAuthHeaders());
      const nodes = resp?.data?.nodes ?? [];
      setDetachNodeOptions(nodes);
      const initialSelections: Record<string, string[]> = {};
      nodes.forEach((node) => {
        initialSelections[node.node_id] = (node.available_columns || []).filter(
          (col) => !(node.disabled_columns || []).includes(col)
        );
      });
      setSelectedDetachColumns(initialSelections);
      setDetachDialogOpen(true);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load topic detach options');
    } finally {
      setIsDetachLoading(false);
    }
  }, [currentWorkspaceId, getAuthHeaders, resolveTopicModelingTaskId]);

  const toggleDetachColumn = useCallback((nodeId: string, column: string, checked: boolean) => {
    setSelectedDetachColumns((prev) => {
      const current = new Set(prev[nodeId] || []);
      if (checked) {
        current.add(column);
      } else {
        current.delete(column);
      }
      return { ...prev, [nodeId]: Array.from(current) };
    });
  }, []);

  const handleDetachConfirm = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const taskId = await resolveTopicModelingTaskId();
    if (!taskId) {
      toast.error('No topic modeling task available for detach');
      return;
    }

    const nodeIds = detachNodeOptions.map((n) => n.node_id);
    const hasSelections = nodeIds.every((nodeId) => (selectedDetachColumns[nodeId] || []).length > 0);
    if (!hasSelections) {
      toast.error('Please select at least one column for each node');
      return;
    }

    try {
      setIsDetaching(true);
      const payload: TopicModelingDetachRequest = {
        node_ids: nodeIds,
        selected_columns: selectedDetachColumns,
      };
      const resp = await textApi.topicModelingDetach(taskId, payload, getAuthHeaders());
      if (resp?.state !== 'successful') {
        throw new Error(resp?.message || 'Topic detach failed');
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceNodes(currentWorkspaceId) }),
      ]);

      setDetachDialogOpen(false);
      toast.success('Detached topic node(s) created');
    } catch (e: any) {
      toast.error(e?.message || 'Topic detach failed');
    } finally {
      setIsDetaching(false);
    }
  }, [currentWorkspaceId, detachNodeOptions, getAuthHeaders, queryClient, resolveTopicModelingTaskId, selectedDetachColumns]);

  const topics: TopicModelingTopic[] = result?.data?.topics || [];
  const corpusCount = result?.data?.corpus_sizes?.length || 0;
  const chartPadding = 40;
  const chartHeight = React.useMemo(
    () => Math.min(520, Math.max(320, Math.round(chartWidth * 0.55))),
    [chartWidth]
  );

  const fullDomain = React.useMemo<ZoomDomain | null>(() => {
    if (!topics.length) return null;
    const xs = topics.map((t) => t.x);
    const ys = topics.map((t) => t.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const epsilon = 1e-6;
    return {
      xMin,
      xMax: xMax === xMin ? xMin + epsilon : xMax,
      yMin,
      yMax: yMax === yMin ? yMin + epsilon : yMax,
    };
  }, [topics]);

  const activeDomain = zoomDomain ?? fullDomain;

  useEffect(() => {
    if (!fullDomain) {
      setZoomDomain(null);
      return;
    }
    setZoomDomain(fullDomain);
  }, [fullDomain]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, []);

  const animateDomainTo = useCallback((target: ZoomDomain) => {
    const start = activeDomain ?? target;
    if (animationFrameRef.current != null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const startAt = performance.now();
    const durationMs = 260;
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const step = (now: number) => {
      const raw = (now - startAt) / durationMs;
      const t = Math.max(0, Math.min(1, raw));
      const e = easeOutCubic(t);
      setZoomDomain({
        xMin: start.xMin + (target.xMin - start.xMin) * e,
        xMax: start.xMax + (target.xMax - start.xMax) * e,
        yMin: start.yMin + (target.yMin - start.yMin) * e,
        yMax: start.yMax + (target.yMax - start.yMax) * e,
      });
      if (t < 1) {
        animationFrameRef.current = requestAnimationFrame(step);
      } else {
        setZoomDomain(target);
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = requestAnimationFrame(step);
  }, [activeDomain]);

  const toSvgPoint = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    const svg = chartSvgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);

  const handleBrushStart = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !activeDomain) return;
    const point = toSvgPoint(event);
    if (!point) return;
    setIsBrushing(true);
    setTooltip((t) => ({ ...t, topic: null }));
    setHoveredTopicId(null);
    setBrushRect({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    });
  }, [activeDomain, toSvgPoint]);

  const handleBrushMove = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    if (!isBrushing) return;
    const point = toSvgPoint(event);
    if (!point) return;
    setBrushRect((prev) => (prev ? { ...prev, currentX: point.x, currentY: point.y } : prev));
  }, [isBrushing, toSvgPoint]);

  const handleBrushEnd = useCallback(() => {
    if (!isBrushing || !brushRect || !activeDomain) {
      setIsBrushing(false);
      setBrushRect(null);
      return;
    }

    const x0 = Math.min(brushRect.startX, brushRect.currentX);
    const x1 = Math.max(brushRect.startX, brushRect.currentX);
    const y0 = Math.min(brushRect.startY, brushRect.currentY);
    const y1 = Math.max(brushRect.startY, brushRect.currentY);

    setIsBrushing(false);
    setBrushRect(null);

    if (x1 - x0 < 8 || y1 - y0 < 8) {
      return;
    }

    const innerWidth = Math.max(1, chartWidth - 2 * chartPadding);
    const innerHeight = Math.max(1, chartHeight - 2 * chartPadding);
    const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

    const invX = (px: number) => {
      const t = clamp((px - chartPadding) / innerWidth, 0, 1);
      return activeDomain.xMin + t * (activeDomain.xMax - activeDomain.xMin);
    };
    const invY = (py: number) => {
      const t = clamp((py - chartPadding) / innerHeight, 0, 1);
      return activeDomain.yMin + t * (activeDomain.yMax - activeDomain.yMin);
    };

    const nx0 = invX(x0);
    const nx1 = invX(x1);
    const ny0 = invY(y0);
    const ny1 = invY(y1);

    const epsilon = 1e-6;
    animateDomainTo({
      xMin: Math.min(nx0, nx1),
      xMax: Math.max(nx0, nx1) + epsilon,
      yMin: Math.min(ny0, ny1),
      yMax: Math.max(ny0, ny1) + epsilon,
    });
  }, [activeDomain, animateDomainTo, brushRect, chartHeight, chartWidth, isBrushing]);

  const handleResetZoom = useCallback(() => {
    if (!fullDomain) return;
    animateDomainTo(fullDomain);
  }, [animateDomainTo, fullDomain]);

  const isAtGlobalZoom = React.useMemo(() => {
    if (!fullDomain || !activeDomain) return true;
    const eps = 1e-6;
    return (
      Math.abs(activeDomain.xMin - fullDomain.xMin) < eps &&
      Math.abs(activeDomain.xMax - fullDomain.xMax) < eps &&
      Math.abs(activeDomain.yMin - fullDomain.yMin) < eps &&
      Math.abs(activeDomain.yMax - fullDomain.yMax) < eps
    );
  }, [activeDomain, fullDomain]);

  const fallbackPrimaryColor = defaultPalette[0] ?? '#2563eb';
  const fallbackSecondaryColor = defaultPalette[1] ?? '#dc2626';

  const getPanelColor = (index: number, fallback: string) => {
    const nodeId = panelNodeIds[index];
    if (nodeId) {
      return nodeColors[nodeId] || defaultPalette[index] || fallback;
    }
    return fallback;
  };

  // Helpers to render colored size boxes
  const getReadableTextColor = (hex: string) => {
    if(!hex) return '#ffffff';
    const c = hex.replace('#','');
    if (c.length !== 6) return '#ffffff';
    const r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16);
    // luminance
    const l = 0.2126*r + 0.7152*g + 0.0722*b;
    return l > 160 ? '#1e293b' : '#ffffff';
  };
  const renderSizeComposition = (sizes: number[], total: number) => {
    if (corpusCount === 0) return null;
    if (sizes.length === 1) {
      const color = getPanelColor(0, fallbackPrimaryColor);
      const fg = getReadableTextColor(color);
      return (
        <span className="inline-flex items-center gap-1">
          <span style={{ background: color, color: fg }} className="px-1.5 py-0.5 rounded text-[10px] font-medium">{sizes[0]}</span>
          <span className="text-[10px] text-gray-500">= {total}</span>
        </span>
      );
    }
    // Two corpora: show N + M = Z boxes with colors
    const colorA = getPanelColor(0, fallbackPrimaryColor);
    const colorB = getPanelColor(1, fallbackSecondaryColor);
    const fgA = getReadableTextColor(colorA);
    const fgB = getReadableTextColor(colorB);
    return (
      <span className="inline-flex items-center gap-1 flex-wrap">
        <span style={{ background: colorA, color: fgA }} className="px-1.5 py-0.5 rounded text-[10px] font-medium">{sizes[0]}</span>
        <span className="text-[10px] text-gray-500">+</span>
        <span style={{ background: colorB, color: fgB }} className="px-1.5 py-0.5 rounded text-[10px] font-medium">{sizes[1]}</span>
        <span className="text-[10px] text-gray-500">= {total}</span>
      </span>
    );
  };

  // Layout bubbles simply using returned coordinates scaled
  const bubbleElements = (() => {
    if(!topics.length || !activeDomain) return null;
    const width=chartWidth;
    const height=chartHeight;
    const scaleX = (x:number)=> ( (x - activeDomain.xMin)/(activeDomain.xMax-activeDomain.xMin || 1) )*(width-2*chartPadding)+chartPadding;
    const scaleY = (y:number)=> ( (y - activeDomain.yMin)/(activeDomain.yMax-activeDomain.yMin || 1) )*(height-2*chartPadding)+chartPadding;
    const maxSize = Math.max(...topics.map(t=>t.total_size));
    const brushDisplay = brushRect
      ? {
          x: Math.min(brushRect.startX, brushRect.currentX),
          y: Math.min(brushRect.startY, brushRect.currentY),
          width: Math.abs(brushRect.currentX - brushRect.startX),
          height: Math.abs(brushRect.currentY - brushRect.startY),
        }
      : null;
    return (
      <svg
        ref={chartSvgRef}
        width={width}
        height={height}
        className="border rounded bg-white block w-full"
        role="img"
        aria-label="Topic bubble chart"
        style={{ cursor: isBrushing ? 'grabbing' : 'crosshair' }}
        onMouseDown={handleBrushStart}
        onMouseMove={handleBrushMove}
        onMouseUp={handleBrushEnd}
        onMouseLeave={()=>{
          if (isBrushing) {
            handleBrushEnd();
            return;
          }
          setHoveredTopicId(null);
          setTooltip(t=>({...t,topic:null}));
        }}
      >
        {topics.map((t)=>{
          const sizes = t.size || [];
            const prop = (corpusCount===2 && (t.total_size>0)) ? (sizes[0]/t.total_size) : 0.5;
            const colorA = getPanelColor(0, fallbackPrimaryColor);
            const colorB = getPanelColor(1, fallbackSecondaryColor);
            const fill = interpolateColor(colorA, colorB, prop);
            const r = 10 + 40 * Math.sqrt(t.total_size / (maxSize || 1));
            const cx = scaleX(t.x); const cy = scaleY(t.y);
            const isHovered = hoveredTopicId === t.id;
            return (
              <g
                key={t.id}
                transform={`translate(${cx},${cy})`}
                onMouseEnter={(e)=>{
                  if (isBrushing) return;
                  setHoveredTopicId(t.id);
                  const bbox = (chartRef.current?.getBoundingClientRect());
                  if (bbox) {
                    setTooltip({
                      x: e.clientX - bbox.left + 12,
                      y: e.clientY - bbox.top + 12,
                      topic: t
                    });
                  }
                }}
                onMouseMove={(e)=>{
                  if (isBrushing) return;
                  if(!chartRef.current) return;
                  const bbox = chartRef.current.getBoundingClientRect();
                  setTooltip(tp=> tp.topic && tp.topic.id===t.id ? { x: e.clientX - bbox.left + 12, y: e.clientY - bbox.top + 12, topic: t } : tp);
                }}
                onMouseLeave={()=>{
                  if (isBrushing) return;
                  setHoveredTopicId(null);
                  setTooltip(tp=> ({...tp, topic:null}));
                }}
              >
                <circle r={r} fill={fill} fillOpacity={isHovered?0.92:0.7} stroke={isHovered? '#1d4ed8':'#334155'} strokeWidth={isHovered?2:1} />
                <text textAnchor="middle" dy={4} fontSize={12} className="pointer-events-none select-none" fill="#1e293b">
                  {`T${t.id}`}
                </text>
              </g>
            );
        })}
        {brushDisplay && (
          <rect
            x={brushDisplay.x}
            y={brushDisplay.y}
            width={brushDisplay.width}
            height={brushDisplay.height}
            fill="rgba(37, 99, 235, 0.12)"
            stroke="rgba(37, 99, 235, 0.8)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}
      </svg>
    );
  })();

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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Topic Modeling (BERTopic)
                <HelpIcon
                  targetKey="analysis.topic-modeling.parameters"
                  label="Topic modeling parameters"
                  tooltip="Choose nodes, topic size, and embedding options before running the model."
                />
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
            <NodeSelectionPanel
              selectedNodes={panelSelectedNodes}
              nodeColumnSelections={effectiveNodeColumnSelections}
              onColumnChange={handleColumnChange}
              nodeColors={nodeColors}
              onColorChange={handleColorChange}
              getNodeColumns={getColumnInfos}
              defaultPalette={defaultPalette}
              maxCompare={2}
              className="border border-dashed border-muted-foreground/40 rounded-lg bg-muted/30 p-4"
              originalCount={displayNodeCount}
              disabled={!!isLocked}
              showShape
              showColorPicker
              locked={!!isLocked}
              allowedDataTypes={['string']}
              lockedMessage={ANALYSIS_LOCKED_MESSAGE}
            />

            <div className="grid gap-4 md:grid-cols-2 md:items-end">
              <div className="space-y-2 md:max-w-xs">
                <div className="flex items-center gap-2">
                  <label htmlFor="minTopicSize" className="text-sm font-medium text-foreground">
                    Min Topic Size
                  </label>
                  <HelpIcon targetKey="analysis.topic-modeling.min-topic-size" label="Minimum topic size" />
                </div>
                <Input
                  id="minTopicSize"
                  type="number"
                  min={2}
                  value={minTopicSize}
                  onChange={e=>setMinTopicSize(parseInt(e.target.value, 10) || 10)}
                  disabled={!!isLocked}
                  className="md:w-40"
                />
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/40 p-3">
                <Checkbox
                  id="useCtTfidf"
                  checked={useCtTfidf}
                  onCheckedChange={checked=>setUseCtTfidf(checked === true)}
                  disabled={!!isLocked}
                />
                <div className="flex items-center gap-2">
                  <label htmlFor="useCtTfidf" className="text-sm leading-tight text-muted-foreground">
                    Use c-TF-IDF embeddings
                  </label>
                  <HelpIcon targetKey="analysis.topic-modeling.ctfidf-toggle" label="c-TF-IDF toggle" />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={handleRun}
                disabled={actionState.runDisabled || panelHasMissingColumns}
              >
                {isRunning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Run Topic Modeling
                  </>
                )}
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full sm:w-auto"
                  onClick={async () => {
                    if (!currentWorkspaceId) return;
                    setIsClearing(true);
                    const taskIds = collectTaskIds([
                      (result as any)?.metadata?.task_id,
                      localTopicModelingTaskId,
                      topicTaskStatus.activeTaskId,
                      topicRunningTask?.task_id,
                      topicSuccessfulTask?.task_id,
                      topicFailedTask?.task_id,
                    ]);
                    try {
                      const headers = getAuthHeaders();
                      const resolvedTaskId = await resolveTopicModelingTaskId();
                      const allTaskIds = collectTaskIds([
                        ...taskIds,
                        resolvedTaskId,
                      ]);

                      await clearAnalysisTaskArtifacts({
                        workspaceId: currentWorkspaceId,
                        taskIds: allTaskIds,
                        cancelTask: (workspaceId, taskId) =>
                          workspacesApi.cancelTasks({ task_id: taskId }, headers),
                        clearManagerTask: (workspaceId, taskId) =>
                          workspacesApi.clearTasks({ task_id: taskId }, headers),
                        clearAnalysisTask: (workspaceId, taskId) =>
                          textApi.clearTask(taskId, headers),
                        warnContext: 'topic-modeling',
                      });
                    } finally {
                      setIsClearing(false);
                      setResultSafely(null);
                      unlockSelection();
                      setIsLocked(false);
                      setIsRunning(false);
                      runningRef.current = false;
                      setLocalTopicModelingTaskId(null);
                      lastFetchedRef.current = { taskId: null, state: null };
                      setNodeColumnSelections([], { replace: true, persist: false });
                      recomputeAutoColumns();
                      setTasks((prev: any[]) =>
                        Array.isArray(prev)
                          ? pruneTasksById(
                              prev,
                              collectTaskIds([
                                (result as any)?.metadata?.task_id,
                                localTopicModelingTaskId,
                                topicTaskStatus.activeTaskId,
                                topicRunningTask?.task_id,
                                topicSuccessfulTask?.task_id,
                                topicFailedTask?.task_id,
                              ])
                            )
                          : prev
                      );
                    }
                  }}
                  disabled={actionState.clearDisabled || isClearing}
                >
                  {isClearing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Clearing…
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Clear Results
                    </>
                  )}
                </Button>
                <HelpIcon targetKey="analysis.topic-modeling.clear-results" label="Clear results" />
              </div>
            </div>

            {error && result?.state !== 'failed' && (
              <p className="text-sm font-medium text-destructive">{error}</p>
            )}
            {result && result.state === 'failed' && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <p>{result.message || 'Topic modeling failed'}</p>
              </div>
            )}
          </CardContent>
        </Card>

          {topicWaitingBanner && (
            <AnalysisTaskBanner
              analysisName="Topic Modeling"
              status={topicWaitingBanner.status}
              taskId={topicWaitingBanner.taskId}
              message={topicWaitingBanner.message}
              className="mt-4"
            />
          )}

        {result && result.state === 'successful' && (
          <Card ref={containerRef}>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Topics ({topics.length})
                  <HelpIcon
                    targetKey="analysis.topic-modeling.results"
                    label="Topic modeling results"
                    tooltip="Explore topics, bubble sizes, and labels; colors blend by the first vs second dataset share."
                  />
                </CardTitle>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => void openDetachDialog()}
                  disabled={isDetachLoading || isDetaching}
                >
                  {isDetachLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading Detach…
                    </>
                  ) : (
                    'Detach'
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative w-full overflow-hidden rounded-lg border border-muted-foreground/30 bg-background" ref={chartRef}>
                <button
                  type="button"
                  className="react-flow__controls-button absolute top-2 right-2 z-20 border border-border bg-white/90"
                  onClick={handleResetZoom}
                  disabled={isAtGlobalZoom}
                  title="Reset zoom to global view"
                  aria-label="Reset zoom to global view"
                  style={{ opacity: isAtGlobalZoom ? 0.5 : 1 }}
                >
                  <Scan className="h-4 w-4" />
                </button>
                {bubbleElements}
                {tooltip.topic && (
                  <div
                    className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-border bg-card p-3 text-xs shadow-lg"
                    style={{ left: tooltip.x, top: tooltip.y }}
                  >
                    <div className="text-sm font-semibold">Topic {tooltip.topic.id}</div>
                    <div className="mt-1 wrap-break-word text-[10px] leading-snug text-muted-foreground">{tooltip.topic.label}</div>
                    <div className="mt-2">{renderSizeComposition(tooltip.topic.size, tooltip.topic.total_size)}</div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                {topics.slice(0,10).map(t=> {
                  const isHovered = hoveredTopicId === t.id;
                  return (
                    <div
                      key={t.id}
                      className={`rounded-lg border border-border bg-muted/50 p-3 transition-shadow ${isHovered ? 'ring-2 ring-primary shadow-md' : ''}`}
                      onMouseEnter={()=>setHoveredTopicId(t.id)}
                      onMouseLeave={()=>setHoveredTopicId(null)}
                    >
                      <div className="font-medium text-foreground">Topic {t.id}</div>
                      <div className="truncate text-xs text-muted-foreground" title={t.label}>{t.label}</div>
                      <div className="mt-2">{renderSizeComposition(t.size, t.total_size)}</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

      <AlertDialog open={detachDialogOpen} onOpenChange={setDetachDialogOpen}>
        <AlertDialogContent className="max-w-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Detach Topic Results</AlertDialogTitle>
            <AlertDialogDescription>
              Select metadata columns to include with the detached topic column. Existing source <code>topic</code> columns are shown but cannot be selected.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            {detachNodeOptions.map((node) => (
              <div key={node.node_id} className="rounded-md border p-3">
                <div className="mb-2 text-sm font-semibold text-foreground">{node.node_name}</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {node.available_columns.map((column) => {
                    const disabled = (node.disabled_columns || []).includes(column);
                    const checked = (selectedDetachColumns[node.node_id] || []).includes(column);
                    return (
                      <label key={`${node.node_id}-${column}`} className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-60' : ''}`}>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => toggleDetachColumn(node.node_id, column, value === true)}
                          disabled={disabled || isDetaching}
                        />
                        <span>{column}{disabled ? ' (disabled)' : ''}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDetaching}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDetachConfirm();
              }}
              disabled={isDetaching}
            >
              {isDetaching ? (
                <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Detaching…</span>
              ) : (
                'Detach'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
  );
};

export default TopicModelingFeature;
