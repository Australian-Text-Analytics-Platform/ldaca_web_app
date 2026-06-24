export const DEFAULT_TOPIC_SIZE_VALUE = 10;

export interface CorpusSample {
  percent: string;
  enabled: boolean;
}

export interface TopicModelingParameterState {
  corpusSamples: CorpusSample[];
  corpusSamplesUserSet: boolean;
  topicSizeValue: number;
  topicSizeUserSet: boolean;
  randomSeed: number;
  randomSeedUserSet: boolean;
  representativeWordsCount: number;
  representativeWordsCountUserSet: boolean;
}

type TopicModelingParameterAction =
  | { type: 'applyNodeDefaultSamples'; samples: CorpusSample[] }
  | { type: 'updateCorpusSample'; index: number; update: Partial<CorpusSample> }
  | { type: 'setTopicSizeFromUser'; value: number }
  | { type: 'setRandomSeedFromUser'; value: number }
  | { type: 'setRepresentativeWordsCountFromUser'; value: number }
  | { type: 'hydrateRequest'; request: Record<string, unknown>; nodeCount: number }
  | { type: 'resetAfterClear'; defaultSamples: CorpusSample[] };

/**
 * Creates the topic-modeling parameter snapshot used before any node defaults
 * or saved requests have been applied.
 * Used by: useTopicModelingParameters and reducer tests so the run-parameter
 * model has one documented default shape.
 */
export const createTopicModelingParameterState = (): TopicModelingParameterState => ({
  corpusSamples: [],
  corpusSamplesUserSet: false,
  topicSizeValue: DEFAULT_TOPIC_SIZE_VALUE,
  topicSizeUserSet: false,
  randomSeed: 42,
  randomSeedUserSet: false,
  representativeWordsCount: 15,
  representativeWordsCountUserSet: false,
});

export const defaultSampleForDocCount = (nDocs: number): CorpusSample => {
  const autoPercent = nDocs > 0 ? Math.min(100, Math.ceil(((4000 / nDocs) * 100) / 10) * 10) : 100;
  return { percent: String(autoPercent), enabled: autoPercent < 100 };
};

export const sampleToFraction = (sample: CorpusSample | undefined): number | null => {
  if (!sample?.enabled) return null;
  const pct = Math.min(100, Math.max(1, Number(sample.percent) || 100));
  return pct >= 100 ? null : pct / 100;
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
  const fractions = normalizeTopicSampleFractions(raw, nodeCount);
  return fractions.map((fraction) => {
    if (typeof fraction === 'number' && fraction > 0 && fraction < 1) {
      return {
        percent: String(Math.max(1, Math.min(99, Math.round(fraction * 100)))),
        enabled: true,
      };
    }
    return { percent: '100', enabled: false };
  });
};

/**
 * Owns topic-modeling run parameters and their user-set flags. The reducer
 * keeps related value/dirty-state pairs in one place so hydration, node default
 * resets, and Clear Results cannot update them inconsistently.
 * Used by: useTopicModelingParameters, which adapts these transitions to the
 * existing hook API consumed by TopicModelingFeature.
 * Flow: apply node-derived sampling defaults, mark explicit edits, hydrate
 * saved request values, and reset result-scoped user flags while preserving
 * values the UI intentionally keeps after Clear Results.
 */
export const topicModelingParameterReducer = (
  state: TopicModelingParameterState,
  action: TopicModelingParameterAction,
): TopicModelingParameterState => {
  switch (action.type) {
    case 'applyNodeDefaultSamples':
      return {
        ...state,
        corpusSamples: action.samples,
        corpusSamplesUserSet: false,
      };
    case 'updateCorpusSample': {
      const next = [...state.corpusSamples];
      next[action.index] = {
        ...(next[action.index] ?? { percent: '100', enabled: false }),
        ...action.update,
      };
      return { ...state, corpusSamples: next, corpusSamplesUserSet: true };
    }
    case 'setTopicSizeFromUser':
      return { ...state, topicSizeValue: action.value, topicSizeUserSet: true };
    case 'setRandomSeedFromUser':
      return { ...state, randomSeed: action.value, randomSeedUserSet: true };
    case 'setRepresentativeWordsCountFromUser':
      return {
        ...state,
        representativeWordsCount: action.value,
        representativeWordsCountUserSet: true,
      };
    case 'hydrateRequest': {
      const hasSampling = Array.isArray(action.request.sample_fractions);
      return {
        ...state,
        randomSeed: Number(action.request.random_seed ?? 42),
        randomSeedUserSet: true,
        representativeWordsCount: Number(action.request.representative_words_count ?? 15),
        representativeWordsCountUserSet: true,
        topicSizeValue: Number(action.request.min_topic_size ?? DEFAULT_TOPIC_SIZE_VALUE),
        topicSizeUserSet: true,
        corpusSamples: hasSampling
          ? fractionsToSamples(action.request.sample_fractions, action.nodeCount)
          : state.corpusSamples,
        corpusSamplesUserSet: hasSampling ? true : state.corpusSamplesUserSet,
      };
    }
    case 'resetAfterClear':
      return {
        ...state,
        corpusSamples: state.corpusSamplesUserSet ? state.corpusSamples : action.defaultSamples,
        topicSizeValue: DEFAULT_TOPIC_SIZE_VALUE,
        topicSizeUserSet: false,
        randomSeedUserSet: false,
        representativeWordsCountUserSet: false,
      };
  }
};
