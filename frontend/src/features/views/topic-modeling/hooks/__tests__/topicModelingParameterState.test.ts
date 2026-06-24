import { describe, expect, it } from 'vitest';

import {
  createTopicModelingParameterState,
  topicModelingParameterReducer,
} from '../topicModelingParameterState';

describe('topicModelingParameterReducer', () => {
  it('marks corpus sampling as user-set when a row changes', () => {
    const state = topicModelingParameterReducer(createTopicModelingParameterState(), {
      type: 'applyNodeDefaultSamples',
      samples: [{ percent: '50', enabled: true }],
    });
    const updated = topicModelingParameterReducer(state, {
      type: 'updateCorpusSample',
      index: 0,
      update: { percent: '25' },
    });

    expect(updated.corpusSamples).toEqual([{ percent: '25', enabled: true }]);
    expect(updated.corpusSamplesUserSet).toBe(true);
  });

  it('hydrates saved request parameters and sample fractions together', () => {
    const state = topicModelingParameterReducer(createTopicModelingParameterState(), {
      type: 'hydrateRequest',
      request: {
        random_seed: 7,
        representative_words_count: 30,
        min_topic_size: 12,
        sample_fractions: [0.2, null],
      },
      nodeCount: 2,
    });

    expect(state).toMatchObject({
      randomSeed: 7,
      randomSeedUserSet: true,
      representativeWordsCount: 30,
      representativeWordsCountUserSet: true,
      topicSizeValue: 12,
      topicSizeUserSet: true,
      corpusSamples: [
        { percent: '20', enabled: true },
        { percent: '100', enabled: false },
      ],
      corpusSamplesUserSet: true,
    });
  });

  it('preserves tuned sampling but clears result-scoped user flags after clear', () => {
    const state = topicModelingParameterReducer(createTopicModelingParameterState(), {
      type: 'hydrateRequest',
      request: {
        random_seed: 99,
        representative_words_count: 25,
        min_topic_size: 6,
        sample_fractions: [0.25],
      },
      nodeCount: 1,
    });
    const cleared = topicModelingParameterReducer(state, {
      type: 'resetAfterClear',
      defaultSamples: [{ percent: '100', enabled: false }],
    });

    expect(cleared.corpusSamples).toEqual([{ percent: '25', enabled: true }]);
    expect(cleared.corpusSamplesUserSet).toBe(true);
    expect(cleared.topicSizeValue).toBe(10);
    expect(cleared.topicSizeUserSet).toBe(false);
    expect(cleared.randomSeed).toBe(99);
    expect(cleared.randomSeedUserSet).toBe(false);
    expect(cleared.representativeWordsCount).toBe(25);
    expect(cleared.representativeWordsCountUserSet).toBe(false);
  });
});
