import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { tokenFrequenciesTaskRequest, tokenFrequenciesTaskResult } from '@/api/generated/sdk.gen';
import type { TokenFrequencyRequestInput, TokenFrequencyResponse } from '@/api/generated/types.gen';
import { useAuth } from '@/hooks/useAuth';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { takeMostRecent } from '@/utils/selectionUtils';
import {
  snapshotSourceNodes,
  useSnapshotBackedAnalysisState,
} from '@/features/snapshot-view';
import { useTokenFrequencySnapshotCapture } from './hooks/useTokenFrequencySnapshotCapture';
import { useTokenFrequencySnapshotLoad } from './hooks/useTokenFrequencySnapshotLoad';
import type { TokenFrequencySnapshotPayload } from './hooks/useTokenFrequencySnapshotLoad';
import { TokenFrequencySnapshotBanner } from './components/TokenFrequencySnapshotBanner';
import type { WorkspaceNodeLike } from '@/features/analysis/common/nodeSelectionTypes';

import { useNodeColumnInfos } from '@/hooks/useNodeColumnInfos';
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
import { pruneTasksById } from '@/hooks/analysisTaskUtils';
import { TokenFrequencyParameterPanel } from './components/panels/TokenFrequencyParameterPanel';
import { TokenFrequencyResultsPanel } from './components/panels/TokenFrequencyResultsPanel';
import TokenizerModelSelector from '../common/components/TokenizerModelSelector';
import { useAnalysisStore } from '@/stores/analysisStore';
import { useUIStore } from '@/stores/uiStore';
import {
  usePersistNodeDocumentColumn,
  usePersistNodeTokenizationPreference,
} from '@/features/analysis/common/hooks/usePersistNodeDocumentColumn';

const MAX_TOKEN_LIMIT_INPUT = 100;
const UNIFIED_WORDCLOUD_WIDTH = 640;
const UNIFIED_WORDCLOUD_HEIGHT = 340;
type TokenFrequencyRequest = TokenFrequencyRequestInput;

function extractNodeTokenizerModels(
  settings: Record<string, unknown> | null | undefined,
  nodeIds: readonly string[],
): Record<string, string> {
  const models: Record<string, string> = {};
  const rawNodeModels = settings?.node_tokenizer_models;
  if (rawNodeModels && typeof rawNodeModels === 'object' && !Array.isArray(rawNodeModels)) {
    for (const [nodeId, model] of Object.entries(rawNodeModels as Record<string, unknown>)) {
      if (typeof model === 'string' && model.trim()) {
        models[nodeId] = model.trim();
      }
    }
  }
  const fallbackModel = typeof settings?.tokenizer_model === 'string' ? settings.tokenizer_model.trim() : '';
  if (fallbackModel) {
    for (const nodeId of nodeIds) {
      models[nodeId] = models[nodeId] ?? fallbackModel;
    }
  }
  return models;
}

