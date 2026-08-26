import { useReducer } from 'react';
import type {
  TopicModelingAnalysisRequest,
  TopicSegmentationMethod,
  WorkspaceNodeInfo,
} from '@/api';
import {
  DEFAULT_MAX_SEGMENT_TOKENS,
  DEFAULT_MIN_CLUSTER_SIZE,
  createTopicModelingParameterState,
  defaultCorpusSample,
  effectiveSampleDocumentCount,
  normalizeTopicSampleFractions,
  sanitizeMinClusterSize,
  sanitizeMaxSegmentTokens,
  sampleToFraction,
  sanitizeSamplePercent,
  topicModelingParameterReducer,
  type CorpusSample,
} from './topicModelingParameterState';

export {
  DEFAULT_MAX_SEGMENT_TOKENS,
  DEFAULT_MIN_CLUSTER_SIZE,
  effectiveSampleDocumentCount,
  normalizeTopicSampleFractions,
  sanitizeSamplePercent,
  sanitizeMinClusterSize,
  sanitizeMaxSegmentTokens,
};
export type { CorpusSample };

interface UseTopicModelingParametersArgs {
  panelNodeIds: string[];
  nodeInfoById: Record<string, WorkspaceNodeInfo>;
}

export interface UseTopicModelingParametersResult {
  corpusSamples: CorpusSample[];
  corpusSamplesUserSet: boolean;
  updateCorpusSample: (index: number, update: Partial<CorpusSample>) => void;
  minClusterSize: number;
  setMinClusterSize: (value: number) => void;
  randomSeed: number;
  randomSeedUserSet: boolean;
  setRandomSeedFromUser: (value: number) => void;
  segmentationMethod: TopicSegmentationMethod;
  setSegmentationMethod: (value: TopicSegmentationMethod) => void;
  maxSegmentTokens: number;
  setMaxSegmentTokens: (value: number) => void;
  nodeDocCounts: number[];
  effectiveDocCounts: number[];
  sampleFractionsForRequest: (number | null)[];
  hasAnySampling: boolean;
  hydrateParameters: (request: TopicModelingAnalysisRequest) => void;
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
 * sampling defaults, user-set flags, request hydration, and the
 * derived request fractions that are shared by run, diff, warning, and Add to Workspace
 * flows.
 *
 * Flow: derive corpus document counts from selected nodes, key sample edits by
 * stable node id, restore saved request parameters during task hydration, then
 * return request-ready fractions and warnings for the feature shell.
 */
export function useTopicModelingParameters({
  panelNodeIds,
  nodeInfoById,
}: UseTopicModelingParametersArgs): UseTopicModelingParametersResult {
  const [parameterState, dispatchParameters] = useReducer(
    topicModelingParameterReducer,
    createTopicModelingParameterState(),
  );
  const {
    corpusSamplesByNodeId,
    userSetSampleNodeIds,
    minClusterSize,
    randomSeed,
    randomSeedUserSet,
    segmentationMethod,
    maxSegmentTokens,
  } = parameterState;

  const activeNodeIds = panelNodeIds.slice(0, 2);
  const nodeDocCounts = activeNodeIds.map((nodeId) => nodeDocumentCount(nodeInfoById[nodeId]));
  const corpusSamples = activeNodeIds.map(
    (nodeId) => corpusSamplesByNodeId[nodeId] ?? defaultCorpusSample(),
  );
  const corpusSamplesUserSet = activeNodeIds.some((nodeId) => userSetSampleNodeIds[nodeId]);

  /** Updates one corpus sampling row and marks sampling as explicitly edited. */
  // Called by: TopicModelingParameterPanel because the sampling controls edit sparse per-corpus percentage patches.
  const updateCorpusSample = (index: number, update: Partial<CorpusSample>) => {
    const nodeId = activeNodeIds[index];
    if (nodeId) dispatchParameters({ type: 'updateCorpusSample', nodeId, update });
  };

  const setMinClusterSize = (value: number) => {
    dispatchParameters({ type: 'setMinClusterSize', value: sanitizeMinClusterSize(value) });
  };

  /** Records the random seed from an explicit user edit. */
  // Called by: TopicModelingParameterPanel because changed seed values should be shown as user-set.
  const setRandomSeedFromUser = (value: number) => {
    dispatchParameters({ type: 'setRandomSeedFromUser', value });
  };

  const setSegmentationMethod = (value: TopicSegmentationMethod) => {
    dispatchParameters({ type: 'setSegmentationMethod', value });
  };

  const setMaxSegmentTokens = (value: number) => {
    dispatchParameters({ type: 'setMaxSegmentTokens', value: sanitizeMaxSegmentTokens(value) });
  };

  /** Restores saved request parameters when the analysis lifecycle hydrates a task. */
  // Called by: TopicModelingFeature.onRequest so historical Analyses reopen
  // with their immutable run parameters.
  const hydrateParameters = (request: TopicModelingAnalysisRequest) => {
    dispatchParameters({ type: 'hydrateRequest', request });
  };

  const effectiveDocCounts = nodeDocCounts.map((n, idx) =>
    effectiveSampleDocumentCount(corpusSamples[idx], n),
  );
  const sampleFractionsForRequest = Array.from({ length: nodeDocCounts.length }, (_, index) =>
    sampleToFraction(corpusSamples[index], nodeDocCounts[index] ?? 0),
  );

  return {
    corpusSamples,
    corpusSamplesUserSet,
    updateCorpusSample,
    minClusterSize,
    setMinClusterSize,
    randomSeed,
    randomSeedUserSet,
    setRandomSeedFromUser,
    segmentationMethod,
    setSegmentationMethod,
    maxSegmentTokens,
    setMaxSegmentTokens,
    nodeDocCounts,
    effectiveDocCounts,
    sampleFractionsForRequest,
    hasAnySampling: sampleFractionsForRequest.some((fraction) => fraction !== null),
    hydrateParameters,
  };
}
