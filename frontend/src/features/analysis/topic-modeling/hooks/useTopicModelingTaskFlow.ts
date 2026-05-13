import { useState } from 'react';
import { toast } from 'sonner';
import type { QueryClient } from '@tanstack/react-query';
import {
  textApi,
  type TopicModelingRequest,
  type TopicModelingResponse,
  type TopicModelingDetachRequest,
} from '@/api/text';
import { queryKeys } from '@/lib/queryKeys';
import { restoreAnalysisLockFromRequest, extractAndSetTaskId } from '../../common';
import { useDetachColumnsState } from '@/features/analysis/common/hooks/useDetachColumnsState';
import type { DetachDialogNodeOption } from '@/features/analysis/components/DetachColumnsDialog';
import { buildSamplingAutoNodeName } from '@/features/preprocessing/utils/autoNodeNames';
import { takeMostRecent } from '@/utils/selectionUtils';
import type { NodeColumnSelection } from '@/hooks/useAutoNodeColumns';

const DEFAULT_TOPIC_SIZE_VALUE = 20;

interface TopicModelingState {
  currentWorkspaceId: string | null;
  panelNodeIds: string[];
  panelHasMissingColumns: boolean;
  effectiveNodeColumnSelections: NodeColumnSelection[];
  randomSeed: number;
  representativeWordsCount: number;
  selectedTopicIds: Set<number>;
  sampleFractions?: (number | null)[] | null;
  topicSizeMode?: 'min' | 'exact';
  topicSizeValue?: number;
  /**
   * Currently-displayed topic list — already filtered by the post-fit
   * stopword toggle and carrying ``representative_words`` in display order.
   * Used to build ``topic_meanings_override`` on detach so the detached
   * meanings node mirrors what's on screen, not the fit-time artifact.
   */
  displayedTopics?: ReadonlyArray<{ id: number; representative_words?: string[] }>;
}

interface TopicModelingActions {
  setIsRunning: (value: boolean) => void;
  runningRef: React.MutableRefObject<boolean>;
  setError: (value: string | null) => void;
  setResultSafely: (value: TopicModelingResponse | null) => void;
  lastFetchedRef: React.MutableRefObject<{ taskId: string | null; state: string | null }>;
  resolveTopicModelingTaskId: () => Promise<string | null>;
  setLocalTaskId: (id: string | null) => void;
}

interface TopicModelingLock {
  getAuthHeaders: () => Record<string, string>;
  lockWithSnapshots: (snapshots: Array<{ id: string; name?: string; columns?: string[] }>) => void;
  queryClient: QueryClient;
}

type Params = {
  state: TopicModelingState;
  actions: TopicModelingActions;
  lock: TopicModelingLock;
};

export const buildTopicDetachNodeName = (
  nodeLabel: string,
  sampleFraction?: number | null,
  randomSeed = 42,
) => {
  const baseName = `${(nodeLabel || '').trim() || 'node'}_topic`;
  if (typeof sampleFraction === 'number' && sampleFraction > 0 && sampleFraction < 1) {
    const seed = Number.isFinite(randomSeed) ? Math.trunc(randomSeed) : 42;
    return buildSamplingAutoNodeName({
      baseName,
      mode: 'random_sample',
      sampleSize: sampleFraction,
      randomSeed: seed,
      noRandomSeed: false,
    });
  }
  return baseName;
};

