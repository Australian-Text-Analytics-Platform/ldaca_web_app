import { useRef, useState } from 'react';
import { textApi, type TokenFrequencyResponse } from '../../../api/text';
import { useAuth } from '../../../hooks/useAuth';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '../../../hooks/useWorkspaceActions';

import { useNodeColumnInfos } from '../../../hooks/useNodeColumnInfos';
import {
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
  filterStatisticsByStopWords,
  normalizeNodeResults,
  sortStatistics,
} from './tokenFrequencyAdapters';
import { buildSelectionNameById, deriveBackendStopWordsKey, deriveBackendTokenLimit, type NodeNameEntry } from './tokenFrequencyUtils';
import {
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

const DEFAULT_TOKEN_LIMIT = 100;
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
  const [statsSortColumn, setStatsSortColumn] = useState<string>('log_likelihood_llv');
  const [statsSortDirection, setStatsSortDirection] = useState<'asc' | 'desc'>('desc');
  const [statsPage, setStatsPage] = useState<number>(1);
  const [statsRowsPerPage, setStatsRowsPerPage] = useState<number>(50);

  const panelNodeIds = panelSelectedNodes
    .slice(0, 2)
    .map((node, idx) => getNodeIdentifier(node, idx) || activeNodeIds[idx])
    .filter((id): id is string => Boolean(id));

  const { nodeColors, handleColorChange, defaultPalette } = useNodeColorManagement({
    activeNodeIds: panelNodeIds.slice(0, 2),
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
      resetPreferenceUiState();
    },
    pruneGlobalTasks: (taskIds) =>
      setTasks((prev) =>
        Array.isArray(prev) ? pruneTasksById(prev, taskIds) : prev,
      ),
  });

  const effectiveNodeColumnSelections = isLocked ? activeNodeColumnSelections : nodeColumnSelections;

  const getColorForNode = (nodeId: string, index = 0) => {
    return nodeColors[nodeId] ?? defaultPalette[index % defaultPalette.length];
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
      panelNodeIds,
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
  const filteredStatistics = filterStatisticsByStopWords(results?.statistics, appliedStopSet);
  const sortedStatistics = sortStatistics(filteredStatistics, statsSortColumn, statsSortDirection);

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

  const handleDownloadFrequencyCsv = (label: string, rows: unknown[]) => {
    pendingDownloadRef.current = { mode: 'frequencies', label, rows };
    setDownloadDialogMode('frequencies');
    setDownloadDialogOpen(true);
  };

  const handleDownloadConfirm = async ({ format, includeStopWords }: { format: string; includeStopWords: boolean }) => {
    const ctx = pendingDownloadRef.current;
    if (!ctx) return;

    const archiveLabel = ctx.label || ctx.displayName || ctx.nodeKey || 'analysis';
    const shouldBundleStopWords = includeStopWords && Boolean(stopWords);

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

            await downloadExportBundleAsZip(archiveLabel, [
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
          await downloadExportBundleAsZip(archiveLabel, [
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

  const handleToggleStatsSort = (column: string) => {
    if (statsSortColumn === column) {
      setStatsSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      setStatsSortColumn(column);
      setStatsSortDirection(column === 'token' ? 'asc' : 'desc');
    }
    setStatsPage(1);
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
    <div className="space-y-6">
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
        sortedStatistics={sortedStatistics}
        statsSortColumn={statsSortColumn}
        statsSortDirection={statsSortDirection}
        onToggleStatsSort={handleToggleStatsSort}
        statsPage={statsPage}
        onStatsPageChange={setStatsPage}
        statsRowsPerPage={statsRowsPerPage}
        onStatsRowsPerPageChange={setStatsRowsPerPage}
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
