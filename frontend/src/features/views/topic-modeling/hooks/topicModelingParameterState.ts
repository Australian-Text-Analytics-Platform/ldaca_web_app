import type { TopicModelingAnalysisRequest, TopicSegmentationMethod } from '@/api';

export const DEFAULT_MAX_SEGMENT_TOKENS = 256;
export const DEFAULT_MIN_CLUSTER_SIZE = 10;
const DEFAULT_TOPIC_SAMPLE_PERCENT = 100;

export interface CorpusSample {
  percent: string;
}

export interface TopicModelingParameterState {
  corpusSamplesByNodeId: Record<string, CorpusSample>;
  userSetSampleNodeIds: Record<string, true>;
  minClusterSize: number;
  randomSeed: number;
  randomSeedUserSet: boolean;
  segmentationMethod: TopicSegmentationMethod;
  maxSegmentTokens: number;
}

type TopicModelingParameterAction =
  | { type: 'updateCorpusSample'; nodeId: string; update: Partial<CorpusSample> }
  | { type: 'setMinClusterSize'; value: number }
  | { type: 'setRandomSeedFromUser'; value: number }
  | { type: 'setSegmentationMethod'; value: TopicSegmentationMethod }
  | { type: 'setMaxSegmentTokens'; value: number }
  | { type: 'hydrateRequest'; request: TopicModelingAnalysisRequest };

/**
 * Creates the topic-modeling parameter snapshot used before any node defaults
 * or saved requests have been applied.
 * Used by: useTopicModelingParameters for reducer initialization and focused
 * reducer tests as the canonical default state.
 */
export const createTopicModelingParameterState = (): TopicModelingParameterState => ({
  corpusSamplesByNodeId: {},
  userSetSampleNodeIds: {},
  minClusterSize: DEFAULT_MIN_CLUSTER_SIZE,
  randomSeed: 0,
  randomSeedUserSet: false,
  segmentationMethod: 'automatic',
  maxSegmentTokens: DEFAULT_MAX_SEGMENT_TOKENS,
});

export const sanitizeMaxSegmentTokens = (value: string | number | undefined): number => {
  const raw = typeof value === 'number' ? value : Number(value);
  const rounded = Number.isFinite(raw) ? Math.round(raw) : DEFAULT_MAX_SEGMENT_TOKENS;
  return Math.min(256, Math.max(32, rounded));
};

export const sanitizeMinClusterSize = (value: string | number | undefined): number => {
  const raw = typeof value === 'number' ? value : Number(value);
  const rounded = Number.isFinite(raw) ? Math.round(raw) : DEFAULT_MIN_CLUSTER_SIZE;
  return Math.max(2, rounded);
};

const normalizeSegmentationMethod = (value: unknown): TopicSegmentationMethod => {
  return value === 'line' || value === 'sentence' ? value : 'automatic';
};

export const defaultCorpusSample = (): CorpusSample => {
  return { percent: String(DEFAULT_TOPIC_SAMPLE_PERCENT) };
};

export const sanitizeSamplePercent = (value: string | number | undefined): number => {
  const raw = typeof value === 'number' ? value : Number(value);
  const rounded = Number.isFinite(raw) ? Math.round(raw) : DEFAULT_TOPIC_SAMPLE_PERCENT;
  return Math.min(100, Math.max(1, rounded));
};

export const effectiveSampleDocumentCount = (
  sample: CorpusSample | undefined,
  nDocs: number,
): number => {
  if (nDocs <= 0) return 0;
  const percent = sanitizeSamplePercent(sample?.percent);
  if (percent >= 100) return nDocs;
  return Math.max(1, Math.round((nDocs * percent) / 100));
};

export const sampleToFraction = (
  sample: CorpusSample | undefined,
  nDocs: number,
): number | null => {
  if (nDocs <= 0) return null;
  const percent = sanitizeSamplePercent(sample?.percent);
  if (percent >= 100) return null;
  return percent / 100;
};

export const normalizeTopicSampleFractions = (
  raw: unknown,
  nodeCount: number,
): (number | null)[] => {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  return Array.from({ length: nodeCount }, (_, idx) => {
    const value = list[idx];
    if (typeof value === 'number' && value > 0 && value < 1) return value;
    return null;
  });
};

const fractionsToSamples = (raw: unknown, nodeCount: number): CorpusSample[] => {
  const rawList: unknown[] = Array.isArray(raw) ? raw : [];
  const sampleCount = Math.max(rawList.length, nodeCount);
  const fractions = normalizeTopicSampleFractions(raw, sampleCount);
  return fractions.map((fraction) => {
    if (typeof fraction === 'number' && fraction > 0 && fraction < 1) {
      return { percent: String(Math.max(1, Math.min(99, Math.round(fraction * 100)))) };
    }
    return defaultCorpusSample();
  });
};

/**
 * Owns topic-modeling run parameters and their user-set flags. The reducer
 * keeps related value/dirty-state pairs in one place so hydration, node default
 * resets cannot update them inconsistently.
 * Used by: useTopicModelingParameters, which adapts these transitions to the
 * existing hook API consumed by TopicModelingFeature.
 * Flow: apply node-derived sampling defaults, mark explicit percentage edits, hydrate
 * saved request values.
 */
export const topicModelingParameterReducer = (
  state: TopicModelingParameterState,
  action: TopicModelingParameterAction,
): TopicModelingParameterState => {
  switch (action.type) {
    case 'updateCorpusSample': {
      return {
        ...state,
        corpusSamplesByNodeId: {
          ...state.corpusSamplesByNodeId,
          [action.nodeId]: {
            ...(state.corpusSamplesByNodeId[action.nodeId] ?? defaultCorpusSample()),
            ...action.update,
          },
        },
        userSetSampleNodeIds: { ...state.userSetSampleNodeIds, [action.nodeId]: true },
      };
    }
    case 'setMinClusterSize':
      return { ...state, minClusterSize: sanitizeMinClusterSize(action.value) };
    case 'setRandomSeedFromUser':
      return { ...state, randomSeed: action.value, randomSeedUserSet: true };
    case 'setSegmentationMethod':
      return { ...state, segmentationMethod: action.value };
    case 'setMaxSegmentTokens':
      return { ...state, maxSegmentTokens: sanitizeMaxSegmentTokens(action.value) };
    case 'hydrateRequest': {
      const hasSampling = Array.isArray(action.request.sample_fractions);
      const samples = hasSampling
        ? fractionsToSamples(action.request.sample_fractions, action.request.node_ids.length)
        : [];
      return {
        ...state,
        minClusterSize: sanitizeMinClusterSize(action.request.min_cluster_size),
        randomSeed: action.request.random_seed ?? 0,
        randomSeedUserSet: true,
        segmentationMethod: normalizeSegmentationMethod(action.request.segmentation_method),
        maxSegmentTokens: sanitizeMaxSegmentTokens(action.request.max_segment_tokens),
        corpusSamplesByNodeId: hasSampling
          ? Object.fromEntries(
              action.request.node_ids.map((nodeId, index) => [
                nodeId,
                samples[index] ?? defaultCorpusSample(),
              ]),
            )
          : state.corpusSamplesByNodeId,
        userSetSampleNodeIds: hasSampling
          ? Object.fromEntries(action.request.node_ids.map((nodeId) => [nodeId, true]))
          : state.userSetSampleNodeIds,
      };
    }
  }
};
