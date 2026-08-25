import { toast } from 'sonner';
import { submitTabAnalysis } from '@/api';
import type { Analysis, TopicModelingRequest, TopicSegmentationMethod } from '@/api';
import type { RunAnalysis } from '@/features/views/common/hooks/useAnalysisFeature';
import type { NodeColumnSelection } from '@/features/views/common/nodeSelectionTypes';

interface TopicModelingState {
  currentWorkspaceId: string | null;
  tabId: string;
  panelNodeIds: string[];
  panelHasMissingColumns: boolean;
  effectiveNodeColumnSelections: NodeColumnSelection[];
  minClusterSize: number;
  randomSeed: number;
  sampleFractions?: (number | null)[] | null;
  segmentationMethod: TopicSegmentationMethod;
  maxSegmentTokens: number;
}

interface TopicModelingActions {
  runAnalysis: RunAnalysis;
  setError: (value: string | null) => void;
  prepareBeforeRun?: () => Promise<void>;
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
    minClusterSize,
    randomSeed,
    sampleFractions,
    segmentationMethod,
    maxSegmentTokens,
  },
  actions: { runAnalysis, setError, prepareBeforeRun },
}: Params) {
  const handleRun = async () => {
    if (!currentWorkspaceId || panelNodeIds.length === 0) return;
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
      min_cluster_size: minClusterSize,
      random_seed: randomSeed,
      segmentation_method: segmentationMethod,
      max_segment_tokens: maxSegmentTokens,
      ...(sampleFractions != null ? { sample_fractions: sampleFractions } : {}),
    };

    await runAnalysis<Analysis>({
      action: 'run_all',
      resetBeforeRun: () => {
        setError(null);
      },
      prepare: prepareBeforeRun,
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
        setError(error instanceof Error ? error.message : 'Error running topic modelling');
      },
    });
  };

  return { handleRun };
}
