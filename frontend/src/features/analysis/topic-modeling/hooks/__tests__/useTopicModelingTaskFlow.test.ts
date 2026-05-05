import { describe, expect, it } from 'vitest';

import { buildTopicDetachNodeName } from '../useTopicModelingTaskFlow';

describe('buildTopicDetachNodeName', () => {
  it('includes sample percentage and seed when the source node was sampled', () => {
    expect(buildTopicDetachNodeName('original name', 0.1, 42)).toBe(
      'original name_topic_sampled_fr_0_1_rs_42'
    );
  });

  it('falls back to the standard topic suffix when there was no sampling', () => {
    expect(buildTopicDetachNodeName('original name', null, 42)).toBe(
      'original name_topic'
    );
  });
});