import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { submitTabAnalysis } from '@/api';
import type { Analysis, TokenFrequencyRequest, TokenFrequencyResponse } from '@/api';
import type { NodeColumnSelection } from '@/features/views/common/nodeSelectionTypes';
import {
  resolveTokenFrequencyNodeContext,
  type TokenFrequencyAnalysisParams,
} from '@/features/views/token-frequency/tokenFrequencyHelpers';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { ANALYSIS_TAB_GROUPS } from '../../common/analysisIds';
import { runAnalysisTaskEnvelope } from '../../common/tasks/runAnalysisTaskEnvelope';
import { useWorkspaceTabs } from '../../common/tabs/useWorkspaceTabs';
import type { PendingConcordance } from '@/stores/analysisStore';
import type { ViewType } from '@/features/views/viewIds';

interface AnalysisState {
  currentWorkspaceId: string | null;
  tabId: string;
  panelNodeIds: string[];
  panelSelectedNodes: Pick<WorkspaceNodeMetadata, 'id' | 'name'>[];
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
  onTaskIdAssigned: (taskId: string | null) => void;
}

interface NavigationActions {
  replaceSelectedNodes: (nodeIds: string[], activeNodeId?: string | null) => void;
  setPendingConcordance: (payload: PendingConcordance) => void;
  setCurrentView: (view: ViewType) => void;
  applyStopSetFromText: (text: string) => void;
}

interface UseTokenFrequencyTaskFlowParams {
  state: AnalysisState;
  actions: AnalysisActions;
  navigation: NavigationActions;
}

/** Owns submit, result hydration, and cross-feature navigation for token-frequency tasks. */
/**
 * Used by: TokenFrequencyFeature.tsx.
 * Flow: submit token-frequency requests from the selected nodes, apply returned
 * results/stop words, and create a fresh Concordance tab for token navigation.
 */
export const useTokenFrequencyTaskFlow = ({
  state: {
    currentWorkspaceId,
    tabId,
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
  navigation: { replaceSelectedNodes, setPendingConcordance, setCurrentView, applyStopSetFromText },
}: UseTokenFrequencyTaskFlowParams) => {
  // Concordance tab group handle, used by handleTokenClick to spawn a brand-new
  // concordance tab for every token click. The created tab id travels with the
  // handoff so only that destination tab can consume it.
  const { createTab: createConcordanceTab } = useWorkspaceTabs(
    currentWorkspaceId,
    ANALYSIS_TAB_GROUPS.concordance,
  );

  /** Builds and submits a token-frequency request from the current selection state. */
  /**
   * Returned to `TokenFrequencyFeature` by `useTokenFrequencyTaskFlow`.
   * Flow: validate columns/tokenizers, build the two-node request, run the
   * workspace mutation, record its task id, and apply result/stop-word state.
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
      node_tokenizer_models: Object.fromEntries(
        requestNodeIds.map((nodeId) => [nodeId, (tokenizerModelsByNode[nodeId] ?? '').trim()]),
      ),
      stop_words: stopWordsArray,
    };

    await runAnalysisTaskEnvelope<Analysis>({
      lastFetchedRef,
      runningRef,
      setIsRunning,
      setLocalTaskId,
      onTaskIdAssigned,
      resetBeforeRun: () => {
        setResultsSafely(null);
      },
      submit: async () => {
        const { data: response } = await submitTabAnalysis({
          body: { kind: 'token_frequency', ...request },
          path: { workspace_id: currentWorkspaceId, tab_id: tabId },
          throwOnError: true,
        });
        return response;
      },
      onSuccess: (response) => {
        setLastCompareNodeIds(request.node_ids);
        const normalizedStops = (request.stop_words ?? [])
          .map((word: string) => word.trim().toLowerCase())
          .filter(Boolean);
        setAppliedStopSet(new Set(normalizedStops));
        setStopWords(normalizedStops.join(', '));
        if (response.state === 'failed') setResultsSafely(null);
      },
      onError: (error) => {
        console.error('Error calculating token frequencies:', error);
        setLocalTaskId(null);
        setResultsSafely(null);
      },
    });
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
    // ``sourceNodeId`` is supplied when the click originates from an
    // individual per-node word cloud or frequency bar; it scopes the
    // concordance handoff to that single data block. The unified word cloud
    // and the comparative statistics table omit it, so the handoff keeps both
    // compared nodes (the prior behaviour).
    (token: string, sourceNodeId?: string) => {
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

      const resolvedNodeIds: string[] = fallbackNodeIds.filter(
        (id, index, all) => all.indexOf(id) === index,
      );

      const resolvedSelections = fallbackSelections.filter((selection) =>
        resolvedNodeIds.includes(selection.nodeId),
      );

      // Narrow to just the clicked node when a per-node source is given and we
      // can resolve a column for it (so the concordance arrives ready to run).
      // Fall back to the full comparison set if the node can't be resolved.
      const scopedNodeId = sourceNodeId?.trim() ?? '';
      const scopedSelection =
        scopedNodeId.length > 0
          ? (resolvedSelections.find((selection) => selection.nodeId === scopedNodeId) ??
            effectiveNodeColumnSelections.find(
              (selection) => selection.nodeId === scopedNodeId && selection.column,
            ))
          : undefined;

      const uniqueNodeIds: string[] = scopedSelection ? [scopedNodeId] : resolvedNodeIds;
      const effectiveSelections: NodeColumnSelection[] = scopedSelection
        ? [scopedSelection]
        : resolvedSelections;

      const nodeDetails = uniqueNodeIds.map((id) => ({
        id,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty locked/derived name should fall back to the next source, not render blank
        name: lockedNodeNameMap[id] || nodeIdToName[id] || id,
      }));

      void (async () => {
        try {
          const createdTab = await createConcordanceTab(trimmedToken || undefined);
          if (!createdTab) return;

          if (uniqueNodeIds.length > 0) {
            try {
              replaceSelectedNodes(uniqueNodeIds, uniqueNodeIds.at(-1));
            } catch (error) {
              console.warn('Failed to sync workspace selection for concordance handoff:', error);
            }
          }

          setPendingConcordance({
            targetTabId: createdTab.id,
            searchWord: trimmedToken,
            nodeColumnSelections: effectiveSelections.map((selection) => ({ ...selection })),
            selectedNodes: nodeDetails,
            // Auto-run the concordance search on arrival: clicking a token is an
            // explicit "search for this word" intent, so the fresh tab dispatches
            // the request itself instead of leaving the user to press Run.
            autoRun: true,
            timestamp: Date.now(),
          });
          setCurrentView('concordance');
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Failed to open Concordance.');
        }
      })();
    },
    [
      results,
      lastCompareNodeIds,
      panelSelectedNodes,
      effectiveNodeColumnSelections,
      panelNodeIds,
      lockedNodeNameMap,
      nodeIdToName,
      replaceSelectedNodes,
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
