import { toast } from 'sonner';
import { submitTabAnalysis } from '@/api';
import type { Analysis, TopicModelingRequest } from '@/api';
import { runAnalysisTaskEnvelope } from '@/features/views/common/tasks/runAnalysisTaskEnvelope';
import type { NodeColumnSelection } from '@/features/views/common/nodeSelectionTypes';

const DEFAULT_TOPIC_SIZE_VALUE = 10;

interface TopicModelingState {
  currentWorkspaceId: string | null;
  tabId: string;
  panelNodeIds: string[];
  panelHasMissingColumns: boolean;
  effectiveNodeColumnSelections: NodeColumnSelection[];
  randomSeed: number;
  representativeWordsCount: number;
  sampleFractions?: (number | null)[] | null;
  minTopicSize?: number;
}

interface TopicModelingActions {
  setIsRunning: (value: boolean) => void;
  runningRef: React.RefObject<boolean>;
  setError: (value: string | null) => void;
  setLocalTaskId: (id: string | null) => void;
  onSubmitted: () => void;
}

interface Params {
  state: TopicModelingState;
  actions: TopicModelingActions;
}

/** Submits the canonical topic-modeling analysis owned by the active tab. */
export function useTopicModelingTaskFlow({
  state: {
    currentWorkspaceId,
    tabId,
    panelNodeIds,
    panelHasMissingColumns,
    effectiveNodeColumnSelections,
    randomSeed,
    representativeWordsCount,
    sampleFractions,
    minTopicSize,
  },
  actions: { setIsRunning, runningRef, setError, setLocalTaskId, onSubmitted },
}: Params) {
  const handleRun = async () => {
    if (!currentWorkspaceId || panelNodeIds.length === 0 || runningRef.current) return;
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

    const request: TopicModelingRequest = {
      node_ids: requestNodeIds,
      node_columns: nodeColumns,
      random_seed: randomSeed,
      representative_words_count: representativeWordsCount,
      min_topic_size: minTopicSize ?? DEFAULT_TOPIC_SIZE_VALUE,
      ...(sampleFractions != null ? { sample_fractions: sampleFractions } : {}),
    };

    await runAnalysisTaskEnvelope<Analysis>({
      runningRef,
      setIsRunning,
      setLocalTaskId,
      onSubmitted,
      resetBeforeRun: () => {
        setError(null);
      },
      submit: async () => {
        const { data } = await submitTabAnalysis({
          body: {
            execution_scope: 'run_all',
            request: { kind: 'topic_modeling', ...request },
          },
          path: { workspace_id: currentWorkspaceId, tab_id: tabId },
          throwOnError: true,
        });
        return data;
      },
      onSuccess: (analysis) => {
        if (analysis.state === 'failed') {
          setError(analysis.error?.message ?? 'Topic modeling failed');
        }
      },
      onError: (error) => {
        setError(error instanceof Error ? error.message : 'Error running topic modeling');
      },
    });
  };

  return { handleRun };
}
