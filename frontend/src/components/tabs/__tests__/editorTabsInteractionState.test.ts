import { describe, expect, it } from 'vitest';

import {
  createEditorTabsInteractionState,
  editorTabsInteractionReducer,
} from '../editorTabsInteractionState';

describe('editorTabsInteractionReducer', () => {
  it('starts, updates, and clears drag preview state as one interaction', () => {
    const dragging = editorTabsInteractionReducer(createEditorTabsInteractionState(), {
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

    const moved = editorTabsInteractionReducer(dragging, {
      type: 'dragMoved',
      deltaX: 50,
      order: ['tab-2', 'tab-1', 'tab-3'],
    });

    expect(moved.drag).toMatchObject({
      order: ['tab-2', 'tab-1', 'tab-3'],
      deltaX: 50,
    });
    expect(editorTabsInteractionReducer(moved, { type: 'dragCleared' }).drag).toEqual({
      order: null,
      tabId: null,
      deltaX: 0,
      homeLeft: 0,
    });
  });

  it('ignores drag moves before a drag has started', () => {
    const initial = createEditorTabsInteractionState();

    expect(
      editorTabsInteractionReducer(initial, {
        type: 'dragMoved',
        deltaX: 48,
        order: ['tab-2', 'tab-1'],
      }),
    ).toBe(initial);
  });

  it('keeps inline rename id and draft together', () => {
    const renaming = editorTabsInteractionReducer(createEditorTabsInteractionState(), {
      type: 'renameStarted',
      tabId: 'tab-1',
      title: 'Analysis 1',
    });

    expect(renaming.rename).toEqual({ id: 'tab-1', draftTitle: 'Analysis 1' });

    const edited = editorTabsInteractionReducer(renaming, {
      type: 'renameDraftChanged',
      title: 'Renamed analysis',
    });

    expect(edited.rename).toEqual({ id: 'tab-1', draftTitle: 'Renamed analysis' });
    expect(editorTabsInteractionReducer(edited, { type: 'renameCancelled' }).rename).toEqual({
      id: null,
      draftTitle: '',
    });
  });
});
