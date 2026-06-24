import { useRef, useState } from 'react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useNodeColumnInfos } from '@/features/workspace/common/hooks/useNodeColumnInfos';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { aiAnnotationTaskRequest, aiAnnotationTaskResult } from '@/api';
import type { AiAnnotationResponse, AnalysisTabInput } from '@/api';
import { Button } from '@/components/ui/button';
import { AnalysisCardLayout } from '../common/components/AnalysisCardLayout';
import AnalysisTaskBanner from '@/features/views/common/components/AnalysisTaskBanner';
import { useUIStore } from '@/stores/uiStore';
import { getNodeIdentifier, useAnalysisFeature } from '../common';
import { nodeInputsFromSelections, useTabNodeInputs } from '../common/nodeInputs';
import { Loader2, RotateCcw, Sparkles } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { useServerTable } from '@/features/views/common/hooks/useServerTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { normalizeTypeName } from '@/features/workspace/data-view/utils/columnTypes';
import { AiAnnotationNodeColumnFields } from './components/AiAnnotationNodeColumnFields';
import { AiAnnotationParameterPanel } from './components/AiAnnotationParameterPanel';
import { AiAnnotationResultPanel } from './components/AiAnnotationResultPanel';
import { AiAnnotationReviewPanel } from './components/AiAnnotationReviewPanel';
import { useAiAnnotationSettings } from './hooks/useAiAnnotationSettings';
import { useAiAnnotationResultControls } from './hooks/useAiAnnotationResultControls';
import { useAiAnnotationReviewWorkflow } from './hooks/useAiAnnotationReviewWorkflow';
import { useAiAnnotationTaskFlow } from './hooks/useAiAnnotationTaskFlow';

/** Keeps result paging consistent across the annotation and review tables in this feature. */
const DEFAULT_PAGE_SIZE = 5;

// Stable empty references for the footer-only TanStack tables: the annotate and
// review tables render their bespoke (editable / multi-header) bodies manually;
// these instances exist solely to drive ServerPaginationFooter page math from
// rowCount (the backend's source-row totals).
const EMPTY_ANNOTATOR_ROWS: Record<string, unknown>[] = [];
const EMPTY_ANNOTATOR_COLUMNS: ColumnDef<Record<string, unknown>>[] = [];

/** Provides the AI annotation workspace tab, including task launch, result review, save, and detach flows. */
/**
 * Rendered by: the analysis feature registry when this panel is selected because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: read workspace/auth state, derive inputs and analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 */
