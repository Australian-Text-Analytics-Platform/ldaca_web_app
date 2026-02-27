import { useCallback, useEffect, useRef, useState } from 'react';
import { textApi, type TokenFrequencyResponse } from '../../../api/text';
import { useAuth } from '../../../hooks/useAuth';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../../hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '../../../hooks/useWorkspaceActions';

import { useNodeColumnInfos } from '../../../hooks/useNodeColumnInfos';
import {
  hasLockedParameterDiff,
  normalizeCommaSeparatedWords,
  normalizeRequestStopWords,
  parseAnalysisNodeRequest,
} from '../common';
import {
  buildResponseDisplayNameHints,
  computeAnalysisNodeIds,
  deriveNodeDisplayResults,
  filterStatisticsByStopWords,
  normalizeNodeResults,
  sortStatistics,
} from './tokenFrequencyAdapters';
import { buildSelectionNameById, deriveBackendStopWordsKey, deriveBackendTokenLimit } from './tokenFrequencyUtils';
import { downloadFrequencyRowsAsCsv, downloadWordCloudSvgAsPng } from './tokenFrequencyExport';
import { useTokenFrequencyPreferences } from './hooks/useTokenFrequencyPreferences';
import { useTokenFrequencyTaskFlow } from './hooks/useTokenFrequencyTaskFlow';
import {
  useAnalysisLock,
  useAnalysisFeature,
  useSafeResult,
} from '../common';
import { pruneTasksById } from '../../../hooks/analysisTaskUtils';
import { TokenFrequencyParameterPanel } from './components/panels/TokenFrequencyParameterPanel';
import { TokenFrequencyResultsPanel } from './components/panels/TokenFrequencyResultsPanel';
import { useAnalysisStore } from '../../../stores/analysisStore';
import { useUIStore } from '../../../stores/uiStore';

const DEFAULT_TOKEN_LIMIT = 100;
const MAX_TOKEN_LIMIT_INPUT = 100;
const UNIFIED_WORDCLOUD_HEIGHT = 480;

const PALETTE = ['#3b82f6', '#ef4444', '#10b981', '#a855f7', '#f59e0b'];

const TokenFrequencyFeature = () => {
  const { getAuthHeaders } = useAuth();
  const { currentWorkspace } = useWorkspaceData();
  const {
    isLocked,
    serverRequest,
    unlockSelection,
    lockWithSnapshots,
    nodeColumnSelections,
    setNodeColumnSelection,
    setNodeColumnSelections,
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
  const [nodeColors, setNodeColors] = useState<Record<string, string>>({});

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
    onResultFetched: (result) => setResultSafely(result),
    onHydratedResult: (result) => {
      if (!result) return;
      const requestData = (result as any)?.analysis_params ?? {};
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
    onCleared: () => {
      setResultSafely(null);
      unlockSelection();
      setLastCompareNodeIds([]);
      resetPreferenceUiState();
    },
    pruneGlobalTasks: (taskIds) =>
      setTasks((prev: any[]) =>
        Array.isArray(prev) ? pruneTasksById(prev, taskIds) : prev,
      ),
  });

  const effectiveNodeColumnSelections = nodeColumnSelections;

  useEffect(() => {
    const next: Record<string, string> = {};
    selectedNodes.slice(0, 2).forEach((node, index) => {
      next[node.id] = nodeColors[node.id] ?? PALETTE[index] ?? PALETTE[0];
    });
    setNodeColors((prev) => ({ ...next, ...prev }));
  }, [selectedNodes.map((node) => node.id).join('|')]);

  const getColorForNode = (nodeId: string, index = 0) => {
    return nodeColors[nodeId] ?? PALETTE[index % PALETTE.length];
  };

  const setNodeColor = (nodeId: string, color: string) => {
    setNodeColors((prev) => ({ ...prev, [nodeId]: color }));
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
    handleTokenLimitKeyDown,
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

  const lockedNodeNameMap = isLocked ? buildSelectionNameById(selectedNodes as any, selectedNodes as any) : {};

  const nodeIdToName = (() => {
    const map: Record<string, string> = {};
    selectedNodes.forEach((node: any) => {
      map[node.id] = node.name || node.label || node.id;
    });
    return map;
  })();

  const { handleAnalyze, handleTokenClick, handleTokenRightClick } = useTokenFrequencyTaskFlow({
    state: {
      currentWorkspaceId,
      selectedNodes,
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

  const registerWordCloudRef = useCallback((nodeKey: string, element: SVGSVGElement | null) => {
    if (!element) {
      delete wordCloudRefs.current[nodeKey];
      return;
    }
    wordCloudRefs.current[nodeKey] = element;
  }, []);

  const handleDownloadWordCloud = (nodeKey: string, displayName: string) => {
    const svg = wordCloudRefs.current[nodeKey];
    if (!svg) return;
    downloadWordCloudSvgAsPng(svg, {
      displayName,
      fallbackKey: nodeKey,
      scale: 3,
    });
  };

  const handleDownloadFrequencyCsv = (label: string, rows: any[]) => {
    downloadFrequencyRowsAsCsv(label, rows);
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
  const displayNodeCount = selectedNodes.length;
  const typedServerRequest = serverRequest as
    | {
        node_ids?: string[];
        node_columns?: Record<string, string>;
        stop_words?: string[];
      }
    | null;

  const hasLockedParameterChanges = hasLockedParameterDiff({
    isLocked,
    serverRequest: typedServerRequest,
    currentParams: {
      stop_words: normalizeCommaSeparatedWords(stopWords),
    },
    getServerParams: (request) => ({
      stop_words: normalizeRequestStopWords(request.stop_words),
    }),
  });

  const handleColumnChange = (nodeId: string, column: string) => {
    setNodeColumnSelection(nodeId, column);
  };

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes as any,
    enabled: true,
  });

  return (
    <div className="space-y-6">
      <TokenFrequencyParameterPanel
        panelSelectedNodes={selectedNodes as any[]}
        effectiveNodeColumnSelections={effectiveNodeColumnSelections}
        onColumnChange={handleColumnChange}
        nodeColors={nodeColors}
        onColorChange={setNodeColor}
        defaultPalette={PALETTE}
        isLocked={isLocked}
        getNodeColumns={getColumnInfos as any}
        displayNodeCount={displayNodeCount}
        actionState={{
          runDisabled:
            selectedNodes.length === 0 ||
            isRunning ||
            hasIncompleteSelections ||
            (isLocked && !hasLockedParameterChanges),
          clearDisabled: !results && !isRunning,
        }}
        isAnalyzing={isRunning}
        onAnalyze={handleAnalyze}
        onClearResults={clearResults}
        hasIncompleteSelections={hasIncompleteSelections}
        appliedStopCount={appliedStopSet.size}
        hasResults={Boolean(results)}
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
        onTokenLimitKeyDown={handleTokenLimitKeyDown}
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
        unifiedCloudWidth={800}
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
    </div>
  );
};

export default TokenFrequencyFeature;
