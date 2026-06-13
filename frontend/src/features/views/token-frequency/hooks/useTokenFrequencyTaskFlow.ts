import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { calculateTokenFrequencies } from '@/api/generated/sdk.gen';
import type { TokenFrequencyRequestInput, TokenFrequencyResponse } from '@/api/generated/types.gen';
import type { NodeColumnSelection } from '@/features/workspace/common/hooks/useAutoNodeColumns';
import {
  resolveTokenFrequencyNodeContext,
  type TokenFrequencyAnalysisParams,
} from '@/features/views/token-frequency/tokenFrequencyHelpers';
import { extractAndSetTaskId, type WorkspaceNodeLike } from '../../common';
import { useWorkspaceTabs } from '../../common/tabs/useWorkspaceTabs';
import type { PendingConcordance } from '@/stores/analysisStore';
import type { ViewType } from '@/stores/uiStore';

type TokenFrequencyRequest = TokenFrequencyRequestInput;

interface AnalysisState {
  currentWorkspaceId: string | null;
  panelNodeIds: string[];
  panelSelectedNodes: WorkspaceNodeLike[];
  effectiveNodeColumnSelections: NodeColumnSelection[];
  tokenizerModelsByNode: Record<string, string>;
  stopWords: string;
  results: TokenFrequencyResponse | null;
  lastCompareNodeIds: string[];
  lockedNodeNameMap: Record<string, string>;
  nodeIdToName: Record<string, string>;
}

interface AnalysisActions {
  setLocalTaskId: (value: string | null) => void;
  setIsRunning: (value: boolean) => void;
  runningRef: React.RefObject<boolean>;
  setResultsSafely: (value: TokenFrequencyResponse | null) => void;
  setLastCompareNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
  setAppliedStopSet: React.Dispatch<React.SetStateAction<Set<string>>>;
  setStopWords: React.Dispatch<React.SetStateAction<string>>;
  lastFetchedRef: React.RefObject<{ taskId: string | null; state: string | null }>;
  // Reports the run's assigned task id back to the owning tab. No-op when not
  // tab-mounted.
  onTaskIdAssigned?: (taskId: string | null) => void;
}

interface LockActions {
  getAuthHeaders: () => Record<string, string>;
}

interface NavigationActions {
  selectNodes: (nodeIds: string[]) => void;
  setPendingConcordance: (payload: PendingConcordance) => void;
  setCurrentView: (view: ViewType) => void;
  applyStopSetFromText: (text: string) => void;
}

interface UseTokenFrequencyTaskFlowParams {
  state: AnalysisState;
  actions: AnalysisActions;
  lock: LockActions;
  navigation: NavigationActions;
}

/** Owns submit, result hydration, and cross-feature navigation for token-frequency tasks. */
/**
 * Used by: TokenFrequencyFeature.tsx because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
 * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
 */
