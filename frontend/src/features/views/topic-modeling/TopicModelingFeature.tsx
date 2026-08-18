import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  TopicModelingAnalysisRequest,
  TopicModelingResponse,
  TopicModelingTopic,
} from '@/api';
import { CONTEXTUAL_HINT_IDS } from '@/features/guidance/registry';
import { useProgressiveContextualHints } from '@/features/guidance/useProgressiveContextualHints';
import type { AnalysisTabFeatureProps } from '@/features/views/common/tabs/AnalysisTabsHost';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { isArrowStringField } from '@/lib/arrow/arrowTable';
import { getAnalysisResultResource } from '../common/analysisApi';
import { ANALYSIS_TASK_TYPES } from '../common/analysisIds';
import { useAnalysisFeature } from '../common/hooks/useAnalysisFeature';
import { useNodeColorControls } from '../common/hooks/useNodeColorControls';
import { usePersistNodeDocumentColumn } from '../common/hooks/usePersistNodeDocumentColumn';
import { useTabNodeInputs } from '../common/nodeInputs';
import { hasParameterDiff } from '../common/parameterComparison';
import { getRerunActionState } from '../common/rerunActionState';
import { hasClearRequiredAnalysis } from '../common/analysisActionLifecycle';
import { DEFAULT_TAB_INPUT_SET_ID } from '../common/tabs/tabStateOps';
import { analysisInputsFromRequest } from '../common/utils';
import { TopicModelingParameterPanel } from './components/panels/TopicModelingParameterPanel';
import { TopicModelingResultsPanel } from './components/panels/TopicModelingResultsPanel';
import {
  TopicModelingAddToWorkspaceDialog,
  type TopicModelingAddToWorkspaceSource,
} from './components/TopicModelingAddToWorkspaceDialog';
import { createDefaultTopicModelingAddToWorkspaceColumns } from './components/topicModelingAddToWorkspaceState';
import { useTopicModelingBubbleChart } from './hooks/useTopicModelingBubbleChart';
import {
  DEFAULT_MAX_SEGMENT_TOKENS,
  DEFAULT_TOPIC_SIZE_VALUE,
  normalizeTopicSampleFractions,
  useTopicModelingParameters,
} from './hooks/useTopicModelingParameters';
import { useTopicModelingResultControls } from './hooks/useTopicModelingResultControls';
import { useTopicModelingTaskFlow } from './hooks/useTopicModelingTaskFlow';
import { useTopicModelingZoomBrush } from './hooks/useTopicModelingZoomBrush';
import {
  filterTopicRepresentativeWords,
  sliceTopicRepresentativeWords,
} from './topicModelingAdapters';

/**
 * Renders the native topic-modelling workflow and Result exploration.
 * Rendered by: the viewComponents tabbed loader, which mounts one instance per analysis tab and feeds it tab props.
 * Flow: read workspace/tab state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 *
 * The required host supplies normalized task/input state and closure-bound
 * persistence commands for the active tab; this feature has no standalone or
 * optional-tab compatibility path.
 */
