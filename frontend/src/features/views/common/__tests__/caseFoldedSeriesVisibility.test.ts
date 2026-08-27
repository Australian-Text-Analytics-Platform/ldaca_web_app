import { describe, expect, it } from 'vitest';

import {
  createCaseFoldedSeriesVisibility,
  reduceCaseFoldedSeriesVisibility,
} from '../caseFoldedSeriesVisibility';

describe('case-folded series visibility', () => {
  it('toggles every exact member represented by one display group', () => {
    const hidden = reduceCaseFoldedSeriesVisibility(createCaseFoldedSeriesVisibility<number>(), {
      type: 'toggle-members',
      keys: [1, 3],
    });
    expect(hidden.excludedKeys).toEqual(new Set([1, 3]));

    const restored = reduceCaseFoldedSeriesVisibility(hidden, {
      type: 'toggle-members',
      keys: [1, 3],
    });
    expect(restored.excludedKeys.size).toBe(0);
  });

  it('clears exact exclusions when the Uncased mode changes', () => {
    const hidden = {
      uncased: false,
      excludedKeys: new Set(['Jobs']),
    };

    expect(reduceCaseFoldedSeriesVisibility(hidden, { type: 'set-uncased', value: true })).toEqual({
      uncased: true,
      excludedKeys: new Set(),
    });
  });
});
