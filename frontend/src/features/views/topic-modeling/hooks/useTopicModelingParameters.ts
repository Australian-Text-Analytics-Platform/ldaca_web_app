import { useEffect, useReducer, useRef } from 'react';
import type { WorkspaceNodeInfo } from '@/api';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import {
  DEFAULT_TOPIC_SIZE_VALUE,
  createTopicModelingParameterState,
  defaultCorpusSample,
  effectiveSampleDocumentCount,
  normalizeTopicSampleFractions,
  sampleToFraction,
  sanitizeSamplePercent,
  topicModelingParameterReducer,
  type CorpusSample,
} from './topicModelingParameterState';

export {
  DEFAULT_TOPIC_SIZE_VALUE,
  effectiveSampleDocumentCount,
  normalizeTopicSampleFractions,
  sanitizeSamplePercent,
};
export type { CorpusSample };

interface UseTopicModelingParametersArgs {
  panelSelectedNodes: WorkspaceNodeMetadata[];
  panelNodeIds: string[];
  panelNodeIdsKey: string;
  nodeInfoCache: Record<string, WorkspaceNodeInfo>;
}

export interface UseTopicModelingParametersResult {
  corpusSamples: CorpusSample[];
  corpusSamplesUserSet: boolean;
  updateCorpusSample: (index: number, update: Partial<CorpusSample>) => void;
  topicSizeValue: number;
  topicSizeUserSet: boolean;
  setTopicSizeValueFromUser: (value: number) => void;
  randomSeed: number;
  randomSeedUserSet: boolean;
  setRandomSeedFromUser: (value: number) => void;
  representativeWordsCount: number;
  representativeWordsCountUserSet: boolean;
  setRepresentativeWordsCountFromUser: (value: number) => void;
  nodeDocCounts: number[];
  effectiveDocCounts: number[];
  topicSizeWarning: 'orange' | 'red' | null;
  showSamplingWarning: boolean;
  sampleFractionsForRequest: (number | null)[];
  hasAnySampling: boolean;
  hydrateParameters: (request: Record<string, unknown>) => void;
  resetAfterClear: () => void;
}

const nodeDocumentCount = (nodeInfo: WorkspaceNodeInfo | undefined): number => {
  const firstShapeValue = nodeInfo?.shape?.[0];
  return typeof firstShapeValue === 'number' && Number.isFinite(firstShapeValue)
    ? firstShapeValue
    : 0;
};

/**
 * Owns the topic-modeling run-parameter model.
 *
 * Used by: TopicModelingFeature because the feature needs one place to manage
 * sampling defaults, user-set flags, request hydration, clear behavior, and the
 * derived request fractions that are shared by run, diff, warning, and detach
 * flows.
 *
 * Flow: derive corpus document counts from selected nodes, reset sampling when
 * the selected node ids change, expose explicit setters that mark fields as
 * user-set, restore saved request parameters during task hydration, then return
 * request-ready fractions and warnings for the feature shell.
 */