function TopicModelingFeature({ host }: AnalysisTabFeatureProps) {
  const {
    latestRunAll,
    activeAnalysis,
    analyses,
    refreshAnalyses,
    inputSets: tabInputSets,
    setInputSet: onTabInputSetChange,
  } = host;
  const tabTaskId = latestRunAll?.id ?? null;
  const { currentWorkspaceId } = useWorkspaceData();
  const { setNodeColor: persistNodeColor, createTopicModelingDataBlocks } = useWorkspaceActions();
  const nodeInputs = useTabNodeInputs({
    tabInputSets,
    onTabInputSetChange,
    constraints: {
      fieldPredicate: isArrowStringField,
      maxNodes: 2,
      docTypeOnly: true,
    },
  });
  const nodeColumnSelections = nodeInputs.nodeColumnSelections;
  const setNodeColumnSelection = nodeInputs.setColumn;
  const panelSelectedNodes = nodeInputs.selectedNodes;
  const panelNodeIds = panelSelectedNodes
    .slice(0, 2)
    .map((node) => node.id)
    .filter((id): id is string => Boolean(id));
  const panelNodeIdsKey = panelNodeIds.join('|');
  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
  });

  const [error, setError] = useState<string | null>(null);
  const {
    corpusSamples,
    updateCorpusSample,
    topicSizeValue,
    topicSizeUserSet,
    setTopicSizeValueFromUser,
    randomSeed,
    randomSeedUserSet,
    setRandomSeedFromUser,
    segmentationMethod,
    setSegmentationMethod,
    maxSegmentTokens,
    setMaxSegmentTokens,
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
    nodeInfoById: nodeInputs.nodeInfoById,
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
  const [addToWorkspaceDialogOpen, setAddToWorkspaceDialogOpen] = useState(false);
  const [isAddingToWorkspace, setIsAddingToWorkspace] = useState(false);
  const [addToWorkspaceSourceIds, setAddToWorkspaceSourceIds] = useState<Set<string>>(new Set());
  const [addToWorkspaceColumns, setAddToWorkspaceColumns] = useState<Record<string, string[]>>({});
  const [addToWorkspaceNames, setAddToWorkspaceNames] = useState<Record<string, string>>({});

  const {
    request: serverRequest,
    isRunning,
    isStopping,
    setIsRunning,
    runningRef,
    taskStatus,
    clearResults,
    stopTask,
    setLocalTaskId,
    banner: topicWaitingBanner,
    analysisError,
    result,
  } = useAnalysisFeature<TopicModelingResponse, TopicModelingAnalysisRequest>({
    taskType: ANALYSIS_TASK_TYPES.topicModeling,
    workspaceId: currentWorkspaceId,
    tabId: host.tabId,
    // The forest's newest Run All Analysis wins hydration over transient
    // submission state.
    hydrationTaskId: tabTaskId,
    controlAnalysisId: activeAnalysis?.id ?? null,
    tabAnalysisIds: analyses.map((analysis) => analysis.id),
    // Called by useAnalysisFeature polling and hydration to load the owned task result.
    fetchResult: async (taskId) => {
      if (!currentWorkspaceId) throw new Error('No workspace selected');
      return getAnalysisResultResource<TopicModelingResponse>(currentWorkspaceId, taskId);
    },
    // Called by useAnalysisFeature hydration to restore parameters from the stored request envelope.
    onRequest: (requestPayload) => {
      const req = requestPayload as unknown as Record<string, unknown>;
      onTabInputSetChange(DEFAULT_TAB_INPUT_SET_ID, analysisInputsFromRequest(req, 2));
      hydrateParameters(req);
    },
    // Called by useAnalysisFeature after shared result deletion completes.
    onCleared: () => {
      setError(null);
      // Refresh the canonical forest; curated inputs remain in the Tab draft.
      refreshAnalyses();
    },
  });
  const typedServerRequest = serverRequest as {
    node_ids?: string[];
    node_columns?: Record<string, string>;
    min_topic_size?: number;
    random_seed?: number;
    sample_fractions?: (number | null)[];
    segmentation_method?: 'automatic' | 'paragraph' | 'sentence';
    max_segment_tokens?: number;
  } | null;

  /**
   * Clears live topic results and result-view controls while preserving explicitly tuned parameters.
   * Used by: TopicModelingParameterPanel's Clear action.
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

  // Keeps the rendered bubble chart sized to its results container.
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    // Called by ResizeObserver and once from the container's initial measured width.
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
    node_ids: panelNodeIds,
    node_columns: Object.fromEntries(
      effectiveNodeColumnSelections
        .filter((selection) => panelNodeIds.includes(selection.nodeId) && selection.column)
        .map((selection) => [selection.nodeId, selection.column]),
    ),
    random_seed: randomSeed,
    min_topic_size: topicSizeValue,
    sample_fractions: sampleFractionsForRequest,
    segmentation_method: segmentationMethod,
    max_segment_tokens: maxSegmentTokens,
  };
  const serverTopicParams = (request: Record<string, unknown>) => ({
    node_ids: Array.isArray(request.node_ids) ? request.node_ids : [],
    node_columns:
      request.node_columns && typeof request.node_columns === 'object' ? request.node_columns : {},
    random_seed: Number(request.random_seed),
    min_topic_size: Number(request.min_topic_size ?? DEFAULT_TOPIC_SIZE_VALUE),
    sample_fractions: normalizeTopicSampleFractions(
      (request as unknown as { sample_fractions?: unknown }).sample_fractions,
      Array.isArray(request.node_ids) ? request.node_ids.length : 0,
    ),
    segmentation_method:
      request.segmentation_method === 'paragraph' || request.segmentation_method === 'sentence'
        ? request.segmentation_method
        : 'automatic',
    max_segment_tokens: Number(request.max_segment_tokens ?? DEFAULT_MAX_SEGMENT_TOKENS),
  });
  const hasTopicChanges = !typedServerRequest
    ? true
    : hasParameterDiff(currentTopicParams, serverTopicParams(typedServerRequest));

  const parametersLocked = isRunning || Boolean(activeAnalysis);
  const requiresClear = hasClearRequiredAnalysis(analyses);
  const actionState = getRerunActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    isRunnable: panelNodeIds.length > 0 && !panelHasMissingColumns,
    hasAttachedAnalysis: Boolean(tabTaskId),
    hasAnyAnalysis: analyses.length > 0,
    analysisState: taskStatus.tasks[0]?.state ?? null,
    hasChanges: hasTopicChanges,
    requiresClear,
    isBusy: parametersLocked,
  });

  /**
   * Updates a selected node's text column and persists it as that node's document-column preference.
   * Used by: TopicModelingParameterPanel's NodeInputsPanel column-change prop.
   */
  const handleColumnChange = (nodeId: string, column: string) => {
    setNodeColumnSelection(nodeId, column);
    void persistDocumentColumn(nodeId, column);
  };

  const resultKey = tabTaskId ?? (result ? '__hydrated__' : null);
  const [stopWordsEnabledForResult, setStopWordsEnabledForResult] = useState<string | null>(null);
  const stopWordsEnabled = resultKey !== null && stopWordsEnabledForResult === resultKey;
  const resultArtifacts = result?.artifacts.nodes ?? [];
  const resultNodeIds =
    resultArtifacts.length > 0
      ? resultArtifacts.map((artifact) => artifact.node_id)
      : (typedServerRequest?.node_ids ?? panelNodeIds);
  const resultNodeNames =
    result?.data.meta.node_names && result.data.meta.node_names.length > 0
      ? result.data.meta.node_names
      : resultArtifacts.length > 0
        ? resultArtifacts.map((artifact) => artifact.node_name)
        : panelSelectedNodes.map((node) => node.name);
  const resultRandomSeed =
    result?.data.meta.random_state ?? typedServerRequest?.random_seed ?? randomSeed;
  const resultMaxSegmentTokens = typedServerRequest?.max_segment_tokens ?? maxSegmentTokens;
  const firstResultNodeId = resultNodeIds[0] ?? null;
  const firstResultColumn = firstResultNodeId
    ? (typedServerRequest?.node_columns?.[firstResultNodeId] ??
      resultArtifacts.find((artifact) => artifact.node_id === firstResultNodeId)?.text_column ??
      null)
    : null;
  const representativeWordsCount = host.topicModelingWordsPerTopic ?? 15;
  const rawTopics: TopicModelingTopic[] = result?.data.topics ?? [];
  const effectiveStopWords = stopWordsEnabled
    ? new Set(host.stopWords.map((word) => word.toLocaleLowerCase()))
    : new Set<string>();
  const exportTopics = filterTopicRepresentativeWords(rawTopics, effectiveStopWords);
  const topics = sliceTopicRepresentativeWords(exportTopics, representativeWordsCount);
  const addToWorkspaceSources: TopicModelingAddToWorkspaceSource[] = resultArtifacts.map(
    (node) => ({
      id: node.node_id,
      name: node.node_name,
      columns: node.original_columns,
      documentColumn: node.text_column,
    }),
  );

  const openAddToWorkspaceDialog = () => {
    const sourceIds = new Set(addToWorkspaceSources.map((source) => source.id));
    setAddToWorkspaceSourceIds(sourceIds);
    setAddToWorkspaceColumns(
      createDefaultTopicModelingAddToWorkspaceColumns(addToWorkspaceSources),
    );
    setAddToWorkspaceNames(
      Object.fromEntries(
        addToWorkspaceSources.map((source) => [source.id, `${source.name} topics`]),
      ),
    );
    setAddToWorkspaceDialogOpen(true);
  };

  const handleAddToWorkspace = async () => {
    if (!tabTaskId || addToWorkspaceSourceIds.size === 0) return;
    const nodeIds = addToWorkspaceSources
      .map((source) => source.id)
      .filter((nodeId) => addToWorkspaceSourceIds.has(nodeId));
    setIsAddingToWorkspace(true);
    try {
      await createTopicModelingDataBlocks(host.tabId, tabTaskId, {
        node_ids: nodeIds,
        selected_columns: Object.fromEntries(
          nodeIds.map((nodeId) => {
            const source = addToWorkspaceSources.find((candidate) => candidate.id === nodeId);
            const selected = new Set(addToWorkspaceColumns[nodeId] ?? []);
            return [nodeId, source?.columns.filter((column) => selected.has(column)) ?? []];
          }),
        ),
        new_node_names: Object.fromEntries(
          nodeIds.map((nodeId) => [nodeId, addToWorkspaceNames[nodeId]?.trim() ?? '']),
        ),
        topic_ids: selectedTopicIds.size > 0 ? [...selectedTopicIds] : null,
        topic_meanings_override: exportTopics.map((topic) => ({
          topic_id: topic.id,
          words: topic.representative_words.map((term) => term.word),
        })),
      });
      setAddToWorkspaceDialogOpen(false);
      toast.success('Adding Topic Modelling results to the Workspace.');
    } catch (cause) {
      toast.error('Failed to add Topic Modelling results.', {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setIsAddingToWorkspace(false);
    }
  };

  const { handleRun } = useTopicModelingTaskFlow({
    state: {
      currentWorkspaceId,
      tabId: host.tabId,
      panelNodeIds,
      panelHasMissingColumns,
      effectiveNodeColumnSelections,
      randomSeed,
      sampleFractions: hasAnySampling ? sampleFractionsForRequest : null,
      minTopicSize: topicSizeValue,
      segmentationMethod,
      maxSegmentTokens,
    },
    actions: {
      setIsRunning,
      runningRef,
      setError,
      setLocalTaskId,
      onSubmitted: refreshAnalyses,
      prepareBeforeRun: ensureNodeColors,
    },
  });

  const corpusCount = result?.data.corpus_sizes.length ?? 0;
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

  const colorNodeIds = result ? resultNodeIds : panelNodeIds;

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

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- this is a truthiness OR: a falsy banner/result/error must fall through to the next, so ?? would short-circuit incorrectly
  const shouldShowResultsPanel = Boolean(topicWaitingBanner || result || error);

  useProgressiveContextualHints([
    CONTEXTUAL_HINT_IDS.topicModeling.inputs,
    ...(!actionState.runDisabled ? [CONTEXTUAL_HINT_IDS.topicModeling.run] : []),
    ...(result
      ? [
          CONTEXTUAL_HINT_IDS.topicModeling.results,
          CONTEXTUAL_HINT_IDS.topicModeling.addToWorkspace,
        ]
      : []),
  ]);

  return (
    <div className="space-y-4">
      <TopicModelingParameterPanel
        nodeInputs={nodeInputs}
        onColumnChange={handleColumnChange}
        actionState={actionState}
        parametersLocked={parametersLocked}
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
        segmentationMethod={segmentationMethod}
        onSegmentationMethodChange={setSegmentationMethod}
        maxSegmentTokens={maxSegmentTokens}
        onMaxSegmentTokensChange={setMaxSegmentTokens}
        isRunning={isRunning}
        isStopping={isStopping}
        isClearing={isClearing}
        onRun={handleRun}
        onStop={
          activeAnalysis
            ? () => {
                void stopTask();
              }
            : undefined
        }
        onClear={handleClear}
        hasMissingColumns={panelHasMissingColumns}
        hasResult={Boolean(result ?? analysisError ?? error)}
        nodeColors={nodeColors}
        onNodeColorChange={(nodeId, color) => {
          setNodeColor(nodeId, color);
        }}
        defaultPalette={defaultPalette}
      />

      {shouldShowResultsPanel && (
        <TopicModelingResultsPanel
          topicWaitingBanner={topicWaitingBanner}
          runningTask={topicRunningTask}
          error={error ?? analysisError}
          result={result}
          topics={topics}
          exportTopics={exportTopics}
          containerRef={containerRef}
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
          nodeNames={resultNodeNames}
          randomSeed={resultRandomSeed}
          maxSegmentTokens={resultMaxSegmentTokens}
          onAddToWorkspace={openAddToWorkspaceDialog}
          isAddingToWorkspace={isAddingToWorkspace}
          wordsPerTopic={representativeWordsCount}
          onWordsPerTopicChange={(value) => {
            void host.setPresentationSettings({ topic_modeling_words_per_topic: value });
          }}
          stopWordsEnabled={stopWordsEnabled}
          onStopWordsEnabledChange={(enabled) => {
            if (!resultKey) return;
            setStopWordsEnabledForResult(enabled ? resultKey : null);
          }}
          stopWords={host.stopWords}
          stopWordsDetectionTarget={{
            workspaceId: currentWorkspaceId,
            nodeId: firstResultNodeId,
            column: firstResultColumn,
          }}
          onStopWordsChange={(words) => {
            return host.setPresentationSettings({ stop_words: words });
          }}
        />
      )}
      <TopicModelingAddToWorkspaceDialog
        open={addToWorkspaceDialogOpen}
        onOpenChange={setAddToWorkspaceDialogOpen}
        sources={addToWorkspaceSources}
        selectedSourceIds={addToWorkspaceSourceIds}
        selectedColumns={addToWorkspaceColumns}
        names={addToWorkspaceNames}
        selectedTopicCount={selectedTopicIds.size > 0 ? selectedTopicIds.size : null}
        isSubmitting={isAddingToWorkspace}
        onToggleSource={(nodeId) => {
          setAddToWorkspaceSourceIds((current) => {
            const next = new Set(current);
            if (next.has(nodeId)) next.delete(nodeId);
            else next.add(nodeId);
            return next;
          });
        }}
        onToggleColumn={(nodeId, column) => {
          setAddToWorkspaceColumns((current) => {
            const columns = current[nodeId] ?? [];
            return {
              ...current,
              [nodeId]: columns.includes(column)
                ? columns.filter((item) => item !== column)
                : [...columns, column],
            };
          });
        }}
        onNameChange={(nodeId, name) => {
          setAddToWorkspaceNames((current) => ({ ...current, [nodeId]: name }));
        }}
        onSubmit={() => {
          void handleAddToWorkspace();
        }}
      />
    </div>
  );
}

export default TopicModelingFeature;
