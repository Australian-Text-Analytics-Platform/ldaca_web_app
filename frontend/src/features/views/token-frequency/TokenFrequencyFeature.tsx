import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { tokenFrequenciesTaskRequest, tokenFrequenciesTaskResult } from '@/api/generated/sdk.gen';
import type { TokenFrequencyResponse } from '@/api/generated/types.gen';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { takeMostRecent } from '@/features/workspace/common/utils/selectionUtils';
import type { WorkspaceNodeLike } from '@/features/views/common/nodeSelectionTypes';

import { useNodeColumnInfos } from '@/features/workspace/common/hooks/useNodeColumnInfos';
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
import {
  buildSelectionNameById,
  deriveBackendStopWordsKey,
  deriveBackendTokenLimit,
  type NodeNameEntry,
} from './tokenFrequencyUtils';
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
import {
  TokenFrequencyDownloadDialog,
  type DownloadDialogMode,
} from './components/TokenFrequencyDownloadDialog';
import FillDefaultStopWordsDialog from './components/FillDefaultStopWordsDialog';
import { useTokenFrequencyPreferences } from './hooks/useTokenFrequencyPreferences';
import { useTokenFrequencyTaskFlow } from './hooks/useTokenFrequencyTaskFlow';
import {
  useAnalysisLock,
  useAnalysisFeature,
  useSafeResult,
  useNodeColorManagement,
} from '../common';
import { pruneTasksById } from '@/features/views/common/analysisTaskUtils';
import { TokenFrequencyParameterPanel } from './components/panels/TokenFrequencyParameterPanel';
import { TokenFrequencyResultsPanel } from './components/panels/TokenFrequencyResultsPanel';
import TokenizerModelSelector from '../common/components/TokenizerModelSelector';
import { useAnalysisStore } from '@/stores/analysisStore';
import { useUIStore } from '@/stores/uiStore';
import {
  usePersistNodeDocumentColumn,
  usePersistNodeTokenizationPreference,
} from '@/features/views/common/hooks/usePersistNodeDocumentColumn';

const MAX_TOKEN_LIMIT_INPUT = 100;
const UNIFIED_WORDCLOUD_WIDTH = 640;
const UNIFIED_WORDCLOUD_HEIGHT = 340;

/** Coordinates token-frequency selection, execution, and export wiring for the analysis tab. */
/**
 * Rendered by: TokenFrequencyTabbedFeature, which mounts one instance per analysis tab and feeds it tab props.
 * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
 *
 * Tab props: ``tabId`` identifies the active tab, ``tabTaskId`` seeds
 * deterministic hydration of that tab's task, and ``onTabTaskChange`` reports
 * task id assignment/clear back to the tab record.
 */
export interface TokenFrequencyFeatureProps {
  tabId?: string;
  tabTaskId?: string | null;
  onTabTaskChange?: (taskId: string | null) => void;
}