const TokenFrequencyFeature = () => {
  const [liveTokenizerModelsByNode, setLiveTokenizerModelsByNode] = useState<Record<string, string>>({});
  const [liveTokenizerLanguagesByNode, setLiveTokenizerLanguagesByNode] = useState<Record<string, string | null>>({});
  const { getAuthHeaders } = useAuth();
  const queryClient = useQueryClient();
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
    panelSelectedNodes: rawPanelSelectedNodes,
  } = useAnalysisLock({
    analysisType: 'token_frequencies',
    workspaceId: currentWorkspace?.id ?? null,
    getAuthHeaders,
    allowedDataTypes: ['string'],
    docTypeOnly: true,
    maxNodes: 2,
  });
  // The frequency tool is strictly pairwise (keyness statistics are defined
  // between exactly one reference and one study corpus). Cap the displayed
  // selection to the two most-recent blocks regardless of how many the user
  // has selected workspace-wide, so the third+ are silently dropped from
  // every downstream consumer: parameter panel, reference radios, task-flow
  // payload, name maps, etc.
  const livePanelSelectedNodes = useMemo(
    () => takeMostRecent(rawPanelSelectedNodes, 2),
    [rawPanelSelectedNodes],
  );
  const { selectedNodes } = useWorkspaceSelection();
  const { selectNodes } = useWorkspaceActions();
  const currentView = useUIStore((state) => state.currentView);
  const setCurrentView = useUIStore((state) => state.setCurrentView);
  const setPendingConcordance = useAnalysisStore((state) => state.setPendingConcordance);
  const setTasks = useAnalysisStore((state) => state.setTasks);

  const [liveResults, resultRef, setResultSafely, setResults] = useSafeResult<TokenFrequencyResponse>();
  const [liveLastCompareNodeIds, setLastCompareNodeIds] = useState<string[]>([]);
  const [liveStudyNodeId, setStudyNodeId] = useState<string | null>(null);

  // Snapshot view state — hoisted here so the effective-value dispatch
  // can shadow live state in one place. Below, the rest of the
  // component reads ``results`` / ``panelSelectedNodes`` /
  // ``effectiveNodeColumnSelections`` etc. without caring whether
  // they came from live or from a loaded snapshot.
  const { loadedSnapshot, inSnapshotMode } =
    useSnapshotBackedAnalysisState<TokenFrequencySnapshotPayload>(
      'token_frequencies',
    );

  const panelSelectedNodes = useMemo<WorkspaceNodeLike[]>(() => {
    if (!inSnapshotMode || !loadedSnapshot) return livePanelSelectedNodes;
    return snapshotSourceNodes(loadedSnapshot.manifest.source);
  }, [inSnapshotMode, loadedSnapshot, livePanelSelectedNodes]);

  const results = useMemo<TokenFrequencyResponse | null>(() => {
    if (!inSnapshotMode || !loadedSnapshot) return liveResults;
    return loadedSnapshot.payload.result;
  }, [inSnapshotMode, loadedSnapshot, liveResults]);

  const lastCompareNodeIds = useMemo<string[]>(() => {
    if (!inSnapshotMode || !loadedSnapshot) return liveLastCompareNodeIds;
    return loadedSnapshot.payload.settings?.node_ids ?? loadedSnapshot.manifest.source.node_ids;
  }, [inSnapshotMode, loadedSnapshot, liveLastCompareNodeIds]);

  // The radio in the parameter panel picks the *study* data block — it
  // gets sent as the second node_id in the request (Corpus 2 / O2/%2 in
  // the keyword statistics), with the non-selected block treated as the
  // reference (Corpus 1 / O1/%1). Snapshots written before this flip
  // still place the user-selected at index 0, so old snapshots will land
  // the radio on the non-selected node on reload — the captured stats
  // remain correct since they're frozen in the payload.
  const studyNodeId = useMemo<string | null>(() => {
    if (!inSnapshotMode || !loadedSnapshot) return liveStudyNodeId;
    return loadedSnapshot.payload.settings?.node_ids[1] ?? loadedSnapshot.manifest.source.node_ids[1] ?? null;
  }, [inSnapshotMode, loadedSnapshot, liveStudyNodeId]);

  const panelNodeIds = useMemo(
    () =>
      takeMostRecent(panelSelectedNodes, 2)
        .map((node, idx) => getNodeIdentifier(node, idx) || activeNodeIds[idx])
        .filter((id): id is string => Boolean(id)),
    [panelSelectedNodes, activeNodeIds],
  );

  const effectiveStudyNodeId = useMemo(
    () =>
      studyNodeId && panelNodeIds.includes(studyNodeId)
        ? studyNodeId
        : panelNodeIds[0] ?? null,
    [studyNodeId, panelNodeIds],
  );

  const orderedPanelNodeIds = useMemo(() => {
    if (!effectiveStudyNodeId) return panelNodeIds;
    return [
      ...panelNodeIds.filter((nodeId) => nodeId !== effectiveStudyNodeId),
      effectiveStudyNodeId,
    ];
  }, [effectiveStudyNodeId, panelNodeIds]);

  // ``tabKey`` routes colour changes through this tab's temp layer;
  // ``promoteTempColors`` is called from ``handleAnalyzeWithPromote``
  // below so a Run commits the preview to the global assigned store.
  const tokenActiveNodeIds = takeMostRecent(panelNodeIds, 2);
  const { nodeColors: liveNodeColors, handleColorChange, defaultPalette, promoteTempColors } =
    useNodeColorManagement({
      activeNodeIds: tokenActiveNodeIds,
      tabKey: 'token-frequency',
    });
  // In snapshot mode the live colour store has no entries for the
  // captured node IDs (they may not exist in this workspace at all).
  // Shadow ``nodeColors`` with the frozen ``manifest.node_colors`` so
  // every consumer — parameter-panel swatches, picker, downstream
  // chart/legend lookups — reads the captured colour, not a stale
  // default-palette pick.
  const nodeColors: Record<string, string> =
    inSnapshotMode && loadedSnapshot ? loadedSnapshot.manifest.node_colors : liveNodeColors;

  const wordCloudRefs = useRef<Record<string, SVGSVGElement | null>>({});
  const unifiedCloudContainerRef = useRef<HTMLDivElement | null>(null);

  const currentWorkspaceId = currentWorkspace?.id ?? null;
  const isActiveTab = currentView === 'token-frequency';

  const {
    resolveTaskId,
    isRunning,
    isStopping,
    setIsRunning,
    runningRef,
    taskStatus,
    hasActiveTask,
    lastFetchedRef,
    clearResults,
    stopTask,
    setLocalTaskId,
  } = useAnalysisFeature<TokenFrequencyResponse>({
    analysisType: 'token_frequencies',
    taskType: 'token_frequencies',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: isActiveTab,
    resultRef,
    fetchResult: async (taskId, headers) => {
      const { data } = await tokenFrequenciesTaskResult({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    fetchRequest: async (taskId, headers) => {
      const { data } = await tokenFrequenciesTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    onResultFetched: (result) => setResultSafely(result),
    onHydratedResult: (result) => {
      if (!result) return;
      const requestData = result?.analysis_params ?? {};
      const { nodeIds, selections } = parseAnalysisNodeRequest(requestData, 2);
      setNodeColumnSelections(selections, { replace: true });
      setLastCompareNodeIds(nodeIds);
      setStudyNodeId(nodeIds[1] ?? null);
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
      setStudyNodeId(nodeIds[1] ?? null);
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
    onCleared: () => {
      setResultSafely(null);
      resetAnalysisSelectionAfterClear({ unlockSelection });
      setLastCompareNodeIds([]);
      setStudyNodeId(null);
      resetPreferenceUiState();
    },
    pruneGlobalTasks: (taskIds) =>
      setTasks((prev) =>
        Array.isArray(prev) ? pruneTasksById(prev, taskIds) : prev,
      ),
  });

  const effectiveNodeColumnSelections = useMemo(() => {
    if (inSnapshotMode && loadedSnapshot?.payload.settings) {
      const settings = loadedSnapshot.payload.settings;
      return settings.node_ids.map((id) => ({
        nodeId: id,
        column: settings.node_columns[id] ?? '',
      }));
    }
    return isLocked ? activeNodeColumnSelections : nodeColumnSelections;
  }, [inSnapshotMode, loadedSnapshot, isLocked, activeNodeColumnSelections, nodeColumnSelections]);

  const effectiveTokenizerModelsByNode = useMemo(() => {
    if (inSnapshotMode && loadedSnapshot?.payload.settings) {
      return extractNodeTokenizerModels(
        loadedSnapshot.payload.settings as unknown as Record<string, unknown>,
        loadedSnapshot.payload.settings.node_ids ?? loadedSnapshot.manifest.source.node_ids,
      );
    }
    // Seed with models persisted to the backend from previous sessions,
    // then apply any live overrides the user has made in this session.
    const fromNodes: Record<string, string> = {};
    for (const sel of effectiveNodeColumnSelections) {
      if (!sel.column) continue;
      const node = panelSelectedNodes.find((n: WorkspaceNodeLike) => {
        const ids = [n.id, n.node_id];
        return ids.some((id) => typeof id === 'string' && id === sel.nodeId);
      });
      const stored = node?.tokenizer_models?.[sel.column];
      if (stored) fromNodes[sel.nodeId] = stored;
    }
    return { ...fromNodes, ...liveTokenizerModelsByNode };
  }, [inSnapshotMode, loadedSnapshot, effectiveNodeColumnSelections, panelSelectedNodes, liveTokenizerModelsByNode]);

  // useCallback so the section components below stay React.memo-stable
  // across stopword-keystroke re-renders of this feature. Without it,
  // every render hands a fresh function ref to the sections, busting
  // memoisation and re-running d3-cloud layout per keystroke.
  const getColorForNode = useCallback(
    (nodeId: string, index = 0) => {
      return nodeColors[nodeId] ?? defaultPalette[index % defaultPalette.length] ?? '#000000';
    },
    [nodeColors, defaultPalette],
  );

  const backendTokenLimit = deriveBackendTokenLimit(results);
  const backendStopWordsKey = deriveBackendStopWordsKey(results);
  // All distinct saved tokenizer languages across the currently-selected
  // corpora, in selection order. Fill Default uses only languages that
  // came from the selected column's tokenization metadata.
  const defaultStopWordsLanguages = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const selection of effectiveNodeColumnSelections) {
      const lang = liveTokenizerLanguagesByNode[selection.nodeId];
      if (!lang || seen.has(lang)) continue;
      seen.add(lang);
      ordered.push(lang);
    }
    return ordered;
  }, [effectiveNodeColumnSelections, liveTokenizerLanguagesByNode]);

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
    applyTokenLimit,
    handleFillDefaultStopWords,
    resetPreferenceUiState,
  } = useTokenFrequencyPreferences({
    currentWorkspaceId,
    results,
    setResults,
    getAuthHeaders,
    resolveTokenFrequencyTaskId: resolveTaskId,
    defaultStopWordsLanguages,
    backendTokenLimit,
    backendStopWordsKey,
    maxTokenLimitInput: MAX_TOKEN_LIMIT_INPUT,
    persistEnabled: !inSnapshotMode,
  });

  const lockedNodeNameMap = useMemo(
    () =>
      isLocked
        ? buildSelectionNameById(
            panelSelectedNodes as NodeNameEntry[],
            panelSelectedNodes as NodeNameEntry[],
          )
        : {},
    [isLocked, panelSelectedNodes],
  );

  const nodeIdToName = useMemo(() => {
    const map: Record<string, string> = {};
    panelSelectedNodes.forEach((node) => {
      const nodeId = typeof node.id === 'string' ? node.id : '';
      if (!nodeId) return;
      map[nodeId] = (node.name || node.label || nodeId) as string;
    });
    return map;
  }, [panelSelectedNodes]);

  const { handleAnalyze, handleTokenClick, handleTokenRightClick } = useTokenFrequencyTaskFlow({
    state: {
      currentWorkspaceId,
      panelNodeIds: orderedPanelNodeIds,
      panelSelectedNodes,
      effectiveNodeColumnSelections,
      tokenizerModelsByNode: effectiveTokenizerModelsByNode,
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
      queryClient,
    },
    navigation: {
      selectNodes,
      setPendingConcordance,
      setCurrentView,
      applyStopSetFromText,
      getColorForNode,
    },
  });

  const responseDisplayNameHints = useMemo(
    () => buildResponseDisplayNameHints(results),
    [results],
  );

  const displayNameMap = useMemo(
    () => ({
      ...responseDisplayNameHints,
      ...lockedNodeNameMap,
    }),
    [responseDisplayNameHints, lockedNodeNameMap],
  );

  // ``useCallback`` keeps this referentially stable across keystrokes so the
  // ``normalizeNodeResults`` memo below doesn't bust on every render of the
  // parent (e.g. typing in the stop-words textarea). Without it, the heavy
  // ``normalizeNodeResults`` + ``deriveNodeDisplayResults`` adapters re-run
  // on every character — both walk every row in every node.
  const computeDisplayName = useCallback(
    (nodeId: string, fallbackKey?: string) => {
      if (displayNameMap[nodeId]) return displayNameMap[nodeId];
      if (nodeIdToName[nodeId]) return nodeIdToName[nodeId];
      return fallbackKey || nodeId || 'Unknown node';
    },
    [displayNameMap, nodeIdToName],
  );

  const analysisNodeIds = useMemo(
    () =>
      computeAnalysisNodeIds(
        (results?.analysis_params as Record<string, unknown> | null | undefined)?.node_ids,
        lastCompareNodeIds,
        effectiveNodeColumnSelections,
      ),
    [results, lastCompareNodeIds, effectiveNodeColumnSelections],
  );

  const normalizedNodeResults = useMemo(
    () => normalizeNodeResults(results?.data, analysisNodeIds, computeDisplayName),
    [results, analysisNodeIds, computeDisplayName],
  );

  const nodeDisplayResults = useMemo(
    () =>
      deriveNodeDisplayResults(normalizedNodeResults, appliedStopSet, effectiveTokenLimit),
    [normalizedNodeResults, appliedStopSet, effectiveTokenLimit],
  );

  const registerWordCloudRef = useCallback(
    (nodeKey: string, element: SVGSVGElement | null) => {
      if (!element) {
        Reflect.deleteProperty(wordCloudRefs.current, nodeKey);
        return;
      }
      wordCloudRefs.current[nodeKey] = element;
    },
    [],
  );

  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadDialogMode, setDownloadDialogMode] = useState<DownloadDialogMode>('wordcloud');
  const pendingDownloadRef = useRef<{
    mode: DownloadDialogMode;
    nodeKey?: string;
    displayName?: string;
    rows?: unknown[];
    label?: string;
  } | null>(null);

  const handleDownloadWordCloud = useCallback(
    (nodeKey: string, displayName: string) => {
      pendingDownloadRef.current = { mode: 'wordcloud', nodeKey, displayName };
      setDownloadDialogMode('wordcloud');
      setDownloadDialogOpen(true);
    },
    [],
  );

  const renameStatisticsKeysForExport = useCallback(
    (rows: unknown[]): unknown[] => {
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
    },
    [analysisNodeIds, computeDisplayName],
  );

  const handleDownloadFrequencyCsv = useCallback(
    (label: string, rows: unknown[]) => {
      const exportRows = label === 'token-keyness' ? renameStatisticsKeysForExport(rows) : rows;
      pendingDownloadRef.current = { mode: 'frequencies', label, rows: exportRows };
      setDownloadDialogMode('frequencies');
      setDownloadDialogOpen(true);
    },
    [renameStatisticsKeysForExport],
  );

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
  const selectedNodeIdsWithColumns = orderedPanelNodeIds.filter((nodeId) =>
    effectiveNodeColumnSelections.some((selection) => selection.nodeId === nodeId && selection.column),
  );
  const missingTokenizerModelNodeIds = selectedNodeIdsWithColumns.filter(
    (nodeId) => !(effectiveTokenizerModelsByNode[nodeId] ?? '').trim(),
  );

  const baseActionState = getAnalysisActionState({
    hasWorkspace: Boolean(currentWorkspaceId),
    hasSelection: panelSelectedNodes.length > 0 && !hasIncompleteSelections,
    isLocked,
    hasResults: Boolean(results),
    isBusy: isRunning,
    hasActiveTask,
    allowRunWhenLocked: false,
  });
  const hasTokenizerModel = missingTokenizerModelNodeIds.length === 0;
  const actionState = {
    ...baseActionState,
    runDisabled: baseActionState.runDisabled || !hasTokenizerModel,
    runDisabledReason: !hasTokenizerModel
      ? 'Select a tokenizer model for each data block'
      : baseActionState.runDisabledReason,
  };

  const persistDocumentColumn = usePersistNodeDocumentColumn({
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
  });
  const persistTokenizerPreference = usePersistNodeTokenizationPreference({
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
  });

  const handleColumnChange = (nodeId: string, column: string) => {
    if (isLocked || inSnapshotMode) return;
    setNodeColumnSelection(nodeId, column);
    void persistDocumentColumn(nodeId, column);
  };

  const handleTokenizerModelChange = (nodeId: string, column: string, model: string, language: string | null) => {
    if (isLocked || inSnapshotMode) return;
    setLiveTokenizerModelsByNode((prev) => {
      if (model) return { ...prev, [nodeId]: model };
      const { [nodeId]: _removed, ...rest } = prev;
      return rest;
    });
    setLiveTokenizerLanguagesByNode((prev) => ({ ...prev, [nodeId]: language }));
    void persistTokenizerPreference(nodeId, column, model, language);
  };

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
    enabled: true,
  });

  // ----- Snapshot capture + load wiring -----
  const getTokenFrequencyNodeRowCount = useCallback((node: WorkspaceNodeLike) => {
    const shape = node.shape as unknown;
    if (Array.isArray(shape) && typeof shape[0] === 'number') return shape[0];
    return 0;
  }, []);

  const handleOpenSnapshot = useTokenFrequencySnapshotLoad();

  // Build the live ``TokenFrequencyRequest`` from current state for the
  // capture-side ``settings.json`` payload. Returns null in snapshot
  // mode (the Save button is disabled there anyway).
  const captureRequest = useMemo<TokenFrequencyRequest | null>(() => {
    if (inSnapshotMode) return null;
    const orderedIds = orderedPanelNodeIds.filter(
      (id) => effectiveNodeColumnSelections.some((s) => s.nodeId === id && s.column),
    );
    if (orderedIds.length === 0) return null;
    const nodeColumns: Record<string, string> = {};
    for (const sel of effectiveNodeColumnSelections) {
      if (sel.column) nodeColumns[sel.nodeId] = sel.column;
    }
    const nodeTokenizerModels: Record<string, string> = {};
    for (const nodeId of orderedIds) {
      const model = (effectiveTokenizerModelsByNode[nodeId] ?? '').trim();
      if (!model) return null;
      nodeTokenizerModels[nodeId] = model;
    }
    const uniqueModels = [...new Set(Object.values(nodeTokenizerModels))];
    const req: TokenFrequencyRequest = {
      node_ids: orderedIds,
      node_columns: nodeColumns,
      node_tokenizer_models: nodeTokenizerModels,
      tokenizer_model: uniqueModels.length === 1 ? uniqueModels[0] : undefined,
    };
    return req;
  }, [inSnapshotMode, orderedPanelNodeIds, effectiveNodeColumnSelections, effectiveTokenizerModelsByNode]);

  // Order ``selectedNodes`` reference-first so the manifest's
  // ``node_ids`` list matches the captured request's ordering. The
  // load flow's effective-reference dispatch reads ``settings.node_ids[0]``
  // and expects it to be present in the reconstructed
  // ``panelSelectedNodes``.
  const captureSelectedNodes = useMemo<WorkspaceNodeLike[]>(() => {
    if (inSnapshotMode) return [];
    const byId = new Map<string, WorkspaceNodeLike>();
    for (const node of livePanelSelectedNodes) {
      const id = (node.id as string | undefined) ?? (node.node_id as string | undefined);
      if (id) byId.set(id, node);
    }
    const ordered: WorkspaceNodeLike[] = [];
    for (const id of orderedPanelNodeIds) {
      const node = byId.get(id);
      if (node) ordered.push(node);
    }
    return ordered;
  }, [inSnapshotMode, livePanelSelectedNodes, orderedPanelNodeIds]);

  const handleSaveSnapshot = useTokenFrequencySnapshotCapture({
    workspaceId: currentWorkspaceId,
    workspaceName: currentWorkspace?.name ?? currentWorkspaceId ?? '(workspace)',
    request: captureRequest,
    results: liveResults,
    selectedNodes: captureSelectedNodes,
    getNodeRowCount: getTokenFrequencyNodeRowCount,
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
      .map(getTokenFrequencyNodeRowCount)
      .reduce((max, n) => (Number.isFinite(n) && n > max ? n : max), 0);
    if (largestBlock > 2_000) {
      return `Demo snapshots cap each selected data block at 2,000 rows; largest selected block has ${largestBlock.toLocaleString()}.`;
    }
    if (!liveResults || liveResults.state !== 'successful') {
      return 'Run the token frequency analysis (and let it finish) before saving a snapshot.';
    }
    if (hasIncompleteSelections) {
      return 'Pick a column for each selected data block.';
    }
    return undefined;
  })();

  // Snapshot-mode handlers for token clicks. Left click navigates to
  // concordance using live workspace IDs — captured snapshot nodes
  // may not exist there, so the navigation is no-op'd. Right click
  // adds the token to the stop-words filter; the filter itself is
  // client-side (it drives ``deriveNodeDisplayResults`` via the
  // ``appliedStopSet``), so in snapshot mode we keep the UX working
  // but skip the live backend persistence path the live handler
  // takes through ``applyStopSetFromText``.
  const snapshotHandleTokenRightClick = useCallback(
    (token: string, event?: React.MouseEvent) => {
      if (event) event.preventDefault();
      const tokenNormalized = token.trim().toLowerCase();
      if (!tokenNormalized) return;
      const current = stopWords
        .split(/[,\n\r]+/)
        .map((word) => word.trim())
        .filter(Boolean);
      if (current.map((word) => word.toLowerCase()).includes(tokenNormalized)) {
        return;
      }
      const updated = [token, ...current];
      setStopWords(updated.join(', '));
      setAppliedStopSet(
        new Set(
          updated
            .map((word) => word.trim().toLowerCase())
            .filter(Boolean),
        ),
      );
    },
    [stopWords, setStopWords, setAppliedStopSet],
  );
  const effHandleTokenClick = inSnapshotMode ? (_token: string) => {} : handleTokenClick;
  const effHandleTokenRightClick = inSnapshotMode
    ? snapshotHandleTokenRightClick
    : handleTokenRightClick;

  return (
    <div className="space-y-4">
      {inSnapshotMode && <TokenFrequencySnapshotBanner />}
      <TokenFrequencyParameterPanel
        panelSelectedNodes={panelSelectedNodes}
        effectiveNodeColumnSelections={effectiveNodeColumnSelections}
        onColumnChange={handleColumnChange}
        nodeColors={nodeColors}
        onColorChange={handleColorChange}
        defaultPalette={defaultPalette}
        isLocked={isLocked || inSnapshotMode}
        lockedMessage={
          inSnapshotMode
            ? 'Viewing a saved snapshot — selection is frozen.'
            : undefined
        }
        snapshot={{
          tool: 'token_frequencies',
          onSave: handleSaveSnapshot,
          saveDisabledReason: saveSnapshotDisabledReason,
          onOpen: handleOpenSnapshot,
          nodeLabels: livePanelSelectedNodes
            .map((n) => (n.name as string | undefined) ?? (n.id as string | undefined) ?? '')
            .filter((s) => s.length > 0),
        }}
        getNodeColumns={getColumnInfos}
        displayNodeCount={displayNodeCount}
        actionState={actionState}
        isAnalyzing={isRunning}
        isStopping={isStopping}
        onAnalyze={() => {
          if (inSnapshotMode) return;
          // Promote pending per-tab temp colours to assigned before
          // the analysis runs; the strategy doc treats Run as the
          // commit trigger.
          promoteTempColors(tokenActiveNodeIds);
          return handleAnalyze();
        }}
        onStop={() => {
          void stopTask();
        }}
        onClearResults={() => {
          if (inSnapshotMode) return;
          clearResults();
        }}
        hasIncompleteSelections={hasIncompleteSelections}
        appliedStopCount={appliedStopSet.size}
        hasResults={Boolean(results)}
        runLabel={actionState.runLabel}
        studyNodeId={effectiveStudyNodeId}
        onStudyNodeChange={(nodeId: string) => {
          if (inSnapshotMode) return;
          setStudyNodeId(nodeId);
        }}
        getColorForNode={getColorForNode}
        computeDisplayName={computeDisplayName}
        renderTokenizerModelSelector={({ nodeId, column }) => (
          <TokenizerModelSelector
            workspaceId={currentWorkspaceId}
            nodeId={nodeId}
            column={column}
            value={effectiveTokenizerModelsByNode[nodeId] ?? ''}
            onChange={(model, detectedLanguage) =>
              void handleTokenizerModelChange(nodeId, column, model, detectedLanguage)
            }
            getAuthHeaders={getAuthHeaders}
            disabled={isLocked || inSnapshotMode}
            disabledReason={
              inSnapshotMode
                ? 'Viewing a saved snapshot — tokenizer models are frozen.'
                : 'Clear results first to change tokenizer models'
            }
          />
        )}
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
        applyCloudTokenLimit={applyTokenLimit}
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
        onTokenClick={effHandleTokenClick}
        onTokenRightClick={effHandleTokenRightClick}
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
