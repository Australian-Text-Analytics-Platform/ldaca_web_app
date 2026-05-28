import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useAuth } from '@/hooks/useAuth';
import { takeMostRecent } from '@/utils/selectionUtils';
import {
  topicModelingTaskRequest,
  topicModelingTaskResult,
  updateTopicModelingTaskResult,
} from '@/api/generated/sdk.gen';
import type {
  TopicModelingRequestInput,
  TopicModelingResponse,
  TopicModelingTopic,
} from '@/api/generated/types.gen';
import {
  snapshotSourceNodes,
  useSnapshotBackedAnalysisState,
} from '@/features/snapshot-view';
import { useTopicModelingSnapshotCapture } from './hooks/useTopicModelingSnapshotCapture';
import { useTopicModelingSnapshotLoad } from './hooks/useTopicModelingSnapshotLoad';
import type { TopicModelingSnapshotPayload } from './hooks/useTopicModelingSnapshotLoad';
import { TopicModelingSnapshotBanner } from './components/TopicModelingSnapshotBanner';
import type { WorkspaceNodeLike } from '@/features/analysis/common/nodeSelectionTypes';
import { useAnalysisStore, type TaskItem } from '@/stores/analysisStore';
import { useUIStore } from '@/stores';
import useNodeColumnInfos from '@/hooks/useNodeColumnInfos';
import { pruneTasksById } from '@/hooks/analysisTaskUtils';
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
import { useDefaultStopwords } from '../common/hooks/useDefaultStopwords';
import { effectiveNodeLanguage } from '@/lib/effectiveNodeLanguage';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { TopicModelingParameterPanel, type CorpusSample } from './components/panels/TopicModelingParameterPanel';
import { TopicModelingResultsPanel } from './components/panels/TopicModelingResultsPanel';
import { useTopicModelingTaskFlow } from './hooks/useTopicModelingTaskFlow';
import { useTopicModelingZoomBrush } from './hooks/useTopicModelingZoomBrush';
import { useTopicModelingBubbleChart } from './hooks/useTopicModelingBubbleChart';
import { usePersistNodeDocumentColumn } from '../common/hooks/usePersistNodeDocumentColumn';

const DEFAULT_TOPIC_SIZE_VALUE = 20;
type TopicModelingRequest = TopicModelingRequestInput;

/** Renders the topic-modeling workflow for live BERTopic runs and saved snapshot views. */
/**
 * Rendered by: the analysis feature registry when this panel is selected because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 */
