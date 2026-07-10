import { describe, expect, it } from 'vitest';

import { buildSamplingAutoNodeName } from '../samplingAutoNodeName';

describe('buildSamplingAutoNodeName', () => {
  it('encodes slice bounds and random-sample settings', () => {
    expect(
      buildSamplingAutoNodeName({ baseName: 'Corpus', mode: 'slice', offset: 4, length: 3 }),
    ).toBe('Corpus_sliced_from_4_to_6');
    expect(
      buildSamplingAutoNodeName({
        baseName: 'Corpus',
        mode: 'random_sample',
        sampleSize: 0.4,
        randomSeed: 7,
      }),
    ).toBe('Corpus_sampled_fr_0_4_rs_7');
  });

  it('preserves sanitized naming for positive exponential sample sizes', () => {
    expect(
      buildSamplingAutoNodeName({
        baseName: 'Corpus',
        mode: 'random_sample',
        sampleSize: 1e21,
      }),
    ).toBe('Corpus_sampled_n_1e_21');
  });
});
