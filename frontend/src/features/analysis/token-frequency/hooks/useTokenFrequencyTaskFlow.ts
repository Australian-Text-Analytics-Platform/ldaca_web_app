import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { QueryClient } from '@tanstack/react-query';
import { textApi, type TokenFrequencyRequest, type TokenFrequencyResponse } from '@/lib/backend/text';
import type { NodeColumnSelection } from '@/hooks/useAutoNodeColumns';
import { resolveTokenFrequencyNodeContext, type TokenFrequencyAnalysisParams } from '@/features/analysis/token-frequency/tokenFrequencyHelpers';
import { restoreAnalysisLockFromRequest, extractAndSetTaskId, type WorkspaceNodeLike } from '../../common';
import type { PendingConcordance } from '@/stores/analysisStore';
import type { ViewType } from '@/stores/uiStore';
import { takeMostRecent } from '@/utils/selectionUtils';

interface AnalysisState {
  currentWorkspaceId: string | null;
  panelNodeIds: string[];
  panelSelectedNodes: WorkspaceNodeLike[];
  effectiveNodeColumnSelections: NodeColumnSelection[];
  stopWords: string;
  results: TokenFrequencyResponse | null;
  lastCompareNodeIds: string[];
  nodeColors: Record<string, string>;
  lockedNodeNameMap: Record<string, string>;
  nodeIdToName: Record<string, string>;
}

interface AnalysisActions {
  setLocalTaskId: (value: string | null) => void;
  setIsRunning: (value: boolean) => void;
  runningRef: React.MutableRefObject<boolean>;
  setResultsSafely: (value: TokenFrequencyResponse | null) => void;
  setLastCompareNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
  setAppliedStopSet: React.Dispatch<React.SetStateAction<Set<string>>>;
  setStopWords: React.Dispatch<React.SetStateAction<string>>;
  lastFetchedRef: React.MutableRefObject<{ taskId: string | null; state: string | null }>;
}

interface LockActions {
  getAuthHeaders: () => Record<string, string>;
  lockWithSnapshots: (nodes: Array<{ id: string; name?: string; columns?: string[] | null }>) => void;
  queryClient: QueryClient;
}

interface NavigationActions {
  selectNodes: (nodeIds: string[]) => void;
  setPendingConcordance: (payload: PendingConcordance) => void;
  setCurrentView: (view: ViewType) => void;
  applyStopSetFromText: (text: string) => void;
  getColorForNode: (nodeId: string, index?: number) => string;
}

type UseTokenFrequencyTaskFlowParams = {
  state: AnalysisState;
  actions: AnalysisActions;
  lock: LockActions;
  navigation: NavigationActions;
};

export const useTokenFrequencyTaskFlow = ({
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
    setResultsSafely,
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
}: UseTokenFrequencyTaskFlowParams) => {
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
        node_ids: takeMostRecent(panelNodeIds, 2),
        node_columns: nodeColumns,
        stop_words: stopWordsArray,
      };

      try {
        if (request.node_ids.length) {
          await restoreAnalysisLockFromRequest({
            workspaceId: currentWorkspaceId,
            requestData: request,
            getAuthHeaders,
            lockWithSnapshots,
            queryClient,
            maxNodes: 2,
          });
        }
      } catch {
        /* best effort lock */
      }

      const response = await textApi.tokenFrequencies(request, getAuthHeaders());
      setResultsSafely(response);

      extractAndSetTaskId(response, setLocalTaskId);

      setLastCompareNodeIds(request.node_ids);

      if (Array.isArray(response.stop_words)) {
        const normalizedStops = response.stop_words
          .map((word: string) => String(word).trim().toLowerCase())
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
      } as TokenFrequencyResponse);
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
      const trimmedToken = token?.toString() ?? '';
      const analysisParams = (results?.analysis_params ?? null) as TokenFrequencyAnalysisParams | null;

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
          : panelNodeIds
              .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

      const fallbackSelections: NodeColumnSelection[] =
        resolvedContext.nodeIds.length > 0
          ? resolvedContext.selections
          : effectiveNodeColumnSelections.filter((selection) => fallbackNodeIds.includes(selection.nodeId) && selection.column);

      const uniqueNodeIds: string[] = fallbackNodeIds
        .filter((id, index, all) => all.indexOf(id) === index);

      const effectiveSelections = fallbackSelections.filter((selection) => uniqueNodeIds.includes(selection.nodeId));

      if (uniqueNodeIds.length > 0) {
        try {
          selectNodes(uniqueNodeIds);
        } catch (error) {
          console.warn('Failed to sync workspace selection for concordance handoff:', error);
        }
      }

      const nodeDetails = uniqueNodeIds.map((id) => ({
        id,
        name: lockedNodeNameMap[id] || nodeIdToName[id] || id,
      }));

      const pendingNodeColors: Record<string, string> = { ...nodeColors };
      uniqueNodeIds.forEach((id, index) => {
        if (!pendingNodeColors[id]) {
          pendingNodeColors[id] = getColorForNode(id, index);
        }
      });

      setPendingConcordance({
        searchWord: trimmedToken,
        nodeColumnSelections: effectiveSelections.map((selection) => ({ ...selection })),
        selectedNodes: nodeDetails,
        nodeColors: pendingNodeColors,
        autoRun: false,
        timestamp: Date.now(),
      });

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
      nodeColors,
      getColorForNode,
      selectNodes,
      setPendingConcordance,
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