const TopicModelingFeature: React.FC = () => {
  const { selectedNodes } = useWorkspaceSelection();
  const { currentWorkspaceId, currentWorkspace } = useWorkspaceData();
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
    panelSelectedNodes: livePanelSelectedNodes,
    serverRequest,
  } = useAnalysisLock({
    analysisType: 'topic_modeling',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    allowedDataTypes: ['string'],
    maxNodes: 2,
    docTypeOnly: true,
  });
  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
  });

  // Snapshot view state hooks. Hoisted early so the effective-value
  // dispatch can shadow ``panelSelectedNodes`` / ``result`` /
  // parameter state in one place. The rest of the component reads
  // the shadowed names and naturally picks up snapshot data when in
  // snapshot mode.
  const { loadedSnapshot, inSnapshotMode } =
    useSnapshotBackedAnalysisState<TopicModelingSnapshotPayload>(
      'topic_modeling',
    );

  const panelSelectedNodes = useMemo<WorkspaceNodeLike[]>(() => {
    if (!inSnapshotMode || !loadedSnapshot) return livePanelSelectedNodes;
    return snapshotSourceNodes(loadedSnapshot.manifest.source);
  }, [inSnapshotMode, loadedSnapshot, livePanelSelectedNodes]);

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
  const defaultLanguage = usePreferencesStore((state) => state.defaultLanguage);
  const [error, setError] = useState<string | null>(null);
  const [liveResult, resultRef, setResultSafely] = useSafeResult<TopicModelingResponse>();

  // Shadow ``result`` so all downstream derivations (topics list,
  // bubble chart, summary panels) pick up snapshot data without
  // per-call-site dispatch. ``setResultSafely`` still targets the
  // live state — the snapshot store owns its own slice. Plain
  // expression so the React Compiler can decide memoization without
  // a manual hint on a refinement-style dispatch.
  const result: TopicModelingResponse | null =
    inSnapshotMode && loadedSnapshot ? loadedSnapshot.payload.result : liveResult;
  
  const [corpusSamples, setCorpusSamples] = useState<CorpusSample[]>([]);
  // Sample values reset on data-block change (auto-populate) but persist
  // through Clear Results if the user explicitly touched them, so the user
  // doesn't lose tuned sampling when re-running on the same corpora.
  const [corpusSamplesUserSet, setCorpusSamplesUserSet] = useState(false);
  const [topicSizeMode, setTopicSizeMode] = useState<'min' | 'exact'>('exact');
  const [topicSizeValue, setTopicSizeValue] = useState(DEFAULT_TOPIC_SIZE_VALUE);
  const [topicSizeUserSet, setTopicSizeUserSet] = useState(false);
  const [referenceTopicNo, setReferenceTopicNo] = useState(DEFAULT_TOPIC_SIZE_VALUE);
  const [randomSeed, setRandomSeed] = useState(42);
  const [randomSeedUserSet, setRandomSeedUserSet] = useState(false);
  const [representativeWordsCount, setRepresentativeWordsCount] = useState(15);
  const [representativeWordsCountUserSet, setRepresentativeWordsCountUserSet] = useState(false);
  const [hoveredTopicId, setHoveredTopicId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{x:number;y:number; topic: TopicModelingTopic | null}>({x:0,y:0,topic:null});
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<number>>(new Set());
  const [topicSearchQuery, setTopicSearchQuery] = useState('');
  // Post-fit stopword filtering for non-English topic labels. CJK function
  // words (的/是/了 etc.) dominate every label because we deliberately
  // don't pass a CountVectorizer stopword list to the backend — that
  // would be opinionated and irreversible. The filter is purely
  // client-side: it drops matching words from each topic's display
  // representation and hides topics whose representative words all match.
  // Backend output is unchanged, so toggling off restores the raw labels.
  const [stopwordFilterEnabled, setStopwordFilterEnabled] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState<number>(800);
  const chartResizeFrameRef = useRef<number | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [isUpdatingExactTopicCount, setIsUpdatingExactTopicCount] = useState(false);

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
    hasActiveTask,
  } = useAnalysisFeature<TopicModelingResponse>({
    analysisType: 'topic_modeling',
    taskType: 'topic_modeling',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
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
      const persistedMode = req.topic_size_mode as 'min' | 'exact' | undefined;
      setTopicSizeMode(persistedMode === 'min' ? 'min' : 'exact');
      const hydratedTopicSizeValue = Number(req.topic_size_value ?? DEFAULT_TOPIC_SIZE_VALUE);
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
            queryClient,
            maxNodes: 2,
          });
        } catch { /* ignore */ }
      }
    },
    // Clears topic-specific result and error state after the shared lifecycle deletes results.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    onCleared: () => {
      setResultSafely(null);
      setError(null);
      resetAnalysisSelectionAfterClear({ unlockSelection });
    },
    // Removes completed topic tasks from the global task list after clear/delete operations.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    pruneGlobalTasks: (taskIds) =>
      setTasks((prev: TaskItem[]) => Array.isArray(prev) ? pruneTasksById(prev, taskIds) : prev),
    // Finds task ids embedded in result metadata for status recovery.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    getExtraTaskIdCandidates: () => [(resultRef.current as TopicModelingResponse | null)?.metadata?.task_id],
    // Finds task ids embedded in result metadata for clear operations.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    getClearTaskIdSources: () => [(resultRef.current as TopicModelingResponse | null)?.metadata?.task_id],
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
        nDocs > 0 ? Math.min(100, Math.ceil((4000 / nDocs) * 100 / 10) * 10) : 100;
      return { percent: String(autoPercent), enabled: autoPercent < 100 };
    });

  // Clears live topic results while preserving user-tuned sampling only when explicitly set.
  /**
   * Called by: TopicModelingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleClear = async () => {
    if (inSnapshotMode) return;
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
    setTopicSizeMode('exact');
    setTopicSizeValue(DEFAULT_TOPIC_SIZE_VALUE);
    setTopicSizeUserSet(false);
    setReferenceTopicNo(DEFAULT_TOPIC_SIZE_VALUE);
    setRandomSeedUserSet(false);
    setRepresentativeWordsCountUserSet(false);
    setIsClearing(false);
  };

  // Switches between min-topic-size and exact-topic target modes for the next run.
  /**
   * Called by: TopicModelingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleTopicSizeModeChange = (mode: 'min' | 'exact') => {
    setTopicSizeMode(mode);
    setTopicSizeUserSet(false);
    if (mode !== 'min') {
      setTopicSizeValue(referenceTopicNo);
    }
  };

  // Records the next-run topic size value and keeps the exact-topic reference in sync.
  /**
   * Called by: TopicModelingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleTopicSizeValueChange = (value: number) => {
    setTopicSizeValue(value);
    setTopicSizeUserSet(true);
    if (topicSizeMode !== 'min') {
      setReferenceTopicNo(value);
    }
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
  const panelNodeIds = takeMostRecent(panelSelectedNodes, 2)
    .map((node, idx) => getNodeIdentifier(node, idx) || activeNodeIds[idx])
    .filter((id): id is string => Boolean(id));
  const panelNodeIdsKey = panelNodeIds.join('|');

  // Observe container width for responsive sizing
  useEffect(()=>{
    const el = chartRef.current;
    if(!el) return;
    // Debounces resize observer updates into a stable chart width state.
    /**
     * Called by: TopicModelingFeature during this analysis workflow because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
     */
    const updateChartWidth = (width: number) => {
      const nextWidth = Math.round(width);
      if (!nextWidth) return;
      setChartWidth((prevWidth) => (prevWidth === nextWidth ? prevWidth : nextWidth));
    };
    const observer = new ResizeObserver(entries => {
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
    return ()=> {
      observer.disconnect();
      if (chartResizeFrameRef.current !== null) {
        cancelAnimationFrame(chartResizeFrameRef.current);
        chartResizeFrameRef.current = null;
      }
    };
  },[]);

  const defaultPalette = DEFAULT_PALETTE;

  // ``tabKey`` routes colour changes through the per-tab temp layer
  // (commit on Run via ``promoteTempColors`` below).
  const topicActiveNodeIds = takeMostRecent(panelNodeIds, 2);
  const { nodeColors: liveNodeColors, handleColorChange, defaultPalette: _dp, promoteTempColors } =
    useNodeColorManagement({
      activeNodeIds: topicActiveNodeIds,
      tabKey: 'topic-modeling',
    });
  // In snapshot mode the live colour store has no entries for the
  // captured node IDs. Shadow with the frozen ``manifest.node_colors``
  // so the parameter-panel swatch and the bubble-chart corpus colours
  // honour the captured values.
  const nodeColors: Record<string, string> =
    inSnapshotMode && loadedSnapshot ? loadedSnapshot.manifest.node_colors : liveNodeColors;

  const effectiveNodeColumnSelections = useMemo(() => {
    if (inSnapshotMode && loadedSnapshot?.payload.settings) {
      const settings = loadedSnapshot.payload.settings;
      const nodeIds = Array.isArray(settings.node_ids) ? settings.node_ids : [];
      const cols = settings.node_columns ?? {};
      return nodeIds.map((id) => ({ nodeId: id, column: cols[id] ?? '' }));
    }
    return isLocked ? activeNodeColumnSelections : nodeColumnSelections;
  }, [inSnapshotMode, loadedSnapshot, isLocked, activeNodeColumnSelections, nodeColumnSelections]);

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
  });

  const panelHasMissingColumns = panelNodeIds.some((nodeId) => {
    const selection = effectiveNodeColumnSelections.find((sel) => sel.nodeId === nodeId);
    return !selection || !selection.column;
  });

  // sample_fractions diff: server stores `null` (or absent) when sampling
  // is disabled per corpus; mirror that shape so the comparison is stable
  // across "no sampling specified" vs "explicit 100%".
  /**
   * Called by: TopicModelingFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   */
  const normalizeSampleFractions = (raw: unknown, nodeCount: number): (number | null)[] => {
    const list = Array.isArray(raw) ? raw : [];
    return Array.from({ length: nodeCount }, (_, idx) => {
      const value = list[idx];
      if (typeof value === 'number' && value > 0 && value < 1) return value;
      return null;
    });
  };

  const currentSampleFractions = corpusSamples.slice(0, panelNodeIds.length).map((s) => {
    if (!s?.enabled) return null;
    const pct = Math.min(100, Math.max(1, Number(s.percent) || 100));
    return pct >= 100 ? null : pct / 100;
  });

  const hasLockedParameterChanges = hasLockedParameterDiff({
    isLocked,
    serverRequest: typedServerRequest,
    currentParams: {
      random_seed: Number(randomSeed),
      topic_size_mode: topicSizeMode,
      // Target Topic Number (exact) and Min Topic Size both trip the rerun:
      // the post-fit slider is decoupled and writes to its own state, so
      // changes to this parameter always represent a "next-rerun" intent.
      topic_size_value: Number(topicSizeValue),
      // representative_words_count is a frontend display cap (bounded by
      // the originally-fitted value); changes within range don't require
      // a rerun and so are excluded here.
      sample_fractions: normalizeSampleFractions(
        currentSampleFractions,
        panelNodeIds.length,
      ),
    },
    // Extracts comparable server-side parameters from the stored topic-modeling request.
    // Called by: TopicModelingFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    getServerParams: (request) => ({
      random_seed: Number(request.random_seed),
      topic_size_mode: request.topic_size_mode ?? 'exact',
      topic_size_value: Number(request.topic_size_value ?? DEFAULT_TOPIC_SIZE_VALUE),
      sample_fractions: normalizeSampleFractions(
        (request as unknown as { sample_fractions?: unknown }).sample_fractions,
        panelNodeIds.length,
      ),
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
    if (inSnapshotMode) return;
    if (!isLocked && panelNodeIds.length > 0 && nodeColumnSelections.length === 0) {
      recomputeAutoColumns();
    }
  }, [inSnapshotMode, isLocked, panelNodeIdsKey, nodeColumnSelections.length, recomputeAutoColumns, panelNodeIds.length]);

  // Auto-populate sampling fractions when selected nodes change, and treat
  // these auto-values as not-user-set so Clear Results can re-derive them.
  // Skipped in snapshot mode — the snapshot-load sync below hydrates these
  // from the captured request instead.
  useEffect(() => {
    if (inSnapshotMode) return;
    const samples = computeDefaultCorpusSamples();
    Promise.resolve().then(() => {
      setCorpusSamples(samples);
      setCorpusSamplesUserSet(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inSnapshotMode, panelNodeIdsKey]);

  // Hydrate the parameter-panel state from the loaded snapshot when
  // entering snapshot mode. Inputs are disabled in snapshot mode
  // (via ``inputsDisabled`` on the panel), so once synced the values
  // stay frozen for the duration of the view.
  useEffect(() => {
    if (!inSnapshotMode || !loadedSnapshot) return;
    const settings = loadedSnapshot.payload.settings;
    if (!settings) return;
    // Rehydrate sampling fractions: capture ships ``sample_fractions``
    // aligned with the captured ``node_ids``. ``null`` entries mean
    // "no sampling" for that block → enabled=false, percent=100.
    const nodeIds = Array.isArray(settings.node_ids) ? settings.node_ids : [];
    const sf = Array.isArray(settings.sample_fractions) ? settings.sample_fractions : [];
    const samples: CorpusSample[] = nodeIds.slice(0, 2).map((_, idx) => {
      const v = sf[idx];
      if (typeof v === 'number' && v > 0 && v < 1) {
        return { percent: String(Math.round(v * 100)), enabled: true };
      }
      return { percent: '100', enabled: false };
    });
    Promise.resolve().then(() => {
      if (typeof settings.random_seed === 'number') {
        setRandomSeed(settings.random_seed);
        setRandomSeedUserSet(true);
      }
      if (typeof settings.representative_words_count === 'number') {
        setRepresentativeWordsCount(settings.representative_words_count);
        setRepresentativeWordsCountUserSet(true);
      }
      if (settings.topic_size_mode === 'min') {
        setTopicSizeMode('min');
      } else {
        setTopicSizeMode('exact');
      }
      if (typeof settings.topic_size_value === 'number') {
        setTopicSizeValue(settings.topic_size_value);
        setReferenceTopicNo(settings.topic_size_value);
        setTopicSizeUserSet(true);
      }
      setCorpusSamples(samples);
      setCorpusSamplesUserSet(true);
      setSelectedTopicIds(new Set());
      setTopicSearchQuery('');
    });
  }, [inSnapshotMode, loadedSnapshot]);

  // Updates a node's selected text column and persists it as the document column preference.
  /**
   * Called by: TopicModelingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleColumnChange = (nodeId: string, column: string) => {
    if (isLocked || inSnapshotMode) return;
    setNodeColumnSelection(nodeId, column);
    void persistDocumentColumn(nodeId, column);
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

  // Docs-per-estimated-topic: for target/exact this is combinedEffective/value;
  // for min mode the value itself is the minimum cluster size (= docs per topic floor).
  const topicSizeWarning: 'orange' | 'red' | null = useMemo(() => {
    if (combinedEffective <= 0 || topicSizeValue <= 0) return null;
    const docsPerTopic =
      topicSizeMode === 'min' ? topicSizeValue : combinedEffective / topicSizeValue;
    if (docsPerTopic < 3) return 'red';
    if (docsPerTopic < 10) return 'orange';
    return null;
  }, [topicSizeMode, topicSizeValue, combinedEffective]);

  // Auto-recalculate min topic size when in 'min' mode and not overridden by user
  useEffect(() => {
    if (topicSizeMode !== 'min' || topicSizeUserSet || combinedEffective <= 0) return;
    const autoMin = Math.max(2, Math.floor(combinedEffective / (10 * referenceTopicNo)));
    Promise.resolve().then(() => setTopicSizeValue(autoMin));
  }, [topicSizeMode, topicSizeUserSet, combinedEffective, referenceTopicNo]);

  const showSamplingWarning =
    combinedEffective > 0 && combinedEffective < 5 * (topicSizeValue ?? DEFAULT_TOPIC_SIZE_VALUE);

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

  const rawTopics: TopicModelingTopic[] = result?.data?.topics || [];
  const topicLanguages = [effectiveNodeLanguage({ defaultLanguage })];
  const {
    stopwords: stopwordSet,
    byLanguage: stopwordByLanguage,
    available: stopwordFilterAvailable,
  } = useDefaultStopwords(topicLanguages, { strict: true });
  // Aggregate label for the toggle copy ("Hide EN + ZH stopwords").
  // Only includes languages that actually returned a non-empty list,
  // so a ZH-only resolved set won't claim "EN" in the toggle label.
  const stopwordFilterLanguageLabel = stopwordByLanguage
    .filter((group) => group.words.length > 0)
    .map((group) => group.language.toUpperCase())
    .join(' + ');
  // Rebuild each topic's label from its representative_words sliced to the
  // current "Words per topic" display cap, so changing that input updates
  // the bottom list without a rerun. Falls back to the server-built label
  // when representative_words is missing. When the stopword filter is on
  // and we have a bundled list for the resolved language, drop matching
  // words before slicing and hide topics that end up empty.
  const topics: TopicModelingTopic[] = useMemo(() => {
    const cap = Math.max(1, Math.floor(representativeWordsCount));
    const filterActive = stopwordFilterEnabled && stopwordFilterAvailable;
    const filtered: TopicModelingTopic[] = [];
    for (const topic of rawTopics) {
      const words = Array.isArray(topic.representative_words)
        ? topic.representative_words
        : null;
      if (!words || words.length === 0) {
        filtered.push(topic);
        continue;
      }
      const kept = filterActive
        ? words.filter((w) => typeof w === 'string' && !stopwordSet.has(w.trim()))
        : words;
      if (filterActive && kept.length === 0) {
        // Topic was entirely stopwords — hide it per the agreed UX.
        continue;
      }
      const sliced = kept.slice(0, cap).join(', ');
      filtered.push(
        sliced
          ? { ...topic, representative_words: kept, label: sliced }
          : { ...topic, representative_words: kept },
      );
    }
    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, representativeWordsCount, stopwordFilterEnabled, stopwordFilterAvailable, stopwordSet]);

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
      topicSizeMode,
      topicSizeValue,
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
    },
    lock: {
      getAuthHeaders,
      lockWithSnapshots,
      queryClient,
    },
  });

  const corpusCount = result?.data?.corpus_sizes?.length || 0;
  const exactRawTopicCount = (() => {
    const rawValue = result?.data?.meta?.raw_total_topics;
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      return null;
    }
    return Math.max(0, Math.trunc(rawValue));
  })();
  const currentExactTopicCount = (() => {
    const metaValue = result?.data?.meta?.topic_size_value;
    if (typeof metaValue === 'number' && Number.isFinite(metaValue)) {
      return Math.max(0, Math.trunc(metaValue));
    }
    return null;
  })();
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

  // Runs a fresh topic-modeling task or updates a locked task after parameter changes.
  /**
   * Called by: TopicModelingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleRunOrUpdate = async () => {
    if (inSnapshotMode) return;
    // Promote this tab's pending temp colours to assigned — Run is the
    // commit trigger per the node-colour strategy doc.
    promoteTempColors(topicActiveNodeIds);
    await executeAnalysisRunOrUpdate({
      hasLockedParameterChanges,
      clearResults,
      runFreshAnalysis: handleRun,
    });
  };

  // Re-aggregates a completed exact-topic result without changing the next-run parameter input.
  /**
   * Called by: TopicModelingFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
 * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 */
  const handleUpdateExactTopicCount = async (value: number) => {
    if (inSnapshotMode) return;
    if (topicSizeMode !== 'exact') return;
    const taskId = await resolveTaskId();
    if (!taskId) {
      setError('No completed topic modeling task available to update.');
      return;
    }

    setIsUpdatingExactTopicCount(true);
    setError(null);
    try {
      const { data: updated } = await updateTopicModelingTaskResult({
        body: { topic_size_value: value },
        headers: getAuthHeaders(),
        path: { task_id: taskId },
        throwOnError: true,
      });
      // The slider is decoupled from the "Target Topic Number" parameter
      // input: it represents the post-fit display target only, so we just
      // swap in the new result and clear transient selection state. The
      // parameter panel input (`topicSizeValue`) is left alone so the user
      // can still see / edit the next-rerun target independently.
      setResultSafely(updated);
      setSelectedTopicIds(new Set());
      setHoveredTopicId(null);
      setTopicSearchQuery('');
    } catch (updateError: unknown) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Failed to update exact topic count',
      );
    } finally {
      setIsUpdatingExactTopicCount(false);
    }
  };

  const shouldShowResultsPanel = Boolean(topicWaitingBanner || result || error);

  // ----- Snapshot capture + load wiring -----
  const handleOpenSnapshot = useTopicModelingSnapshotLoad();

  // Reads the row count from a selected node for snapshot eligibility checks.
  /**
   * Called by: TopicModelingFeature as a local helper in this analysis workflow because the feature needs this local normalization step before building requests, labels, or display state.
   */
  const getTopicNodeRowCount = (node: WorkspaceNodeLike) => {
    const shape = node.shape as unknown;
    if (Array.isArray(shape) && typeof shape[0] === 'number') return shape[0];
    return 0;
  };

  // Build the live ``TopicModelingRequest`` from current state for the
  // capture-side ``settings.json`` payload. Returns null in snapshot
  // mode (the Save button is disabled there anyway).
  const captureRequest: TopicModelingRequest | null = (() => {
    if (inSnapshotMode) return null;
    if (panelNodeIds.length === 0) return null;
    const nodeColumns: Record<string, string> = {};
    for (const sel of effectiveNodeColumnSelections) {
      if (sel.column) nodeColumns[sel.nodeId] = sel.column;
    }
    return {
      node_ids: panelNodeIds,
      node_columns: nodeColumns,
      random_seed: randomSeed,
      representative_words_count: representativeWordsCount,
      sample_fractions: hasAnySampling ? sampleFractionsForRequest : null,
      topic_size_mode: topicSizeMode,
      topic_size_value: topicSizeValue,
    };
  })();

  const handleSaveSnapshot = useTopicModelingSnapshotCapture({
    workspaceId: currentWorkspaceId,
    workspaceName: currentWorkspace?.name ?? currentWorkspaceId ?? '(workspace)',
    request: captureRequest,
    results: liveResult,
    selectedNodes: livePanelSelectedNodes,
    getNodeRowCount: getTopicNodeRowCount,
    getAuthHeaders,
  });

  const saveSnapshotDisabledReason = (() => {
    if (inSnapshotMode) {
      return 'Exit snapshot view first to capture a new snapshot from live results.';
    }
    if (livePanelSelectedNodes.length === 0) {
      return 'Select a data block first.';
    }
    const largestBlock = livePanelSelectedNodes
      .map(getTopicNodeRowCount)
      .reduce((max, n) => (Number.isFinite(n) && n > max ? n : max), 0);
    if (largestBlock > 2_000) {
      return `Demo snapshots cap each selected data block at 2,000 rows; largest selected block has ${largestBlock.toLocaleString()}.`;
    }
    if (!liveResult || liveResult.state !== 'successful') {
      return 'Run the topic modelling analysis (and let it finish) before saving a snapshot.';
    }
    return undefined;
  })();

  return (
    <div className="space-y-4">
      {inSnapshotMode && <TopicModelingSnapshotBanner />}
      <TopicModelingParameterPanel
        selectedNodes={panelSelectedNodes}
        nodeColumnSelections={effectiveNodeColumnSelections}
        onColumnChange={handleColumnChange}
        nodeColors={nodeColors}
        onNodeColorChange={handleColorChange}
        defaultPalette={defaultPalette}
        isLocked={!!isLocked || inSnapshotMode}
        lockedMessage={
          inSnapshotMode
            ? 'Viewing a saved snapshot — selection is frozen.'
            : undefined
        }
        snapshot={{
          tool: 'topic_modeling',
          onSave: handleSaveSnapshot,
          saveDisabledReason: saveSnapshotDisabledReason,
          onOpen: handleOpenSnapshot,
          nodeLabels: livePanelSelectedNodes
            .map((n) => (n.name as string | undefined) ?? (n.id as string | undefined) ?? '')
            .filter((s) => s.length > 0),
        }}
        inputsDisabled={inSnapshotMode}
        getNodeColumns={getColumnInfos}
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
        topicSizeMode={topicSizeMode}
        onTopicSizeModeChange={handleTopicSizeModeChange}
        topicSizeValue={topicSizeValue}
        topicSizeUserSet={topicSizeUserSet}
        topicSizeWarning={topicSizeWarning}
        onTopicSizeValueChange={handleTopicSizeValueChange}
        showSamplingWarning={showSamplingWarning}
        randomSeed={randomSeed}
        randomSeedUserSet={randomSeedUserSet}
        onRandomSeedChange={(v) => { setRandomSeed(v); setRandomSeedUserSet(true); }}
        representativeWordsCount={representativeWordsCount}
        representativeWordsCountUserSet={representativeWordsCountUserSet}
        representativeWordsCountServerMax={
          inSnapshotMode
            ? Number(loadedSnapshot?.payload.settings?.representative_words_count) || null
            : isLocked
              ? Number(typedServerRequest?.representative_words_count) || null
              : null
        }
        representativeWordsCountLockedReason={
          inSnapshotMode
            ? (() => {
                // Backend fits + stores ``max(50, settings_value * 2)``
                // representative words per topic, so the snapshot can be
                // scaled up post-fit to that cap — not to the user's
                // smaller fit-time pick. Mirror the cap formula the
                // panel uses for the slider's ``max`` attribute.
                const fitValue = Number(loadedSnapshot?.payload.settings?.representative_words_count) || 0;
                const cap = Math.max(50, fitValue * 2);
                return `Adjustable up to ${cap} words stored in this snapshot.`;
              })()
            : undefined
        }
        onRepresentativeWordsCountChange={(v) => { setRepresentativeWordsCount(v); setRepresentativeWordsCountUserSet(true); }}
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
          nodeNames={panelSelectedNodes
            .map((n) => (n.name as string | undefined) ?? (n.id as string | undefined) ?? '')
            .filter(Boolean) as string[]}
          topicSizeMode={topicSizeMode}
          topicSizeValue={topicSizeValue}
          currentExactTopicCount={currentExactTopicCount}
          randomSeed={randomSeed}
          exactTopicCountRange={
            topicSizeMode === 'exact' && exactRawTopicCount && exactRawTopicCount >= 2
              ? { min: 2, max: exactRawTopicCount }
              : null
          }
          isUpdatingExactTopicCount={isUpdatingExactTopicCount}
          onUpdateExactTopicCount={handleUpdateExactTopicCount}
          detachDialogOpen={detachDialogOpen}
          setDetachDialogOpen={setDetachDialogOpen}
          detachNodeOptions={detachNodeOptions}
          selectedDetachColumns={selectedDetachColumns}
          toggleDetachColumn={toggleDetachColumn}
          selectAllDetachColumns={selectAllDetachColumns}
          deselectAllDetachColumns={deselectAllDetachColumns}
          handleDetachConfirm={handleDetachConfirm}
          stopwordFilterAvailable={stopwordFilterAvailable}
          stopwordFilterEnabled={stopwordFilterEnabled}
          onStopwordFilterToggle={setStopwordFilterEnabled}
          stopwordFilterLanguage={stopwordFilterLanguageLabel || undefined}
          stopwordFilterSet={stopwordSet}
          stopwordFilterByLanguage={stopwordByLanguage}
          readOnly={inSnapshotMode}
        />
      )}
      </div>
  );
};

export default TopicModelingFeature;
