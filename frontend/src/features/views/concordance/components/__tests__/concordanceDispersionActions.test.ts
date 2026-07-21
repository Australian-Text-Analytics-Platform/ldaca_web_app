import { describe, expect, it } from 'vitest';

import {
  buildDispersionDetachActionState,
  getVisibleMatchedTexts,
  toggleHiddenMatchedText,
} from '../concordanceDispersionActions';

describe('concordance dispersion actions', () => {
  it('returns null visible terms when colour filtering is off', () => {
    expect(
      getVisibleMatchedTexts({
        colourMatches: false,
        allMatchedTexts: ['alpha', 'beta'],
        hiddenMatchedTexts: new Set(['beta']),
      }),
    ).toBeNull();
  });

  it('allows selected-bin detach from the current result page', () => {
    const state = buildDispersionDetachActionState({
      isBusy: false,
      hasSearchWord: true,
      hasDetachTarget: true,
      hasSelection: true,
      colourMatches: true,
      allMatchedTexts: ['alpha', 'beta'],
      hiddenMatchedTexts: new Set(['beta']),
      selectedBinsHint: 'Detach selected bins.',
      allHitsHint: 'Detach all hits.',
    });

    expect(state.disabled).toBe(false);
    expect(state.visibleMatchedTexts).toEqual(['alpha']);
    expect(state.title).toBe('Detach selected bins.');
  });

  it('blocks detach when every legend term is hidden', () => {
    const state = buildDispersionDetachActionState({
      isBusy: false,
      hasSearchWord: true,
      hasDetachTarget: true,
      hasSelection: false,
      colourMatches: true,
      allMatchedTexts: ['alpha'],
      hiddenMatchedTexts: new Set(['alpha']),
      selectedBinsHint: 'Detach selected bins.',
      allHitsHint: 'Detach all hits.',
    });

    expect(state.disabled).toBe(true);
    expect(state.allLegendHidden).toBe(true);
    expect(state.title).toBe(
      'All matched terms are hidden in the legend. Re-enable at least one to detach.',
    );
  });

  it('allows all-hit detach when required inputs are present and no legend block applies', () => {
    const state = buildDispersionDetachActionState({
      isBusy: false,
      hasSearchWord: true,
      hasDetachTarget: true,
      hasSelection: false,
      colourMatches: false,
      allMatchedTexts: ['alpha'],
      hiddenMatchedTexts: new Set(['alpha']),
      selectedBinsHint: 'Detach selected bins.',
      allHitsHint: 'Detach all hits.',
    });

    expect(state.disabled).toBe(false);
    expect(state.title).toBe('Detach all hits.');
  });

  it('toggles hidden matched terms immutably', () => {
    const original = new Set(['alpha']);
    const removed = toggleHiddenMatchedText(original, 'alpha');
    const added = toggleHiddenMatchedText(original, 'beta');

    expect(original.has('alpha')).toBe(true);
    expect(removed.has('alpha')).toBe(false);
    expect(added.has('alpha')).toBe(true);
    expect(added.has('beta')).toBe(true);
  });
});
