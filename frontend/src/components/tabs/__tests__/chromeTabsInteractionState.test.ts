import { describe, expect, it } from 'vitest';

import {
  chromeTabsInteractionReducer,
  createChromeTabsInteractionState,
} from '../chromeTabsInteractionState';

describe('chromeTabsInteractionReducer', () => {
  it('starts, updates, and clears drag preview state as one interaction', () => {
    const dragging = chromeTabsInteractionReducer(createChromeTabsInteractionState(), {
      type: 'dragStarted',
      tabId: 'tab-1',
      order: ['tab-1', 'tab-2', 'tab-3'],
      homeLeft: 24,
    });

    expect(dragging.drag).toEqual({
      order: ['tab-1', 'tab-2', 'tab-3'],
      tabId: 'tab-1',
      deltaX: 0,
      homeLeft: 24,
    });

    const moved = chromeTabsInteractionReducer(dragging, {
      type: 'dragMoved',
      deltaX: 60,
      order: ['tab-2', 'tab-1', 'tab-3'],
    });

    expect(moved.drag).toMatchObject({
      order: ['tab-2', 'tab-1', 'tab-3'],
      deltaX: 60,
    });
    expect(chromeTabsInteractionReducer(moved, { type: 'dragCleared' }).drag).toEqual({
      order: null,
      tabId: null,
      deltaX: 0,
      homeLeft: 0,
    });
  });

  it('ignores drag moves before a drag has started', () => {
    const initial = createChromeTabsInteractionState();

    expect(
      chromeTabsInteractionReducer(initial, {
        type: 'dragMoved',
        deltaX: 48,
        order: ['tab-2', 'tab-1'],
      }),
    ).toBe(initial);
  });

  it('keeps inline rename id and draft together', () => {
    const renaming = chromeTabsInteractionReducer(createChromeTabsInteractionState(), {
      type: 'renameStarted',
      tabId: 'tab-1',
      title: 'Analysis 1',
    });

    expect(renaming.rename).toEqual({ id: 'tab-1', draftTitle: 'Analysis 1' });

    const edited = chromeTabsInteractionReducer(renaming, {
      type: 'renameDraftChanged',
      title: 'Renamed analysis',
    });

    expect(edited.rename).toEqual({ id: 'tab-1', draftTitle: 'Renamed analysis' });
    expect(chromeTabsInteractionReducer(edited, { type: 'renameCancelled' }).rename).toEqual({
      id: null,
      draftTitle: '',
    });
  });
});