export const useTokenFrequencyTaskFlow = ({
  state: {
    currentWorkspaceId,
    panelNodeIds,
    panelSelectedNodes,
    effectiveNodeColumnSelections,
    tokenizerModelsByNode,
    stopWords,
    results,
    lockedNodeNameMap,
    nodeIdToName,
    lastCompareNodeIds,
  },
  actions: {
    setLocalTaskId,
    setIsRunning,
    runningRef,
    setResultsSafely,
    setLastCompareNodeIds,
    setAppliedStopSet,
    setStopWords,
    lastFetchedRef,
    onTaskIdAssigned,
  },
  lock: { getAuthHeaders },
  navigation: {
    selectNodes,
    setPendingConcordance,
    setCurrentView,
    applyStopSetFromText,
  },
}: UseTokenFrequencyTaskFlowParams) => {
  // Concordance tab group handle, used by handleTokenClick to spawn a brand-new
  // concordance tab for every token click. Sharing the workspace-tabs query
  // cache means the tab is created + activated before the concordance view
  // mounts, so the clicked token always lands in a fresh tab instead of
  // overwriting an existing concordance search.
  const { createTab: createConcordanceTab } = useWorkspaceTabs(
    currentWorkspaceId,
    'concordance_analysis',
    getAuthHeaders,
  );

  /** Builds and submits a token-frequency request from the current selection state. */
  /**
   * Called by: useTokenFrequencyTaskFlow through JSX event props or task lifecycle callbacks because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
   */
  const handleAnalyze = async () => {
    if (!currentWorkspaceId || panelNodeIds.length === 0) {
      return;
    }
    if (runningRef.current) return;

    const incompleteSelections = effectiveNodeColumnSelections.filter((sel) => !sel.column);
    if (incompleteSelections.length > 0) {
      toast.error('Please select a text column for all selected data blocks.');
      return;
    }

    const requestNodeIds = panelNodeIds.slice(0, 2);
    const missingTokenizerModels = requestNodeIds.filter((nodeId) => {
      const model = (tokenizerModelsByNode[nodeId] ?? '').trim();
      return !model;
    });
    if (missingTokenizerModels.length > 0) {
      toast.error('Select a tokenizer model for each selected data block.');
      return;
    }

    lastFetchedRef.current = { taskId: null, state: null };
    setIsRunning(true);
    runningRef.current = true;
    setResultsSafely(null);

    try {
      const stopWordsArray = stopWords.trim()
        ? stopWords
            .split(',')
            .map((word) => word.trim().toLowerCase())
            .filter((word) => word.length > 0)
        : undefined;

      const nodeColumns: Record<string, string> = {};
      effectiveNodeColumnSelections.forEach((selection) => {
        if (selection.column) nodeColumns[selection.nodeId] = selection.column;
      });

      const request: TokenFrequencyRequest = {
        node_ids: requestNodeIds,
        node_columns: nodeColumns,
        stop_words: stopWordsArray,
      };

      const { data: response } = await calculateTokenFrequencies({
        body: request,
        headers: getAuthHeaders(),
        throwOnError: true,
      });
      setResultsSafely(response);

      const assignedTaskId = extractAndSetTaskId(response, setLocalTaskId);
      onTaskIdAssigned?.(assignedTaskId);

      setLastCompareNodeIds(request.node_ids);

      if (Array.isArray(response.stop_words)) {
        const normalizedStops = response.stop_words
          .map((word: string) => word.trim().toLowerCase())
          .filter(Boolean);
        setAppliedStopSet(new Set(normalizedStops));
        setStopWords(normalizedStops.join(', '));
      }

      if (response.state === 'failed') {
        setIsRunning(false);
        runningRef.current = false;
      }
    } catch (error) {
      console.error('Error calculating token frequencies:', error);
      setLocalTaskId(null);
      setResultsSafely({
        state: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        data: null,
      });
      setIsRunning(false);
      runningRef.current = false;
    }
  };

  // Ref-pattern so the right-click handler can read the *current* stopWords
  // without re-binding its closure (and re-creating its function reference)
  // every time the user types in the stopwords textarea. Without this,
  // ``handleTokenRightClick`` would have ``stopWords`` in its useCallback
  // deps — making it unstable per keystroke — which would in turn defeat
  // the React.memo on the word-cloud sections that take it as a prop,
  // causing d3-cloud's layout to re-run on every keypress.
  const stopWordsRef = useRef(stopWords);
  useEffect(() => {
    stopWordsRef.current = stopWords;
  }, [stopWords]);

  const handleTokenClick = useCallback(
    (token: string) => {
      const trimmedToken = token;
      const analysisParams = (results?.analysis_params ??
        null) as TokenFrequencyAnalysisParams | null;

      const resolvedContext = resolveTokenFrequencyNodeContext({
        lastCompareNodeIds,
        analysisParams,
        selectedNodes: panelSelectedNodes.map((node) => ({ id: node.id })),
        nodeColumnSelections: effectiveNodeColumnSelections,
        maxNodes: 2,
      });

      const fallbackNodeIds: string[] =
        resolvedContext.nodeIds.length > 0
          ? resolvedContext.nodeIds
          : panelNodeIds.filter(
              (id): id is string => typeof id === 'string' && id.trim().length > 0,
            );

      const fallbackSelections: NodeColumnSelection[] =
        resolvedContext.nodeIds.length > 0
          ? resolvedContext.selections
          : effectiveNodeColumnSelections.filter(
              (selection) => fallbackNodeIds.includes(selection.nodeId) && selection.column,
            );

      const uniqueNodeIds: string[] = fallbackNodeIds.filter(
        (id, index, all) => all.indexOf(id) === index,
      );

      const effectiveSelections = fallbackSelections.filter((selection) =>
        uniqueNodeIds.includes(selection.nodeId),
      );

      if (uniqueNodeIds.length > 0) {
        try {
          selectNodes(uniqueNodeIds);
        } catch (error) {
          console.warn('Failed to sync workspace selection for concordance handoff:', error);
        }
      }

      const nodeDetails = uniqueNodeIds.map((id) => ({
        id,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty locked/derived name should fall back to the next source, not render blank
        name: lockedNodeNameMap[id] || nodeIdToName[id] || id,
      }));

      setPendingConcordance({
        searchWord: trimmedToken,
        nodeColumnSelections: effectiveSelections.map((selection) => ({ ...selection })),
        selectedNodes: nodeDetails,
        // Auto-run the concordance search on arrival: clicking a token is an
        // explicit "search for this word" intent, so the fresh tab dispatches
        // the request itself instead of leaving the user to press Run.
        autoRun: true,
        timestamp: Date.now(),
      });

      // Always hand the clicked token to a fresh concordance tab. Creating +
      // activating the tab here (before the view switch) guarantees the new
      // tab's ConcordanceFeature is the instance that consumes the pending
      // payload, so no existing concordance search is ever overwritten.
      createConcordanceTab(trimmedToken || undefined);

      setCurrentView('concordance');
    },
    [
      results,
      lastCompareNodeIds,
      panelSelectedNodes,
      effectiveNodeColumnSelections,
      panelNodeIds,
      lockedNodeNameMap,
      nodeIdToName,
      selectNodes,
      setPendingConcordance,
      createConcordanceTab,
      setCurrentView,
    ],
  );

  const handleTokenRightClick = useCallback(
    (token: string, event?: React.MouseEvent) => {
      if (event) event.preventDefault();
      const tokenNormalized = token.trim().toLowerCase();
      const current = stopWordsRef.current
        .split(',')
        .map((word) => word.trim())
        .filter(Boolean);

      if (!current.map((word) => word.toLowerCase()).includes(tokenNormalized)) {
        const updated = [token, ...current].join(', ');
        setStopWords(updated);
        applyStopSetFromText(updated);
      }
    },
    [setStopWords, applyStopSetFromText],
  );

  return {
    handleAnalyze,
    handleTokenClick,
    handleTokenRightClick,
  };
};