function AiAnnotatorFeature() {
  const { currentWorkspaceId } = useWorkspaceData();
  const { getAuthHeaders } = useAuth();
  const currentView = useUIStore((state) => state.currentView);
  const isActiveTab = currentView === 'ai-annotator';
  const {
    endpointPreset,
    setEndpointPreset,
    model,
    setModel,
    classesText,
    setClassesText,
    examplesText,
    setExamplesText,
    temperature,
    setTemperature,
    topP,
    setTopP,
    seed,
    setSeed,
    apiKey,
    setApiKey,
    customBaseUrl,
    setCustomBaseUrl,
    batchSize,
    setBatchSize,
    baseUrl,
    parsedClasses,
    parsedExamples,
    resetSettings,
  } = useAiAnnotationSettings();

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<'ai-annotation' | 'review'>('ai-annotation');
  const aiAnnotationResultRef = useRef<AiAnnotationResponse | null>(null);

  // AI annotation tab: optional target annotation column
  const [aiAnnotationColumn, setAiAnnotationColumn] = useState('');
  const [inputNodes, setInputNodes] = useState<AnalysisTabInput[]>([]);

  const nodeInputs = useTabNodeInputs({
    tabInputs: inputNodes,
    onTabInputsChange: setInputNodes,
    constraints: {
      allowedDataTypes: ['string'],
      maxNodes: 1,
      docTypeOnly: true,
    },
  });
  const displayedNodes = nodeInputs.selectedNodes.slice(0, 1);
  const displayedNodeIds = displayedNodes
    .map((node, idx) => getNodeIdentifier(node, idx))
    .filter((id): id is string => Boolean(id));

  const effectiveSelections = nodeInputs.nodeColumnSelections.filter((selection) =>
    displayedNodeIds.includes(selection.nodeId),
  );

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: displayedNodes,
  });

  // Keeps each selected node tied to the text column the AI request should annotate.
  /**
   * Called by: AiAnnotatorFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleColumnChange = (nodeId: string, column: string) => {
    nodeInputs.setColumn(nodeId, column);
  };

  const selectedNodeId = displayedNodeIds[0] ?? null;
  const selectedColumn = effectiveSelections[0]?.column ?? '';
  const selectedNodeLabel = selectedNodeId
    ? // empty node names and ids should fall through to the stable selected id
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      displayedNodes[0]?.name || displayedNodes[0]?.id || selectedNodeId
    : null;
  const {
    resultNodeId,
    resultNode,
    resultRows,
    availableMetadataColumns,
    selectedMetadataColumns,
    setSelectedMetadataColumns,
    visibleColumns,
    pagination,
    page,
    pageSize,
    isPaging,
    setIsPaging,
    applyResponseResult,
    resetAfterClear: resetResultControlsAfterClear,
  } = useAiAnnotationResultControls({
    selectedColumn,
    defaultPageSize: DEFAULT_PAGE_SIZE,
  });
  const {
    reviewTextColumn,
    setReviewTextColumn,
    reviewAnnotationColumn,
    setReviewAnnotationColumn,
    reviewData,
    reviewNodeId,
    isReviewLoading,
    isReviewPaging,
    reviewGlobalProviders,
    reviewGlobalCategories,
    temporaryCategories,
    reviewEdits,
    savingReviewCells,
    additionalProviders,
    newProviderName,
    setNewProviderName,
    isAddAnnotatorDialogOpen,
    setIsAddAnnotatorDialogOpen,
    isAddCategoryDialogOpen,
    handleAddCategoryDialogOpenChange,
    newCategoryName,
    setNewCategoryName,
    reviewRunDisabled,
    reviewPagination,
    reviewPageNum,
    reviewPageSizeNum,
    handleAddProvider,
    loadReviewPage,
    refreshCategoryCache,
    handleReview,
    handleCategorySelected,
    handleConfirmAddCategory,
  } = useAiAnnotationReviewWorkflow({
    currentWorkspaceId,
    selectedNodeId,
    getAuthHeaders,
    setStatusMessage,
    defaultPageSize: DEFAULT_PAGE_SIZE,
  });

  const {
    resolveTaskId,
    localTaskId,
    setLocalTaskId,
    clearResults,
    stopTask,
    isStopping,
    banner: aiAnnotationWaitingBanner,
  } = useAnalysisFeature<AiAnnotationResponse>({
    analysisType: 'ai_annotation',
    taskType: 'ai_annotation',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    resultRef: aiAnnotationResultRef,
    // Loads the latest annotation result for lifecycle polling and tab hydration.
    // Called by: AiAnnotatorFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    fetchResult: async (taskId, headers) => {
      const { data } = await aiAnnotationTaskResult({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    // Recovers the submitted request so locked selections can be restored after reloads.
    // Called by: AiAnnotatorFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    fetchRequest: async (taskId, headers) => {
      const { data } = await aiAnnotationTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    // Pushes freshly fetched results into local refs and user-facing status state.
    // Called by: AiAnnotatorFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    onResultFetched: (result, _fetchedTaskId) => {
      aiAnnotationResultRef.current = result;
      applyResponseResult(result);
      setStatusMessage(result.message);
    },
    // Rehydrates persisted result payloads when the tab regains a known task.
    // Called by: AiAnnotatorFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    // eslint-disable-next-line @typescript-eslint/require-await
    onHydratedResult: async (resultPayload) => {
      const hydrated = resultPayload ?? null;
      aiAnnotationResultRef.current = hydrated;
      applyResponseResult(hydrated);
      if (hydrated?.message) {
        setStatusMessage(hydrated.message);
      }
    },
    // Restores annotation request parameters enough to rebuild the analysis lock.
    // Called by: AiAnnotatorFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned. Flow: normalize inputs, derive state, then return the analysis result expected by callers.
    onHydratedRequest: (requestPayload) => {
      const requestData = (requestPayload as Record<string, unknown> | null) ?? null;
      if (!requestData) {
        return;
      }

      const hydratedAnnotationColumn = requestData.annotation_column;
      setAiAnnotationColumn(
        typeof hydratedAnnotationColumn === 'string' ? hydratedAnnotationColumn : '',
      );
      const nodeIds = Array.isArray(requestData.node_ids)
        ? (requestData.node_ids as string[]).slice(0, 1)
        : [];
      const nodeColumns = (requestData.node_columns ?? {}) as Record<string, string>;
      if (inputNodes.length === 0) {
        setInputNodes(
          nodeInputsFromSelections(
            nodeIds.map((nodeId) => ({ nodeId, column: nodeColumns[nodeId] ?? null })),
          ),
        );
      }
    },
    // Resets local annotation state after the shared analysis lifecycle clears the task.
    // Called by: AiAnnotatorFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    onCleared: () => {
      aiAnnotationResultRef.current = null;
      resetResultControlsAfterClear();
      setStatusMessage('AI annotation state cleared.');
    },
  });

  const {
    isRunning,
    isClearing,
    isLoadingModels,
    availableModels,
    isDetaching,
    loadResultPage,
    handleLoadModels,
    resetParameters,
    handleDetach,
    handleRun,
    handleClear,
  } = useAiAnnotationTaskFlow({
    currentWorkspaceId,
    selectedNodeId,
    selectedColumn,
    selectedNodeLabel,
    aiAnnotationColumn,
    parsedClasses,
    parsedExamples,
    model,
    setModel,
    apiKey,
    baseUrl,
    temperature,
    topP,
    seed,
    batchSize,
    endpointPreset,
    customBaseUrl,
    getAuthHeaders,
    setStatusMessage,
    localTaskId,
    resolveTaskId,
    setLocalTaskId,
    clearResults,
    resultRef: aiAnnotationResultRef,
    applyResponseResult,
    setIsPaging,
    resetSettings,
    defaultPageSize: DEFAULT_PAGE_SIZE,
  });

  const runDisabled =
    !currentWorkspaceId ||
    !selectedNodeId ||
    !selectedColumn ||
    !model.trim() ||
    parsedClasses.length === 0 ||
    isRunning;

  const clearDisabled = !localTaskId && !statusMessage && !isClearing;

  const modelNames = availableModels.map((m) => m.id);
  // Shared column infos for selector UIs in both tabs
  const currentNodeColumnInfos = selectedNodeId ? getColumnInfos(displayedNodes[0]) : [];
  const aiStringColumns = currentNodeColumnInfos.filter(
    (ci) => normalizeTypeName(ci.dataType) === 'string',
  );
  const aiAnnotationColumns = currentNodeColumnInfos.filter(
    (ci) => normalizeTypeName(ci.dataType) === 'annotation',
  );

  // Footer-only TanStack instance for the annotate results table (the bespoke
  // body renders manually). rowCount mirrors the backend's source-row total so
  // the shared footer derives the same page count as the old props-based footer.
  const annotatePaginationTable = useServerTable<Record<string, unknown>>({
    data: EMPTY_ANNOTATOR_ROWS,
    columns: EMPTY_ANNOTATOR_COLUMNS,
    rowCount: pagination?.total_source_rows ?? 0,
    pageIndex: page - 1,
    pageSize,
    onPaginationChange: (next) => {
      if (next.pageSize !== pageSize) {
        void loadResultPage(1, next.pageSize);
        return;
      }
      const newPage = next.pageIndex + 1;
      if (newPage !== page) void loadResultPage(newPage, pageSize);
    },
  });

  // Footer-only TanStack instance for the review table (editable multi-header
  // body renders manually). Page/size mirror reviewData's pagination.
  const reviewPaginationTable = useServerTable<Record<string, unknown>>({
    data: EMPTY_ANNOTATOR_ROWS,
    columns: EMPTY_ANNOTATOR_COLUMNS,
    rowCount: reviewPagination?.total_source_rows ?? 0,
    pageIndex: reviewPageNum - 1,
    pageSize: reviewPageSizeNum,
    onPaginationChange: (next) => {
      if (!reviewNodeId) return;
      const sizeChanged = next.pageSize !== reviewPageSizeNum;
      const targetPage = sizeChanged ? 1 : next.pageIndex + 1;
      const targetPageSize = sizeChanged ? next.pageSize : reviewPageSizeNum;
      if (!sizeChanged && targetPage === reviewPageNum) return;
      void Promise.all([
        loadReviewPage(
          reviewNodeId,
          reviewTextColumn,
          reviewAnnotationColumn,
          targetPage,
          targetPageSize,
        ),
        refreshCategoryCache(reviewNodeId, reviewAnnotationColumn),
      ]);
    },
  });

  return (
    <div className="space-y-4">
      {aiAnnotationWaitingBanner ? (
        <AnalysisTaskBanner
          analysisName="AI Annotation"
          status={aiAnnotationWaitingBanner.status}
          taskId={aiAnnotationWaitingBanner.taskId}
          message={aiAnnotationWaitingBanner.message}
          className="mt-4"
        />
      ) : null}

      <AnalysisCardLayout
        title="AI Annotation and Review"
        info={{
          targetKey: 'ai-annotator.overview',
          label: 'About AI Annotation and Review',
          tooltip: 'Learn what AI annotation is and how it can help you.',
        }}
        actions={
          panelTab === 'ai-annotation'
            ? {
                onRun: handleRun,
                // Stops the active annotation task from the shared layout action.
                // Called by: AiAnnotatorFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
                onStop: () => {
                  void stopTask();
                },
                onClear: handleClear,
                runDisabled,
                clearDisabled,
                isRunning,
                isStopping,
                isClearing,
                hasResult: Boolean(localTaskId),
                extraContent: (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        void handleLoadModels();
                      }}
                      disabled={isLoadingModels || isRunning}
                    >
                      {isLoadingModels ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading Models
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4" />
                          Refresh Models
                        </>
                      )}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetParameters}
                      disabled={isRunning || isClearing}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Reset Parameters
                    </Button>
                  </div>
                ),
              }
            : {
                onRun: handleReview,
                onClear: handleClear,
                runDisabled: reviewRunDisabled,
                clearDisabled,
                isRunning: isReviewLoading,
                isClearing,
                hasResult: Boolean(reviewData),
                runLabel: isReviewLoading ? 'Reviewing' : 'Review',
              }
        }
      >
        <p className="mb-4 text-sm font-medium text-red-600 dark:text-red-400">
          This tool is under development and not ready to be used. In order to use GenAI assisted
          coding, you will need to have a valid API key from a commercial provider, or deploy a
          local GenAI model and setup the endpoint correctly.
        </p>
        <Tabs
          value={panelTab}
          onValueChange={(value) => {
            setPanelTab(value as 'ai-annotation' | 'review');
          }}
        >
          <TabsList className="mb-4">
            <TabsTrigger value="ai-annotation">AI Annotation</TabsTrigger>
            <TabsTrigger value="review">Review</TabsTrigger>
          </TabsList>

          <TabsContent value="ai-annotation" className="mt-0">
            <AiAnnotationParameterPanel
              nodeInputs={nodeInputs}
              textColumn={selectedColumn}
              textColumns={aiStringColumns}
              annotationColumn={aiAnnotationColumn}
              annotationColumns={aiAnnotationColumns}
              endpointPreset={endpointPreset}
              model={model}
              modelNames={modelNames}
              isLoadingModels={isLoadingModels}
              customBaseUrl={customBaseUrl}
              apiKey={apiKey}
              classesText={classesText}
              examplesText={examplesText}
              temperature={temperature}
              topP={topP}
              seed={seed}
              batchSize={batchSize}
              onNodeColumnChange={handleColumnChange}
              onTextColumnChange={(value) => {
                if (selectedNodeId) handleColumnChange(selectedNodeId, value);
              }}
              onAnnotationColumnChange={setAiAnnotationColumn}
              onEndpointPresetChange={setEndpointPreset}
              onModelChange={setModel}
              onCustomBaseUrlChange={setCustomBaseUrl}
              onApiKeyChange={setApiKey}
              onClassesTextChange={setClassesText}
              onExamplesTextChange={setExamplesText}
              onTemperatureChange={setTemperature}
              onTopPChange={setTopP}
              onSeedChange={setSeed}
              onBatchSizeChange={setBatchSize}
            />
          </TabsContent>

          <TabsContent value="review" className="mt-0">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Review Annotations</h3>
                <p className="text-xs text-muted-foreground">
                  Select a node, text column, and annotation column to review and edit annotations.
                </p>
              </div>

              <AiAnnotationNodeColumnFields
                nodeInputs={nodeInputs}
                textColumn={reviewTextColumn}
                textColumns={aiStringColumns}
                annotationColumn={reviewAnnotationColumn}
                annotationColumns={aiAnnotationColumns}
                textSelectId="review-text-column"
                annotationSelectId="review-annotation-column"
                onNodeColumnChange={handleColumnChange}
                onTextColumnChange={setReviewTextColumn}
                onAnnotationColumnChange={setReviewAnnotationColumn}
              />
            </div>
          </TabsContent>
        </Tabs>

        {statusMessage ? (
          <div className="mt-4 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {statusMessage}
            {localTaskId ? (
              <span className="ml-2 font-mono text-xs">Task: {localTaskId}</span>
            ) : null}
          </div>
        ) : null}
      </AnalysisCardLayout>

      {/* AI Annotation result panel */}
      {panelTab === 'ai-annotation' && resultNode && resultNodeId ? (
        <AiAnnotationResultPanel
          resultNodeId={resultNodeId}
          rows={resultRows}
          visibleColumns={visibleColumns}
          availableMetadataColumns={availableMetadataColumns}
          selectedMetadataColumns={selectedMetadataColumns}
          onSelectedMetadataColumnsChange={setSelectedMetadataColumns}
          table={annotatePaginationTable}
          pageIndex={page - 1}
          pageSize={pageSize}
          rowCount={pagination?.total_source_rows ?? 0}
          loading={isPaging}
          isDetaching={isDetaching}
          detachDisabled={
            isDetaching ||
            isRunning ||
            !selectedNodeId ||
            !selectedColumn ||
            parsedClasses.length === 0
          }
          onDetach={() => {
            void handleDetach();
          }}
        />
      ) : null}

      {/* Review result panel */}
      {panelTab === 'review' && reviewData && reviewNodeId ? (
        <AiAnnotationReviewPanel
          reviewData={reviewData}
          reviewNodeId={reviewNodeId}
          reviewTextColumn={reviewTextColumn}
          reviewAnnotationColumn={reviewAnnotationColumn}
          reviewGlobalProviders={reviewGlobalProviders}
          additionalProviders={additionalProviders}
          reviewGlobalCategories={reviewGlobalCategories}
          temporaryCategories={temporaryCategories}
          reviewEdits={reviewEdits}
          savingReviewCells={savingReviewCells}
          table={reviewPaginationTable}
          pageIndex={reviewPageNum - 1}
          pageSize={reviewPageSizeNum}
          rowCount={reviewPagination?.total_source_rows ?? 0}
          loading={isReviewPaging}
          isAddAnnotatorDialogOpen={isAddAnnotatorDialogOpen}
          onAddAnnotatorDialogOpenChange={setIsAddAnnotatorDialogOpen}
          newProviderName={newProviderName}
          onNewProviderNameChange={setNewProviderName}
          onAddProvider={handleAddProvider}
          isAddCategoryDialogOpen={isAddCategoryDialogOpen}
          onAddCategoryDialogOpenChange={handleAddCategoryDialogOpenChange}
          newCategoryName={newCategoryName}
          onNewCategoryNameChange={setNewCategoryName}
          onConfirmAddCategory={handleConfirmAddCategory}
          onCategorySelected={handleCategorySelected}
        />
      ) : null}
    </div>
  );
}

export default AiAnnotatorFeature;
