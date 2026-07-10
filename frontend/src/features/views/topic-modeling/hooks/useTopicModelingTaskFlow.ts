import { useState } from 'react';
import { toast } from 'sonner';
import type { QueryClient } from '@tanstack/react-query';
import { analysisTaskDetachOptions, createAnalysisTaskDetachment, runTopicModeling } from '@/api';
import {
  type TopicModelingRequest,
  type TopicModelingResponse,
  type TopicModelingDetachRequest,
  type TopicModelingDetachResponse,
} from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import { useDetachColumnsState } from '@/features/views/common/hooks/useDetachColumnsState';
import { runAnalysisTaskEnvelope } from '@/features/views/common/tasks/runAnalysisTaskEnvelope';
import type { DetachDialogNodeOption } from '@/features/views/common/components/DetachColumnsDialog';
import { buildSamplingAutoNodeName } from '@/features/views/common/samplingAutoNodeName';
import type { NodeColumnSelection } from '@/features/views/common/nodeSelectionTypes';

const DEFAULT_TOPIC_SIZE_VALUE = 10;

const isTopicModelingDetachResponse = (
  response: unknown,
): response is TopicModelingDetachResponse =>
  typeof response === 'object' && response !== null && 'state' in response;

interface TopicModelingState {
  currentWorkspaceId: string | null;
  panelNodeIds: string[];
  panelHasMissingColumns: boolean;
  effectiveNodeColumnSelections: NodeColumnSelection[];
  randomSeed: number;
  representativeWordsCount: number;
  selectedTopicIds: Set<number>;
  sampleFractions?: (number | null)[] | null;
  minTopicSize?: number;
  /**
   * Currently-displayed topic list — already filtered by the post-fit
   * stopword toggle and carrying ``representative_words`` in display order.
   * Used to build ``topic_meanings_override`` on detach so the detached
   * meanings node mirrors what's on screen, not the fit-time artifact.
   */
  displayedTopics?: readonly { id: number; representative_words?: string[] }[];
}

interface TopicModelingActions {
  setIsRunning: (value: boolean) => void;
  runningRef: React.RefObject<boolean>;
  setError: (value: string | null) => void;
  setResultSafely: (value: TopicModelingResponse | null) => void;
  lastFetchedRef: React.RefObject<{ taskId: string | null; state: string | null }>;
  resolveTopicModelingTaskId: () => Promise<string | null>;
  setLocalTaskId: (id: string | null) => void;
  // Reports the run's assigned task id back to the owning tab. No-op when not
  // tab-mounted.
  onTaskIdAssigned?: (taskId: string | null) => void;
}

interface TopicModelingLock {
  queryClient: QueryClient;
}

interface Params {
  state: TopicModelingState;
  actions: TopicModelingActions;
  lock: TopicModelingLock;
}

// Builds deterministic topic-result node names, including sampling context when present.
/**
 * Used by: useTopicModelingTaskFlow.test.ts.
 */
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

/** Bundles topic-modeling run and detach lifecycle handlers for the feature component. */
/**
 * Used by: useTopicModelingTaskFlow.test.ts, autoNodeNames.ts, TopicModelingFeature.tsx.
 * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
 */
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
    minTopicSize,
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
    onTaskIdAssigned,
  },
  lock: { queryClient },
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

  // Submits the topic-modeling request and restores the analysis lock for the requested nodes.
  /**
   * Called by: useTopicModelingTaskFlow through JSX event props or task lifecycle callbacks.
   * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
   */
  const handleRun = async () => {
    if (!currentWorkspaceId || panelNodeIds.length === 0) return;
    if (runningRef.current) return;
    if (panelHasMissingColumns) {
      toast.error('Select a text column for all selected data blocks');
      return;
    }

    const requestNodeIds = panelNodeIds.slice(0, 2);
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
      min_topic_size: minTopicSize ?? DEFAULT_TOPIC_SIZE_VALUE,
      ...(sampleFractions != null ? { sample_fractions: sampleFractions } : {}),
    };

    await runAnalysisTaskEnvelope<TopicModelingResponse>({
      lastFetchedRef,
      runningRef,
      setIsRunning,
      setLocalTaskId,
      onTaskIdAssigned,
      resetBeforeRun: () => {
        setError(null);
        setResultSafely(null);
      },
      submit: async () => {
        const { data: res } = await runTopicModeling({
          body: req,
          path: { workspace_id: currentWorkspaceId },
          throwOnError: true,
        });
        return res;
      },
      onSuccess: (res) => {
        setResultSafely(res);

        if (res.state !== 'successful' && res.state !== 'running') {
          setError(res.message || 'Topic modeling failed');
        }
      },
      onError: (error) => {
        setError(error instanceof Error ? error.message : 'Error running topic modeling');
      },
    });
  };

  // Loads available detach columns before opening the topic-modeling detach dialog.
  /**
   * Called by: useTopicModelingTaskFlow during this analysis workflow.
   * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
   */
  const openDetachDialog = async () => {
    if (!currentWorkspaceId) return;
    const taskId = await resolveTopicModelingTaskId();
    if (!taskId) {
      toast.error('No topic modeling task available for detach');
      return;
    }

    try {
      setIsDetachLoading(true);
      const { data: resp } = await analysisTaskDetachOptions({
        path: { workspace_id: currentWorkspaceId, task_id: taskId },
        throwOnError: true,
      });
      const nodes = resp.data?.nodes ?? [];
      setDetachNodeOptions(nodes);
      // Default-select only the generated topic columns (TOPIC_top1,
      // TOPIC_distribution) when the backend marks them; source columns start
      // unticked, matching concordance/quotation. Falls back to select-all when
      // no defaults are advertised.
      const initialSelections: Record<string, string[]> = {};
      nodes.forEach((node) => {
        initialSelections[node.node_id] = node.default_selected_columns
          ? [...node.default_selected_columns]
          : [...node.available_columns];
      });
      setSelectedDetachColumns(initialSelections);
      setDetachDialogOpen(true);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to load topic detach options');
    } finally {
      setIsDetachLoading(false);
    }
  };

  // Confirms topic detach with selected source columns and displayed representative-word overrides.
  /**
   * Called by: useTopicModelingTaskFlow through JSX event props or task lifecycle callbacks.
   * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
   */
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
            buildTopicDetachNodeName(node.node_name || node.node_id, sampleFraction, randomSeed),
          ];
        }),
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
      const { data: resp } = await createAnalysisTaskDetachment({
        body: payload,
        path: { workspace_id: currentWorkspaceId, task_id: taskId },
        throwOnError: true,
      });
      if (!isTopicModelingDetachResponse(resp)) {
        throw new Error('Topic detach failed');
      }
      if (resp.state !== 'successful') {
        throw new Error(resp.message || 'Topic detach failed');
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
