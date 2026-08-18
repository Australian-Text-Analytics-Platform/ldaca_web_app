import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { deleteTab, submitTabAnalysis } from '@/api';
import type { Analysis, ConcordanceAnalysisRequest, TokenFrequencyRequest } from '@/api';
import type { NodeColumnSelection } from '@/features/views/common/nodeSelectionTypes';
import { resolveTokenFrequencyNodeContext } from '@/features/views/token-frequency/tokenFrequencyHelpers';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { ANALYSIS_TAB_GROUPS } from '../../common/analysisIds';
import { runAnalysisTaskEnvelope } from '../../common/tasks/runAnalysisTaskEnvelope';
import { useWorkspaceTabs } from '../../common/tabs/useWorkspaceTabs';
import type { ViewType } from '@/features/views/viewIds';

interface AnalysisState {
  currentWorkspaceId: string | null;
  tabId: string;
  panelNodeIds: string[];
  panelSelectedNodes: Pick<WorkspaceNodeMetadata, 'id' | 'name'>[];
  effectiveNodeColumnSelections: NodeColumnSelection[];
  tokenizerModelsByNode: Record<string, string>;
  stopWords: string;
  lastCompareNodeIds: string[];
}

interface AnalysisActions {
  setLocalTaskId: (value: string | null) => void;
  setIsRunning: (value: boolean) => void;
  runningRef: React.RefObject<boolean>;
  setLastCompareNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
  setStopWords: React.Dispatch<React.SetStateAction<string>>;
  onSubmitted: () => void;
  prepareBeforeRun?: () => Promise<void>;
}

interface NavigationActions {
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
    lastCompareNodeIds,
  },
  actions: {
    setLocalTaskId,
    setIsRunning,
    runningRef,
    setLastCompareNodeIds,
    setStopWords,
    onSubmitted,
    prepareBeforeRun,
  },
  navigation: { setCurrentView, applyStopSetFromText },
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
   * workspace mutation, record its Analysis identity, and apply result state.
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
    };

    await runAnalysisTaskEnvelope<Analysis>({
      runningRef,
      setIsRunning,
      setLocalTaskId,
      onSubmitted,
      prepare: prepareBeforeRun,
      submit: async () => {
        const { data: response } = await submitTabAnalysis({
          body: {
            execution_scope: 'run_all',
            request: { kind: 'token_frequency', ...request },
          },
          path: { workspace_id: currentWorkspaceId, tab_id: tabId },
          throwOnError: true,
        });
        return response;
      },
      onSuccess: () => {
        setLastCompareNodeIds(request.node_ids);
      },
      onError: (error) => {
        console.error('Error calculating token frequencies:', error);
        setLocalTaskId(null);
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
    (token: string) => {
      if (!currentWorkspaceId) return;
      const trimmedToken = token;
      const resolvedContext = resolveTokenFrequencyNodeContext({
        lastCompareNodeIds,
        analysisParams: null,
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

      void (async () => {
        let createdTabId: string | null = null;
        try {
          const createdTab = await createConcordanceTab(trimmedToken || undefined);
          if (!createdTab) return;
          createdTabId = createdTab.id;

          const nodeColumns = Object.fromEntries(
            resolvedSelections.map((selection) => [selection.nodeId, selection.column]),
          );
          const request: ConcordanceAnalysisRequest = {
            node_ids: resolvedNodeIds,
            node_columns: nodeColumns,
            node_tokenizer_models: Object.fromEntries(
              resolvedNodeIds.map((nodeId) => [
                nodeId,
                (tokenizerModelsByNode[nodeId] ?? '').trim(),
              ]),
            ),
            search_word: trimmedToken,
            num_left_tokens: 10,
            num_right_tokens: 10,
            regex: false,
            whole_word: true,
            case_sensitive: false,
            search_mode: 'regex',
          };
          await submitTabAnalysis({
            body: {
              execution_scope: 'preview',
              request: { kind: 'concordance', ...request },
            },
            path: { workspace_id: currentWorkspaceId, tab_id: createdTab.id },
            throwOnError: true,
          });
          setCurrentView('concordance');
        } catch (error) {
          if (createdTabId) {
            try {
              await deleteTab({
                path: { workspace_id: currentWorkspaceId, tab_id: createdTabId },
                throwOnError: true,
              });
            } catch (cleanupError) {
              console.warn('Failed to remove empty Concordance tab:', cleanupError);
            }
          }
          toast.error(error instanceof Error ? error.message : 'Failed to open Concordance.');
        }
      })();
    },
    [
      lastCompareNodeIds,
      panelSelectedNodes,
      effectiveNodeColumnSelections,
      panelNodeIds,
      currentWorkspaceId,
      createConcordanceTab,
      setCurrentView,
      tokenizerModelsByNode,
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
