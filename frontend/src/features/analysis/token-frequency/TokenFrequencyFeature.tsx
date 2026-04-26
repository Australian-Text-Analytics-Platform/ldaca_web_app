import { useRef, useState } from 'react';
import { textApi, type TokenFrequencyResponse } from '../../../api/text';
import { useAuth } from '../../../hooks/useAuth';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '../../../hooks/useWorkspaceActions';
import { takeMostRecent } from '../../../utils/selectionUtils';

import { useNodeColumnInfos } from '../../../hooks/useNodeColumnInfos';
import {
  DEFAULT_TOKEN_LIMIT,
  parseAnalysisNodeRequest,
  getNodeIdentifier,
  resetAnalysisSelectionAfterClear,
  restoreAnalysisLockFromRequest,
  getAnalysisActionState,
} from '../common';
import {
  buildResponseDisplayNameHints,
  computeAnalysisNodeIds,
  deriveNodeDisplayResults,
  normalizeNodeResults,
} from './tokenFrequencyAdapters';
import { buildSelectionNameById, deriveBackendStopWordsKey, deriveBackendTokenLimit, type NodeNameEntry } from './tokenFrequencyUtils';
import {
  buildTokenFrequencyZipFilename,
  buildFrequencyExportFile,
  buildStopWordsExportFile,
  buildWordCloudExportFile,
  downloadExportBundleAsZip,
  downloadFrequencyRowsAs,
  downloadStopWordsAsTxt,
  downloadWordCloudAs,
  type FrequencyFormat,
  type WordCloudFormat,
} from './tokenFrequencyExport';
import { TokenFrequencyDownloadDialog, type DownloadDialogMode } from './components/TokenFrequencyDownloadDialog';
import { useTokenFrequencyPreferences } from './hooks/useTokenFrequencyPreferences';
import { useTokenFrequencyTaskFlow } from './hooks/useTokenFrequencyTaskFlow';
import {
  useAnalysisLock,
  useAnalysisFeature,
  useSafeResult,
  useNodeColorManagement,
} from '../common';
import { pruneTasksById } from '../../../hooks/analysisTaskUtils';
import { TokenFrequencyParameterPanel } from './components/panels/TokenFrequencyParameterPanel';
import { TokenFrequencyResultsPanel } from './components/panels/TokenFrequencyResultsPanel';
import { useAnalysisStore } from '../../../stores/analysisStore';
import { useUIStore } from '../../../stores/uiStore';

const MAX_TOKEN_LIMIT_INPUT = 100;
const UNIFIED_WORDCLOUD_WIDTH = 640;
const UNIFIED_WORDCLOUD_HEIGHT = 340;

const TOKEN_FREQUENCY_PALETTE = ['#3b82f6', '#ef4444', '#10b981', '#a855f7', '#f59e0b'];

