import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  createTopicModelingResultControlState,
  topicModelingResultControlReducer,
  useTopicModelingResultControls,
} from '../useTopicModelingResultControls';

describe('topicModelingResultControlReducer', () => {
  it('toggles and clears selected topics as one result interaction', () => {
    const withOne = topicModelingResultControlReducer(createTopicModelingResultControlState(), {
      type: 'topicSelectionToggled',
      id: 3,
    });
    const withTwo = topicModelingResultControlReducer(withOne, {
      type: 'topicSelectionToggled',
      id: 7,
    });
    const removedOne = topicModelingResultControlReducer(withTwo, {
      type: 'topicSelectionToggled',
      id: 3,
    });

    expect([...withTwo.selectedTopicIds]).toEqual([3, 7]);
    expect([...removedOne.selectedTopicIds]).toEqual([7]);
    expect(
      topicModelingResultControlReducer(removedOne, { type: 'topicSelectionCleared' })
        .selectedTopicIds.size,
    ).toBe(0);
  });

  it('updates search state without touching selection', () => {
    const selected = topicModelingResultControlReducer(createTopicModelingResultControlState(), {
      type: 'topicSelectionToggled',
      id: 2,
    });
    const searched = topicModelingResultControlReducer(selected, {
      type: 'topicSearchChanged',
      query: 'migration',
    });

    expect(searched.topicSearchQuery).toBe('migration');
    expect([...searched.selectedTopicIds]).toEqual([2]);
  });
});

describe('useTopicModelingResultControls', () => {
  it('exposes stable result-panel actions through the public hook', () => {
    const { result } = renderHook(() => useTopicModelingResultControls());

    act(() => {
      result.current.handleToggleTopicSelection(5);
      result.current.setTopicSearchQuery('alpha');
    });

    expect([...result.current.selectedTopicIds]).toEqual([5]);
    expect(result.current.topicSearchQuery).toBe('alpha');

    act(() => {
      result.current.handleClearTopicSelection();
    });

    expect(result.current.selectedTopicIds.size).toBe(0);
  });
});