export function useTopicModelingTaskFlow({
  state: {
    currentWorkspaceId,
    panelNodeIds,
    panelHasMissingColumns,
    effectiveNodeColumnSelections,
    randomSeed,
    representativeWordsCount,
    selectedTopicIds,
    sampleFractions,
    topicSizeMode,
    topicSizeValue,
    displayedTopics,
  },
  actions: {
    setIsRunning,
    runningRef,
    setError,
    setResultSafely,
    lastFetchedRef,
    resolveTopicModelingTaskId,
    setLocalTaskId,
  },
  lock: {
    getAuthHeaders,
    lockWithSnapshots,
    queryClient,
  },
}: Params) {
  const [isDetachLoading, setIsDetachLoading] = useState(false);
  const [isDetaching, setIsDetaching] = useState(false);
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [detachNodeOptions, setDetachNodeOptions] = useState<DetachDialogNodeOption[]>([]);
  const {
    selectedDetachColumns,
    setSelectedDetachColumns,
    toggleDetachColumn,
    selectAllDetachColumns,
    deselectAllDetachColumns,
  } = useDetachColumnsState(detachNodeOptions);

  const handleRun = async () => {
    if (!currentWorkspaceId || panelNodeIds.length === 0) return;
    if (runningRef.current) return;
    if (panelHasMissingColumns) {
      toast.error('Select a text column for all selected data blocks');
      return;
    }

    const requestNodeIds = takeMostRecent(panelNodeIds, 2);
    lastFetchedRef.current = { taskId: null, state: null };
    setIsRunning(true);
    runningRef.current = true;
    setError(null);
    setResultSafely(null);

    try {
      const nodeColumns: Record<string, string> = {};
      effectiveNodeColumnSelections.forEach((selection) => {
        if (selection.column && requestNodeIds.includes(selection.nodeId)) {
          nodeColumns[selection.nodeId] = selection.column;
        }
      });

      const req: TopicModelingRequest = {
        node_ids: requestNodeIds,
        node_columns: nodeColumns,
        random_seed: randomSeed,
        representative_words_count: representativeWordsCount,
        topic_size_mode: topicSizeMode ?? 'exact',
        topic_size_value: topicSizeValue ?? DEFAULT_TOPIC_SIZE_VALUE,
        ...(sampleFractions != null ? { sample_fractions: sampleFractions } : {}),
      };

      try {
        if (req.node_ids.length) {
          await restoreAnalysisLockFromRequest({
            workspaceId: currentWorkspaceId,
            requestData: req,
            getAuthHeaders,
            lockWithSnapshots,
            queryClient,
            maxNodes: 2,
          });
        }
      } catch {
        /* best effort lock */
      }

      const res = await textApi.topicModeling(req, getAuthHeaders());
      extractAndSetTaskId(res, setLocalTaskId);
      setResultSafely(res);

      if (res.state === 'failed') {
        setIsRunning(false);
        runningRef.current = false;
      }

      if (res.state !== 'successful' && res.state !== 'running') {
        setError(res.message || 'Topic modeling failed');
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Error running topic modeling');
      setIsRunning(false);
      runningRef.current = false;
    }
  };

  const openDetachDialog = async () => {
    if (!currentWorkspaceId) return;
    const taskId = await resolveTopicModelingTaskId();
    if (!taskId) {
      toast.error('No topic modeling task available for detach');
      return;
    }

    try {
      setIsDetachLoading(true);
      const resp = await textApi.getTopicModelingDetachOptions(taskId, getAuthHeaders());
      const nodes = resp?.data?.nodes ?? [];
      setDetachNodeOptions(nodes);
      const initialSelections: Record<string, string[]> = {};
      nodes.forEach((node) => {
        initialSelections[node.node_id] = [];
      });
      setSelectedDetachColumns(initialSelections);
      setDetachDialogOpen(true);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to load topic detach options');
    } finally {
      setIsDetachLoading(false);
    }
  };

  const handleDetachConfirm = async () => {
    if (!currentWorkspaceId) return;
    const taskId = await resolveTopicModelingTaskId();
    if (!taskId) {
      toast.error('No topic modeling task available for detach');
      return;
    }

    const nodeIds = detachNodeOptions.map((node) => node.node_id);

    try {
      setIsDetaching(true);
      const newNodeNames = Object.fromEntries(
        detachNodeOptions.map((node, index) => {
          const sampleFraction = sampleFractions?.[index];
          return [
            node.node_id,
            buildTopicDetachNodeName(String(node.node_name || node.node_id), sampleFraction, randomSeed),
          ];
        })
      );
      // Build a per-topic words override from what's currently on screen.
      // ``displayedTopics`` is already filtered by the stopword toggle;
      // we slice each topic's words to ``representativeWordsCount`` to
      // match the visual cap. When the user has selected specific
      // topics, the override (and the assignments filter) narrow to
      // that selection so meanings and assignments stay in sync.
      const exportedTopics = (displayedTopics ?? []).filter(
        (topic) => selectedTopicIds.size === 0 || selectedTopicIds.has(topic.id),
      );
      const wordsCap = Math.max(1, Math.floor(representativeWordsCount));
      const topicMeaningsOverride = exportedTopics.map((topic) => ({
        topic_id: topic.id,
        words: (topic.representative_words ?? []).slice(0, wordsCap),
      }));
      const exportedTopicIds = exportedTopics.map((topic) => topic.id);
      const payload: TopicModelingDetachRequest = {
        node_ids: nodeIds,
        selected_columns: selectedDetachColumns,
        new_node_names: newNodeNames,
        ...(exportedTopicIds.length > 0 ? { topic_ids: exportedTopicIds } : {}),
        ...(topicMeaningsOverride.length > 0
          ? { topic_meanings_override: topicMeaningsOverride }
          : {}),
      };
      const resp = await textApi.topicModelingDetach(taskId, payload, getAuthHeaders());
      if (resp?.state !== 'successful') {
        throw new Error(resp?.message || 'Topic detach failed');
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceNodes(currentWorkspaceId) }),
      ]);

      setDetachDialogOpen(false);
      toast.success('Detached topic data block(s) created');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Topic detach failed');
    } finally {
      setIsDetaching(false);
    }
  };

  return {
    handleRun,
    openDetachDialog,
    toggleDetachColumn,
    selectAllDetachColumns,
    deselectAllDetachColumns,
    handleDetachConfirm,
    isDetachLoading,
    isDetaching,
    detachDialogOpen,
    setDetachDialogOpen,
    detachNodeOptions,
    selectedDetachColumns,
  };
}
