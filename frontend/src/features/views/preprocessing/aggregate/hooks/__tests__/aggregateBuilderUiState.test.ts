import { describe, expect, it } from 'vitest';

import {
  aggregateBuilderUiReducer,
  createAggregateBuilderUiState,
} from '../aggregateBuilderUiState';

describe('aggregateBuilderUiReducer', () => {
  it('tracks and clears drag state as one builder interaction', () => {
    const dragging = aggregateBuilderUiReducer(createAggregateBuilderUiState(), {
      type: 'setDragActive',
      active: true,
    });
    const withIndicator = aggregateBuilderUiReducer(dragging, {
      type: 'setDropIndicator',
      indicator: { tokenId: 'token-1', position: 'after' },
    });

    expect(withIndicator).toMatchObject({
      dragActive: true,
      dropIndicator: { tokenId: 'token-1', position: 'after' },
    });
    expect(aggregateBuilderUiReducer(withIndicator, { type: 'clearDragState' })).toMatchObject({
      dragActive: false,
      dropIndicator: null,
    });
  });

  it('opens custom-token editing with the starting draft', () => {
    const state = aggregateBuilderUiReducer(createAggregateBuilderUiState(), {
      type: 'startCustomEdit',
      tokenId: 'custom-token',
      draft: 'initial',
    });

    expect(state).toMatchObject({
      editingTokenId: 'custom-token',
      customDraft: 'initial',
    });
  });

  it('updates and clears custom-token edit state together', () => {
    const editing = aggregateBuilderUiReducer(createAggregateBuilderUiState(), {
      type: 'startCustomEdit',
      tokenId: 'custom-token',
      draft: '',
    });
    const updated = aggregateBuilderUiReducer(editing, {
      type: 'setCustomDraft',
      draft: 'typed value',
    });

    expect(updated.customDraft).toBe('typed value');
    expect(aggregateBuilderUiReducer(updated, { type: 'clearCustomEdit' })).toMatchObject({
      editingTokenId: null,
      customDraft: '',
    });
  });
});
