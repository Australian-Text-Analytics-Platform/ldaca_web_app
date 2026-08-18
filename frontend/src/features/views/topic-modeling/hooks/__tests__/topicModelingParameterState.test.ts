import { describe, expect, it } from 'vitest';

import {
  createTopicModelingParameterState,
  topicModelingParameterReducer,
} from '../topicModelingParameterState';

describe('topicModelingParameterReducer', () => {
  it('marks corpus sampling as user-set when a row changes', () => {
    const state = topicModelingParameterReducer(createTopicModelingParameterState(), {
      type: 'applyNodeDefaultSamples',
      samples: [{ percent: '100' }],
    });
    const updated = topicModelingParameterReducer(state, {
      type: 'updateCorpusSample',
      index: 0,
      update: { percent: '25' },
    });

    expect(updated.corpusSamples).toEqual([{ percent: '25' }]);
    expect(updated.corpusSamplesUserSet).toBe(true);
  });

  it('hydrates saved request parameters and sample fractions together', () => {
    const state = topicModelingParameterReducer(createTopicModelingParameterState(), {
      type: 'hydrateRequest',
      request: {
        random_seed: 7,
        segmentation_method: 'paragraph',
        max_segment_tokens: 64,
        sample_fractions: [0.2, null],
      },
      nodeDocCounts: [10000, 5000],
    });

    expect(state).toMatchObject({
      randomSeed: 7,
      randomSeedUserSet: true,
      segmentationMethod: 'paragraph',
      maxSegmentTokens: 64,
      corpusSamples: [{ percent: '20' }, { percent: '100' }],
      corpusSamplesUserSet: true,
    });
  });

  it('preserves tuned sampling but clears result-scoped user flags after clear', () => {
    const state = topicModelingParameterReducer(createTopicModelingParameterState(), {
      type: 'hydrateRequest',
      request: {
        random_seed: 99,
        segmentation_method: 'sentence',
        max_segment_tokens: 128,
        sample_fractions: [0.25],
      },
      nodeDocCounts: [10000],
    });
    const cleared = topicModelingParameterReducer(state, {
      type: 'resetAfterClear',
      defaultSamples: [{ percent: '100' }],
    });

    expect(cleared.corpusSamples).toEqual([{ percent: '25' }]);
    expect(cleared.corpusSamplesUserSet).toBe(true);
    expect(cleared.randomSeed).toBe(99);
    expect(cleared.randomSeedUserSet).toBe(false);
    expect(cleared.segmentationMethod).toBe('sentence');
    expect(cleared.maxSegmentTokens).toBe(128);
  });
});