const TokenFrequencyFeature = () => {
  const { getAuthHeaders } = useAuth();
  const { currentWorkspace } = useWorkspaceData();
  const {
    isLocked,
    unlockSelection,
    lockWithSnapshots,
    nodeColumnSelections,
    setNodeColumnSelection,
    setNodeColumnSelections,
    activeNodeIds,
    activeNodeColumnSelections,
    panelSelectedNodes,
  } = useAnalysisLock({
    analysisType: 'token_frequencies',
    workspaceId: currentWorkspace?.id ?? null,
    getAuthHeaders,
    allowedDataTypes: ['string'],
    maxNodes: 2,
  });
  const { selectedNodes } = useWorkspaceSelection();
  const { selectNodes } = useWorkspaceActions();
  const currentView = useUIStore((state) => state.currentView);
  const setCurrentView = useUIStore((state) => state.setCurrentView);
  const setPendingConcordance = useAnalysisStore((state) => state.setPendingConcordance);
  const setTasks = useAnalysisStore((state) => state.setTasks);

  const [results, resultRef, setResultSafely, setResults] = useSafeResult<TokenFrequencyResponse>();
  const [lastCompareNodeIds, setLastCompareNodeIds] = useState<string[]>([]);
  const [referenceNodeId, setReferenceNodeId] = useState<string | null>(null);

  const panelNodeIds = takeMostRecent(panelSelectedNodes, 2)
    .map((node, idx) => getNodeIdentifier(node, idx) || activeNodeIds[idx])
    .filter((id): id is string => Boolean(id));

  const effectiveReferenceNodeId = referenceNodeId && panelNodeIds.includes(referenceNodeId)
    ? referenceNodeId
    : panelNodeIds[0] ?? null;

  const orderedPanelNodeIds = (() => {
    if (!effectiveReferenceNodeId) return panelNodeIds;
    return [
      effectiveReferenceNodeId,
      ...panelNodeIds.filter((nodeId) => nodeId !== effectiveReferenceNodeId),
    ];
  })();

  const { nodeColors, handleColorChange, defaultPalette } = useNodeColorManagement({
    activeNodeIds: takeMostRecent(panelNodeIds, 2),
    palette: TOKEN_FREQUENCY_PALETTE,
  });

  const wordCloudRefs = useRef<Record<string, SVGSVGElement | null>>({});
  const unifiedCloudContainerRef = useRef<HTMLDivElement | null>(null);

  const currentWorkspaceId = currentWorkspace?.id ?? null;
  const isActiveTab = currentView === 'token-frequency';

  const {
    resolveTaskId,
    isRunning,
    setIsRunning,
    runningRef,
    taskStatus,
    hasActiveTask,
    lastFetchedRef,
    clearResults,
    setLocalTaskId,
  } = useAnalysisFeature<TokenFrequencyResponse>({
    analysisType: 'token_frequencies',
    taskType: 'token_frequencies',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    resultRef,
    fetchResult: (taskId, headers) =>
      textApi.getTokenFrequenciesTaskResult(taskId, headers) as Promise<TokenFrequencyResponse>,
    fetchRequest: async (taskId, headers) =>
      textApi.getTokenFrequenciesTaskRequest(taskId, headers),
    onResultFetched: (result) => setResultSafely(result),
    onHydratedResult: (result) => {
      if (!result) return;
      const requestData = result?.analysis_params ?? {};
      const { nodeIds, selections } = parseAnalysisNodeRequest(requestData, 2);
      setNodeColumnSelections(selections, { replace: true });
      setLastCompareNodeIds(nodeIds);
      setReferenceNodeId(nodeIds[0] ?? null);
      applyTokenLimitState(
        typeof requestData?.token_limit === 'number' ? requestData.token_limit : null,
      );
      setResultSafely(result);
      if (Array.isArray(result.stop_words)) {
        const normalizedStops = result.stop_words
          .map((word) => String(word).trim().toLowerCase())
          .filter(Boolean);
        setAppliedStopSet(new Set(normalizedStops));
        setStopWords(normalizedStops.join(', '));
      }
    },
    onHydratedRequest: async (requestPayload) => {
      const raw = requestPayload as Record<string, unknown> | null;
      const req = raw?.data ?? raw;
      if (!req || typeof req !== 'object') return;
      const reqObj = req as Record<string, unknown>;
      const nodeIds: string[] = Array.isArray(reqObj.node_ids) ? (reqObj.node_ids as string[]).slice(0, 2) : [];
      const node_columns: Record<string, string> = (reqObj.node_columns as Record<string, string>) || {};
      const sels = nodeIds.map((id: string) => ({ nodeId: id, column: node_columns[id] || '' }));
      setNodeColumnSelections(sels, { replace: true });
      setReferenceNodeId(nodeIds[0] ?? null);
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
      resetAnalysisSelectionAfterClear({ unlockSelection });
      setLastCompareNodeIds([]);
      setReferenceNodeId(null);
      resetPreferenceUiState();
    },
    pruneGlobalTasks: (taskIds) =>
      setTasks((prev) =>
        Array.isArray(prev) ? pruneTasksById(prev, taskIds) : prev,
      ),
  });

  const effectiveNodeColumnSelections = isLocked ? activeNodeColumnSelections : nodeColumnSelections;

  const getColorForNode = (nodeId: string, index = 0) => {
    return nodeColors[nodeId] ?? defaultPalette[index % defaultPalette.length] ?? '#000000';
  };

  const backendTokenLimit = deriveBackendTokenLimit(results);
  const backendStopWordsKey = deriveBackendStopWordsKey(results);

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
    handleFillDefaultStopWords,
    resetPreferenceUiState,
  } = useTokenFrequencyPreferences({
    currentWorkspaceId,
    results,
    setResults,
    getAuthHeaders,
    resolveTokenFrequencyTaskId: resolveTaskId,
    backendTokenLimit,
    backendStopWordsKey,
    maxTokenLimitInput: MAX_TOKEN_LIMIT_INPUT,
  });

  const lockedNodeNameMap = isLocked ? buildSelectionNameById(panelSelectedNodes as NodeNameEntry[], panelSelectedNodes as NodeNameEntry[]) : {};

  const nodeIdToName = (() => {
    const map: Record<string, string> = {};
    panelSelectedNodes.forEach((node) => {
      const nodeId = typeof node.id === 'string' ? node.id : '';
      if (!nodeId) return;
      map[nodeId] = (node.name || node.label || nodeId) as string;
    });
    return map;
  })();

  const { handleAnalyze, handleTokenClick, handleTokenRightClick } = useTokenFrequencyTaskFlow({
    state: {
      currentWorkspaceId,
      panelNodeIds: orderedPanelNodeIds,
      panelSelectedNodes,
      effectiveNodeColumnSelections,
      stopWords,
      results,
      lockedNodeNameMap,
      nodeIdToName,
      nodeColors,
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
    },
    lock: {
      getAuthHeaders,
      lockWithSnapshots,
    },
    navigation: {
      selectNodes,
      setPendingConcordance,
      setCurrentView,
      applyStopSetFromText,
      getColorForNode,
    },
  });

  const responseDisplayNameHints = buildResponseDisplayNameHints(results);
  const displayNameMap = {
    ...responseDisplayNameHints,
    ...lockedNodeNameMap,
  };

  const computeDisplayName = (nodeId: string, fallbackKey?: string) => {
    if (displayNameMap[nodeId]) return displayNameMap[nodeId];
    if (nodeIdToName[nodeId]) return nodeIdToName[nodeId];
    return fallbackKey || nodeId || 'Unknown node';
  };

  const analysisNodeIds = computeAnalysisNodeIds(
    (results?.analysis_params as Record<string, unknown> | null | undefined)?.node_ids,
    lastCompareNodeIds,
    effectiveNodeColumnSelections
  );

  const normalizedNodeResults = normalizeNodeResults(results?.data, analysisNodeIds, computeDisplayName);
  const nodeDisplayResults = deriveNodeDisplayResults(normalizedNodeResults, appliedStopSet, effectiveTokenLimit);

  const registerWordCloudRef = (nodeKey: string, element: SVGSVGElement | null) => {
    if (!element) {
      Reflect.deleteProperty(wordCloudRefs.current, nodeKey);
      return;
    }
    wordCloudRefs.current[nodeKey] = element;
  };

  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadDialogMode, setDownloadDialogMode] = useState<DownloadDialogMode>('wordcloud');
  const pendingDownloadRef = useRef<{
    mode: DownloadDialogMode;
    nodeKey?: string;
    displayName?: string;
    rows?: unknown[];
    label?: string;
  } | null>(null);

  const handleDownloadWordCloud = (nodeKey: string, displayName: string) => {
    pendingDownloadRef.current = { mode: 'wordcloud', nodeKey, displayName };
    setDownloadDialogMode('wordcloud');
    setDownloadDialogOpen(true);
  };

  const renameStatisticsKeysForExport = (rows: unknown[]): unknown[] => {
    if (analysisNodeIds.length !== 2) return rows;
    const referenceName = computeDisplayName(analysisNodeIds[0]!, 'reference');
    const studyName = computeDisplayName(analysisNodeIds[1]!, 'study');
    const keyMap: Record<string, string> = {
      freq_reference: `OR_${referenceName}`,
      freq_study: `OS_${studyName}`,
      percent_reference: `%R_${referenceName}`,
      percent_study: `%S_${studyName}`,
      expected_reference: `E_${referenceName}`,
      expected_study: `E_${studyName}`,
      reference_total: `Total_${referenceName}`,
      study_total: `Total_${studyName}`,
      overuse: 'Overuse',
      signed_ll: 'Signed_LL',
    };
    return rows.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const source = row as Record<string, unknown>;
      const renamed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(source)) {
        renamed[keyMap[key] ?? key] = value;
      }
      return renamed;
    });
  };

  const handleDownloadFrequencyCsv = (label: string, rows: unknown[]) => {
    const exportRows = label === 'token-keyness' ? renameStatisticsKeysForExport(rows) : rows;
    pendingDownloadRef.current = { mode: 'frequencies', label, rows: exportRows };
    setDownloadDialogMode('frequencies');
    setDownloadDialogOpen(true);
  };

  const handleDownloadConfirm = async ({ format, includeStopWords }: { format: string; includeStopWords: boolean }) => {
    const ctx = pendingDownloadRef.current;
    if (!ctx) return;

    const archiveLabel = ctx.label || ctx.displayName || ctx.nodeKey || 'analysis';
    const shouldBundleStopWords = includeStopWords && Boolean(stopWords);
    const comparisonArchiveLabels = analysisNodeIds
      .slice(0, 2)
      .map((nodeId, index) => computeDisplayName(nodeId, `node-${index + 1}`));

    try {
      if (ctx.mode === 'wordcloud' && ctx.nodeKey) {
        const svg = wordCloudRefs.current[ctx.nodeKey];
        if (svg) {
          if (shouldBundleStopWords) {
            const primaryFile = await buildWordCloudExportFile(svg, {
              displayName: ctx.displayName || ctx.nodeKey,
              fallbackKey: ctx.nodeKey,
              format: format as WordCloudFormat,
              scale: 3,
            });

            const zipFilename = ctx.nodeKey === 'unified'
              ? buildTokenFrequencyZipFilename(comparisonArchiveLabels)
              : buildTokenFrequencyZipFilename([archiveLabel]);

            await downloadExportBundleAsZip(zipFilename, [
              primaryFile,
              buildStopWordsExportFile(stopWords, archiveLabel),
            ]);
          } else {
            downloadWordCloudAs(svg, {
              displayName: ctx.displayName || ctx.nodeKey,
              fallbackKey: ctx.nodeKey,
              format: format as WordCloudFormat,
              scale: 3,
            });
          }
        }
      } else if (ctx.mode === 'frequencies' && ctx.rows) {
        if (shouldBundleStopWords) {
          await downloadExportBundleAsZip(buildTokenFrequencyZipFilename([archiveLabel]), [
            buildFrequencyExportFile(
              ctx.label || 'frequencies',
              ctx.rows as Array<Record<string, unknown>>,
              format as FrequencyFormat,
            ),
            buildStopWordsExportFile(stopWords, archiveLabel),
          ]);
        } else {
          downloadFrequencyRowsAs(
            ctx.label || 'frequencies',
            ctx.rows as Array<Record<string, unknown>>,
            format as FrequencyFormat,
          );
        }
      } else if (shouldBundleStopWords) {
        downloadStopWordsAsTxt(stopWords, archiveLabel);
      }
    } finally {
      pendingDownloadRef.current = null;
    }
  };

  const handleApplyStopWords = () => {
    applyStopSetFromText(stopWords);
  };

  const hasIncompleteSelections = effectiveNodeColumnSelections.some((selection) => !selection.column);
  const displayNodeCount = panelSelectedNodes.length;

  const actionState = getAnalysisActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    hasSelection: panelSelectedNodes.length > 0 && !hasIncompleteSelections,
    isLocked,
    hasResults: Boolean(results),
    isBusy: isRunning,
    hasActiveTask,
    allowRunWhenLocked: false,
  });

  const handleColumnChange = (nodeId: string, column: string) => {
    if (isLocked) return;
    setNodeColumnSelection(nodeId, column);
  };

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
    enabled: true,
  });

  return (
    <div className="space-y-4">
      <TokenFrequencyParameterPanel
        panelSelectedNodes={panelSelectedNodes}
        effectiveNodeColumnSelections={effectiveNodeColumnSelections}
        onColumnChange={handleColumnChange}
        nodeColors={nodeColors}
        onColorChange={handleColorChange}
        defaultPalette={defaultPalette}
        isLocked={isLocked}
        getNodeColumns={getColumnInfos}
        displayNodeCount={displayNodeCount}
        actionState={actionState}
        isAnalyzing={isRunning}
        onAnalyze={handleAnalyze}
        onClearResults={clearResults}
        hasIncompleteSelections={hasIncompleteSelections}
        appliedStopCount={appliedStopSet.size}
        hasResults={Boolean(results)}
        runLabel={actionState.runLabel}
        referenceNodeId={effectiveReferenceNodeId}
        onReferenceNodeChange={setReferenceNodeId}
        getColorForNode={getColorForNode}
        computeDisplayName={computeDisplayName}
      />

      <TokenFrequencyResultsPanel
        results={results}
        isRunning={isRunning || Boolean(taskStatus.runningTask)}
        runningTask={taskStatus.runningTask}
        stopWords={stopWords}
        onStopWordsChange={setStopWords}
        onStopWordsApply={handleApplyStopWords}
        isLoadingStopWords={isLoadingStopWords}
        onFillDefaultStopWords={handleFillDefaultStopWords}
        onSortStopWords={sortStopWords}
        tokenLimitInput={tokenLimitInput}
        onTokenLimitInputChange={handleTokenLimitInputChange}
        onTokenLimitBlur={handleTokenLimitBlur}
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
        onDownloadWordCloud={handleDownloadWordCloud}
        onTokenClick={handleTokenClick}
        onTokenRightClick={handleTokenRightClick}
        unifiedCloudWidth={UNIFIED_WORDCLOUD_WIDTH}
        unifiedCloudHeight={UNIFIED_WORDCLOUD_HEIGHT}
        unifiedCloudContainerRef={unifiedCloudContainerRef}
        registerWordCloudRef={registerWordCloudRef}
        onDownloadFrequencyCsv={handleDownloadFrequencyCsv}
      />

      <TokenFrequencyDownloadDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        mode={downloadDialogMode}
        onConfirm={handleDownloadConfirm}
      />
    </div>
  );
};

export default TokenFrequencyFeature;
