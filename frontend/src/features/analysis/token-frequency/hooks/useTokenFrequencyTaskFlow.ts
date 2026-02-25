import { toast } from 'sonner';
import { textApi, type TokenFrequencyRequest, type TokenFrequencyResponse } from '@/api/text';
import { workspacesApi } from '@/api/workspaces';
import type { NodeColumnSelection } from '@/hooks/useAutoNodeColumns';
import { resolveTokenFrequencyNodeContext, type TokenFrequencyAnalysisParams } from '@/components/tabs/tokenFrequencyHelpers';
import { restoreAnalysisLockFromRequest } from '../../common';
import {
  clearAnalysisTaskArtifacts,
  collectTaskIds,
  pruneTasksById,
} from '../../../../hooks/analysisTaskUtils';

type UseTokenFrequencyTaskFlowParams = {
  currentWorkspaceId: string | null;
  selectedNodes: Array<{ id: string }>;
  effectiveNodeColumnSelections: NodeColumnSelection[];
  stopWords: string;
  results: TokenFrequencyResponse | null;
  localTokenFrequencyTaskId: string | null;
  tokenFrequencyTaskStatus: any;
  lockedNodeNameMap: Record<string, string>;
  nodeIdToName: Record<string, string>;
  nodeColors: Record<string, string>;
  lastCompareNodeIds: string[];
  setLocalTokenFrequencyTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsAnalyzing: React.Dispatch<React.SetStateAction<boolean>>;
  analyzingRef: React.MutableRefObject<boolean>;
  setResultsSafely: (value: any) => void;
  setLastCompareNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
  setAppliedStopSet: React.Dispatch<React.SetStateAction<Set<string>>>;
  setStopWords: React.Dispatch<React.SetStateAction<string>>;
  resetPreferenceUiState: () => void;
  setTasks: React.Dispatch<React.SetStateAction<any[]>>;
  unlockSelection: () => void;
  getAuthHeaders: () => Record<string, string>;
  lockWithSnapshots: (nodes: any[]) => void;
  resolveTokenFrequencyTaskId: () => Promise<string | null>;
  selectNodes: (nodeIds: string[]) => void;
  setPendingConcordance: (payload: any) => void;
  setCurrentView: (view: any) => void;
  applyStopSetFromText: (text: string) => void;
  getColorForNode: (nodeId: string, index?: number) => string;
  lastFetchedRef: React.MutableRefObject<{ taskId: string | null; state: string | null }>;
};