export function useTopicModelingParameters({
  panelSelectedNodes,
  panelNodeIds,
  panelNodeIdsKey,
  nodeInfoCache,
}: UseTopicModelingParametersArgs): UseTopicModelingParametersResult {
  const [parameterState, dispatchParameters] = useReducer(
    topicModelingParameterReducer,
    createTopicModelingParameterState(),
  );
  const {
    corpusSamples,
    corpusSamplesUserSet,
    topicSizeValue,
    topicSizeUserSet,
    randomSeed,
    randomSeedUserSet,
    representativeWordsCount,
    representativeWordsCountUserSet,
  } = parameterState;
  const skipNextNodeDefaultRef = useRef(false);
  const lastDefaultNodeIdsKeyRef = useRef<string | null>(null);
  // Keeps saved sampling from being overwritten when task hydration arrives before node ids resolve.
  const preserveHydratedSamplingNodeIdsKeyRef = useRef<string | null>(null);

  const nodeDocCounts = panelNodeIds
    .slice(0, 2)
    .map((nodeId) => nodeDocumentCount(nodeInfoCache[nodeId]));
  const nodeDocCountsKey = nodeDocCounts.join('|');
  const defaultCorpusSamples = () => nodeDocCounts.map(defaultCorpusSample);

  useEffect(() => {
    const samples = defaultCorpusSamples();
    const nodeIdsChanged = lastDefaultNodeIdsKeyRef.current !== panelNodeIdsKey;
    void Promise.resolve().then(() => {
      if (skipNextNodeDefaultRef.current) {
        skipNextNodeDefaultRef.current = false;
        if (preserveHydratedSamplingNodeIdsKeyRef.current !== panelNodeIdsKey) {
          preserveHydratedSamplingNodeIdsKeyRef.current = null;
        }
        return;
      }
      if (
        preserveHydratedSamplingNodeIdsKeyRef.current !== null &&
        preserveHydratedSamplingNodeIdsKeyRef.current !== panelNodeIdsKey
      ) {
        preserveHydratedSamplingNodeIdsKeyRef.current = null;
        return;
      }
      if (!nodeIdsChanged && corpusSamplesUserSet) {
        return;
      }
      lastDefaultNodeIdsKeyRef.current = panelNodeIdsKey;
      dispatchParameters({ type: 'applyNodeDefaultSamples', samples });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelNodeIdsKey, nodeDocCountsKey, corpusSamplesUserSet]);

  /** Updates one corpus sampling row and marks sampling as explicitly edited. */
  // Called by: TopicModelingParameterPanel because the sampling controls edit sparse per-corpus percentage patches.
  const updateCorpusSample = (index: number, update: Partial<CorpusSample>) => {
    dispatchParameters({ type: 'updateCorpusSample', index, update });
  };

  /** Records the next-run minimum topic size from an explicit user edit. */
  // Called by: TopicModelingParameterPanel because committing the field should stop rendering its placeholder style.
  const setTopicSizeValueFromUser = (value: number) => {
    dispatchParameters({ type: 'setTopicSizeFromUser', value });
  };

  /** Records the random seed from an explicit user edit. */
  // Called by: TopicModelingParameterPanel because changed seed values should be shown as user-set.
  const setRandomSeedFromUser = (value: number) => {
    dispatchParameters({ type: 'setRandomSeedFromUser', value });
  };

  /** Records the representative-words display cap from an explicit user edit. */
  // Called by: TopicModelingParameterPanel because changed word caps should be shown as user-set.
  const setRepresentativeWordsCountFromUser = (value: number) => {
    dispatchParameters({ type: 'setRepresentativeWordsCountFromUser', value });
  };

  /** Restores saved request parameters when the analysis lifecycle hydrates a task. */
  // Called by: TopicModelingFeature.onHydratedRequest because persisted tasks should reopen with the same run parameters the backend stored.
  const hydrateParameters = (request: Record<string, unknown>) => {
    if (Array.isArray(request.sample_fractions)) {
      const nodeCount = Math.max(request.sample_fractions.length, panelSelectedNodes.length);
      const hydratedNodeDocCounts = Array.from(
        { length: nodeCount },
        (_, index) => nodeDocCounts[index] ?? 0,
      );
      skipNextNodeDefaultRef.current = true;
      preserveHydratedSamplingNodeIdsKeyRef.current =
        panelSelectedNodes.length === 0 ? panelNodeIdsKey : null;
      dispatchParameters({
        type: 'hydrateRequest',
        request,
        nodeDocCounts: hydratedNodeDocCounts,
      });
      return;
    }
    dispatchParameters({ type: 'hydrateRequest', request, nodeDocCounts });
  };

  /** Resets result-scoped run flags after Clear Results while preserving user-tuned values. */
  // Called by: TopicModelingFeature.handleClear because clearing results should not discard explicit sampling/seed/word-display edits for the same corpora.
  const resetAfterClear = () => {
    dispatchParameters({ type: 'resetAfterClear', defaultSamples: defaultCorpusSamples() });
  };

  const effectiveDocCounts = nodeDocCounts.map((n, idx) =>
    effectiveSampleDocumentCount(corpusSamples[idx], n),
  );
  const combinedEffective = effectiveDocCounts.reduce((a, b) => a + b, 0);
  const topicSizeWarning: 'orange' | 'red' | null =
    combinedEffective <= 0 || topicSizeValue <= 0
      ? null
      : topicSizeValue < 3
        ? 'red'
        : topicSizeValue < 10
          ? 'orange'
          : null;
  const showSamplingWarning = combinedEffective > 0 && combinedEffective < 5 * topicSizeValue;
  const sampleFractionsForRequest = Array.from({ length: nodeDocCounts.length }, (_, index) =>
    sampleToFraction(corpusSamples[index], nodeDocCounts[index] ?? 0),
  );

  return {
    corpusSamples,
    corpusSamplesUserSet,
    updateCorpusSample,
    topicSizeValue,
    topicSizeUserSet,
    setTopicSizeValueFromUser,
    randomSeed,
    randomSeedUserSet,
    setRandomSeedFromUser,
    representativeWordsCount,
    representativeWordsCountUserSet,
    setRepresentativeWordsCountFromUser,
    nodeDocCounts,
    effectiveDocCounts,
    topicSizeWarning,
    showSamplingWarning,
    sampleFractionsForRequest,
    hasAnySampling: sampleFractionsForRequest.some((fraction) => fraction !== null),
    hydrateParameters,
    resetAfterClear,
  };
}