const TokenFrequencyFeature = ({
  tabId,
  tabTaskId,
  onTabTaskChange,
}: TokenFrequencyFeatureProps = {}) => {
  const [liveTokenizerModelsByNode, setLiveTokenizerModelsByNode] = useState<
    Record<string, string>
  >({});
  // Controls the "Fill Default" stop-words dialog where the user confirms which
  // language's defaults to load (guessed on the fly, not stored per column).
  const [fillDialogOpen, setFillDialogOpen] = useState(false);
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
    // Tab-scoped locking: bind the lock to this tab's persisted task so it stays
    // independent of sibling tabs. Null for a fresh tab that has not run yet.
    taskId: tabTaskId ?? null,
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

  const [liveResults, resultRef, setResultSafely, setResults] =
    useSafeResult<TokenFrequencyResponse>();
  const [liveLastCompareNodeIds, setLastCompareNodeIds] = useState<string[]>([]);
  const [liveStudyNodeId, setStudyNodeId] = useState<string | null>(null);

  const panelSelectedNodes = livePanelSelectedNodes;
  const results = liveResults;
  const lastCompareNodeIds = liveLastCompareNodeIds;
  const studyNodeId = liveStudyNodeId;

  const panelNodeIds = useMemo(
    () =>
      takeMostRecent(panelSelectedNodes, 2)
        .map((node, idx) => getNodeIdentifier(node, idx) || activeNodeIds[idx])
        .filter((id): id is string => Boolean(id)),
    [panelSelectedNodes, activeNodeIds],
  );

  const effectiveStudyNodeId = useMemo(
    () =>
      studyNodeId && panelNodeIds.includes(studyNodeId) ? studyNodeId : (panelNodeIds[0] ?? null),
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
  const {
    nodeColors: liveNodeColors,
    handleColorChange,
    defaultPalette,
    promoteTempColors,
  } = useNodeColorManagement({
    activeNodeIds: tokenActiveNodeIds,
    tabKey: 'token-frequency',
  });
  const nodeColors: Record<string, string> = liveNodeColors;

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
    // Tab-driven deterministic hydration: the tab's persisted task id wins task
    // resolution over transient local state.
    hydrationTaskId: tabTaskId ?? null,
    resultRef,
    /** Fetches the latest task result so polling and hydration share one retrieval path. */
    // Called by: TokenFrequencyFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    fetchResult: async (taskId, headers) => {
      const { data } = await tokenFrequenciesTaskResult({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    /** Fetches the saved task request so a reopened task can restore panel state. */
    // Called by: TokenFrequencyFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    fetchRequest: async (taskId, headers) => {
      const { data } = await tokenFrequenciesTaskRequest({
        headers,
        path: { task_id: taskId },
        throwOnError: true,
      });
      return data;
    },
    /** Pushes fetched task results into guarded component state. */
    // Called by: TokenFrequencyFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    onResultFetched: (result) => setResultSafely(result),
    /** Rehydrates controls from a persisted result when the feature reconnects to a task. */
    // Called by: TokenFrequencyFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned. Flow: normalize inputs, derive state, then return the analysis result expected by callers.
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
    /** Rehydrates node selections from a persisted request payload after task recovery. */
    // Called by: TokenFrequencyFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned. Flow: normalize inputs, derive state, then return the analysis result expected by callers.
    onHydratedRequest: async (requestPayload) => {
      const raw = requestPayload as Record<string, unknown> | null;
      const req = raw?.data ?? raw;
      if (!req || typeof req !== 'object') return;
      const reqObj = req as Record<string, unknown>;
      const nodeIds: string[] = Array.isArray(reqObj.node_ids)
        ? (reqObj.node_ids as string[]).slice(0, 2)
        : [];
      const node_columns: Record<string, string> =
        (reqObj.node_columns as Record<string, string>) || {};
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
        } catch {
          /* ignore */
        }
      }
    },
    /** Clears local result and selection state when the feature reset action runs. */
    // Called by: TokenFrequencyFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    onCleared: (_, options) => {
      setResultSafely(null);
      if (options?.preserveLocalState) {
        return;
      }
      // Detach the cleared task from the owning tab so a reload doesn't rehydrate
      // a task the user explicitly cleared.
      onTabTaskChange?.(null);
      resetAnalysisSelectionAfterClear({ unlockSelection });
      setLastCompareNodeIds([]);
      setStudyNodeId(null);
      resetPreferenceUiState();
    },
    /** Removes token-frequency tasks from the shared analysis store after local cleanup. */
    // Called by: TokenFrequencyFeature through its owning hook, JSX prop, or analysis lifecycle config because the feature needs this step to keep workspace selection, task hydration, result state, and UI transitions aligned.
    pruneGlobalTasks: (taskIds) =>
      setTasks((prev) => (Array.isArray(prev) ? pruneTasksById(prev, taskIds) : prev)),
  });

  const effectiveNodeColumnSelections = useMemo(() => {
    return isLocked ? activeNodeColumnSelections : nodeColumnSelections;
  }, [isLocked, activeNodeColumnSelections, nodeColumnSelections]);

  const effectiveTokenizerModelsByNode = useMemo(() => {
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
  }, [
    effectiveNodeColumnSelections,
    panelSelectedNodes,
    liveTokenizerModelsByNode,
  ]);

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
  // Primary node/column the "Fill Default" dialog samples to guess a language.
  // Language is not stored per column (a column may mix languages), so the guess
  // is derived on demand from the first selected text column and the user
  // confirms or overrides it in the dialog.
  const fillDefaultSelection = effectiveNodeColumnSelections.find((selection) => selection.column);
  const fillDefaultTarget = {
    nodeId: fillDefaultSelection?.nodeId ?? null,
    column: fillDefaultSelection?.column ?? null,
  };

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
    backendTokenLimit,
    backendStopWordsKey,
    maxTokenLimitInput: MAX_TOKEN_LIMIT_INPUT,
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
      // Persist the run's assigned task id onto the active tab so reload
      // rehydrates the same task.
      onTaskIdAssigned: (taskId) => {
        if (tabId) onTabTaskChange?.(taskId);
      },
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

  const responseDisplayNameHints = useMemo(() => buildResponseDisplayNameHints(results), [results]);

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
    () => deriveNodeDisplayResults(normalizedNodeResults, appliedStopSet, effectiveTokenLimit),
    [normalizedNodeResults, appliedStopSet, effectiveTokenLimit],
  );

  const registerWordCloudRef = useCallback((nodeKey: string, element: SVGSVGElement | null) => {
    if (!element) {
      Reflect.deleteProperty(wordCloudRefs.current, nodeKey);
      return;
    }
    wordCloudRefs.current[nodeKey] = element;
  }, []);

  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadDialogMode, setDownloadDialogMode] = useState<DownloadDialogMode>('wordcloud');
  const pendingDownloadRef = useRef<{
    mode: DownloadDialogMode;
    nodeKey?: string;
    displayName?: string;
    rows?: unknown[];
    label?: string;
  } | null>(null);

  const handleDownloadWordCloud = useCallback((nodeKey: string, displayName: string) => {
    pendingDownloadRef.current = { mode: 'wordcloud', nodeKey, displayName };
    setDownloadDialogMode('wordcloud');
    setDownloadDialogOpen(true);
  }, []);

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

  /** Completes the download dialog action by exporting the pending cloud, rows, or stop words. */
  /**
   * Called by: TokenFrequencyFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   * Flow: read workspace/auth state, derive locked analysis parameters, wire hydration/run/clear callbacks, then render controls and results.
   */
  const handleDownloadConfirm = async ({
    format,
    includeStopWords,
  }: {
    format: string;
    includeStopWords: boolean;
  }) => {
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

            const zipFilename =
              ctx.nodeKey === 'unified'
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

  /** Applies the textarea stop-word list to the displayed result filters. */
  /**
   * Called by: TokenFrequencyFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleApplyStopWords = () => {
    applyStopSetFromText(stopWords);
  };

  const hasIncompleteSelections = effectiveNodeColumnSelections.some(
    (selection) => !selection.column,
  );
  const displayNodeCount = panelSelectedNodes.length;
  const selectedNodeIdsWithColumns = orderedPanelNodeIds.filter((nodeId) =>
    effectiveNodeColumnSelections.some(
      (selection) => selection.nodeId === nodeId && selection.column,
    ),
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

  /** Persists a selected document column for a node when live analysis is editable. */
  /**
   * Called by: TokenFrequencyFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleColumnChange = (nodeId: string, column: string) => {
    if (isLocked) return;
    setNodeColumnSelection(nodeId, column);
    void persistDocumentColumn(nodeId, column);
  };

  /** Stores the tokenizer model selected for a node and persists it with its detected language. */
  /**
   * Called by: TokenFrequencyFeature through JSX event props or task lifecycle callbacks because those event paths need to translate user actions or task lifecycle changes into feature state.
   */
  const handleTokenizerModelChange = (
    nodeId: string,
    column: string,
    model: string,
    language: string | null,
  ) => {
    if (isLocked) return;
    setLiveTokenizerModelsByNode((prev) => {
      if (model) return { ...prev, [nodeId]: model };
      const { [nodeId]: _removed, ...rest } = prev;
      return rest;
    });
    void persistTokenizerPreference(nodeId, column, model, language);
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
        isStopping={isStopping}
        onAnalyze={() => {
          // Promote pending per-tab temp colours to assigned before
          // the analysis runs; the strategy doc treats Run as the
          // commit trigger.
          promoteTempColors(tokenActiveNodeIds);
          void handleAnalyze();
        }}
        onStop={() => {
          void stopTask();
        }}
        onClearResults={() => {
          void clearResults();
        }}
        hasIncompleteSelections={hasIncompleteSelections}
        appliedStopCount={appliedStopSet.size}
        hasResults={Boolean(results)}
        runLabel={actionState.runLabel}
        studyNodeId={effectiveStudyNodeId}
        onStudyNodeChange={(nodeId: string) => {
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
            disabled={isLocked}
            disabledReason="Clear results first to change tokenizer models"
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
        onFillDefaultStopWords={() => {
          setFillDialogOpen(true);
        }}
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
        onConfirm={(options) => {
          void handleDownloadConfirm(options);
        }}
      />

      <FillDefaultStopWordsDialog
        key={fillDialogOpen ? 'fill-dialog-open' : 'fill-dialog-closed'}
        open={fillDialogOpen}
        onOpenChange={setFillDialogOpen}
        workspaceId={currentWorkspaceId}
        nodeId={fillDefaultTarget.nodeId}
        column={fillDefaultTarget.column}
        getAuthHeaders={getAuthHeaders}
        isLoading={isLoadingStopWords}
        onFill={(language) => {
          void handleFillDefaultStopWords(language);
        }}
      />
    </div>
  );
};

export default TokenFrequencyFeature;