export const useTokenFrequencyTaskFlow = ({
  currentWorkspaceId,
  selectedNodes,
  effectiveNodeColumnSelections,
  stopWords,
  results,
  localTokenFrequencyTaskId,
  tokenFrequencyTaskStatus,
  lockedNodeNameMap,
  nodeIdToName,
  nodeColors,
  lastCompareNodeIds,
  setLocalTokenFrequencyTaskId,
  setIsAnalyzing,
  analyzingRef,
  setResultsSafely,
  setLastCompareNodeIds,
  setAppliedStopSet,
  setStopWords,
  resetPreferenceUiState,
  setTasks,
  unlockSelection,
  getAuthHeaders,
  lockWithSnapshots,
  resolveTokenFrequencyTaskId,
  selectNodes,
  setPendingConcordance,
  setCurrentView,
  applyStopSetFromText,
  getColorForNode,
  lastFetchedRef,
}: UseTokenFrequencyTaskFlowParams) => {
  const handleAnalyze = async () => {
    if (!currentWorkspaceId || selectedNodes.length === 0) {
      return;
    }
    if (analyzingRef.current) return;

    const incompleteSelections = effectiveNodeColumnSelections.filter((sel) => !sel.column);
    if (incompleteSelections.length > 0) {
      toast.error('Please select a text column for all selected data blocks.');
      return;
    }

    lastFetchedRef.current = { taskId: null, state: null };
    setIsAnalyzing(true);
    analyzingRef.current = true;
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
        node_ids: selectedNodes.slice(0, 2).map((node) => node.id),
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
            maxNodes: 2,
          });
        }
      } catch {
        /* best effort lock */
      }

      const response = await textApi.tokenFrequencies(request, getAuthHeaders());
      setResultsSafely(response);

      const responseTaskId = (response as any)?.metadata?.task_id;
      if (typeof responseTaskId === 'string' && responseTaskId.trim()) {
        setLocalTokenFrequencyTaskId(responseTaskId);
      }

      setLastCompareNodeIds(request.node_ids);

      if (Array.isArray(response.stop_words)) {
        const normalizedStops = response.stop_words
          .map((word: string) => String(word).trim().toLowerCase())
          .filter(Boolean);
        setAppliedStopSet(new Set(normalizedStops));
        setStopWords(normalizedStops.join(', '));
      }

      if (response.state === 'failed') {
        setIsAnalyzing(false);
        analyzingRef.current = false;
      }
    } catch (error) {
      console.error('Error calculating token frequencies:', error);
      setLocalTokenFrequencyTaskId(null);
      setResultsSafely({
        state: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        data: null,
      } as any);
      setIsAnalyzing(false);
      analyzingRef.current = false;
    }
  };

  const handleClearResults = async () => {
    if (currentWorkspaceId) {
      const taskIds = collectTaskIds([
        (results as any)?.metadata?.task_id,
        localTokenFrequencyTaskId,
        tokenFrequencyTaskStatus.activeTaskId,
        tokenFrequencyTaskStatus.runningTask?.task_id,
        tokenFrequencyTaskStatus.successfulTask?.task_id,
        tokenFrequencyTaskStatus.failedTask?.task_id,
      ]);
      try {
        const headers = getAuthHeaders();
        const resolvedTaskId = await resolveTokenFrequencyTaskId();
        const allTaskIds = collectTaskIds([...taskIds, resolvedTaskId]);

        await clearAnalysisTaskArtifacts({
          workspaceId: currentWorkspaceId,
          taskIds: allTaskIds,
          cancelTask: (_workspaceId: string, taskId: string) => workspacesApi.cancelTasks({ task_id: taskId }, headers),
          clearManagerTask: (_workspaceId: string, taskId: string) => workspacesApi.clearTasks({ task_id: taskId }, headers),
          clearAnalysisTask: (_workspaceId: string, taskId: string) => textApi.clearTask(taskId, headers),
          warnContext: 'token-frequency',
        });
      } catch (error) {
        console.warn('Failed to clear token frequency tasks:', error);
      }
    }

    setResultsSafely(null);
    setLocalTokenFrequencyTaskId(null);
    lastFetchedRef.current = { taskId: null, state: null };
    unlockSelection();
    setIsAnalyzing(false);
    analyzingRef.current = false;
    setLastCompareNodeIds([]);
    resetPreferenceUiState();
    setTasks((prev: any[]) =>
      Array.isArray(prev)
        ? pruneTasksById(
            prev,
            collectTaskIds([
              (results as any)?.metadata?.task_id,
              localTokenFrequencyTaskId,
              tokenFrequencyTaskStatus.activeTaskId,
              tokenFrequencyTaskStatus.runningTask?.task_id,
              tokenFrequencyTaskStatus.successfulTask?.task_id,
              tokenFrequencyTaskStatus.failedTask?.task_id,
            ])
          )
        : prev
    );
  };

  const handleTokenClick = (token: string) => {
    const trimmedToken = token?.toString() ?? '';
    const analysisParams = (results?.analysis_params ?? null) as TokenFrequencyAnalysisParams | null;

    const resolvedContext = resolveTokenFrequencyNodeContext({
      lastCompareNodeIds,
      analysisParams,
      selectedNodes: selectedNodes.map((node) => ({ id: node.id })),
      nodeColumnSelections: effectiveNodeColumnSelections,
      maxNodes: 2,
    });

    const fallbackNodeIds: string[] =
      resolvedContext.nodeIds.length > 0
        ? resolvedContext.nodeIds
        : selectedNodes
            .slice(0, 2)
            .map((node) => node.id)
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

    const fallbackSelections: NodeColumnSelection[] =
      resolvedContext.nodeIds.length > 0
        ? resolvedContext.selections
        : effectiveNodeColumnSelections.filter((selection) => fallbackNodeIds.includes(selection.nodeId) && selection.column);

    const uniqueNodeIds: string[] = fallbackNodeIds
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, 2);

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
  };

  const handleTokenRightClick = (token: string, event?: React.MouseEvent) => {
    if (event) event.preventDefault();
    const tokenNormalized = token.trim().toLowerCase();
    const current = stopWords
      .split(',')
      .map((word) => word.trim())
      .filter(Boolean);

    if (!current.map((word) => word.toLowerCase()).includes(tokenNormalized)) {
      const updated = [...current, token].join(', ');
      setStopWords(updated);
      applyStopSetFromText(updated);
    }
  };

  return {
    handleAnalyze,
    handleClearResults,
    handleTokenClick,
    handleTokenRightClick,
  };
};
