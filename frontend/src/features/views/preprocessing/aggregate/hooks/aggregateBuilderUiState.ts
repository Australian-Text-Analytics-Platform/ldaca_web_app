export interface AggregateDropIndicator {
  tokenId: string;
  position: 'before' | 'after';
}

export interface AggregateBuilderUiState {
  dragActive: boolean;
  dropIndicator: AggregateDropIndicator | null;
  editingTokenId: string | null;
  customDraft: string;
}

export type AggregateBuilderUiAction =
  | { type: 'setDragActive'; active: boolean }
  | { type: 'setDropIndicator'; indicator: AggregateDropIndicator | null }
  | { type: 'clearDragState' }
  | { type: 'startCustomEdit'; tokenId: string; draft: string }
  | { type: 'setCustomDraft'; draft: string }
  | { type: 'clearCustomEdit' };

/**
 * Creates the Aggregate visual builder's interaction-state snapshot. The hook
 * uses this as the lazy reducer initializer so drag state and inline edit
 * fields start from one documented shape.
 * Used by: useAggregateSubTab for the Aggregate builder and reducer tests that
 * verify the builder interaction model without rendering the whole tab.
 */
export const createAggregateBuilderUiState = (): AggregateBuilderUiState => ({
  dragActive: false,
  dropIndicator: null,
  editingTokenId: null,
  customDraft: '',
});

/**
 * Owns UI-only Aggregate builder state that changes together during drag/drop
 * and custom-token editing. Keeping this as a reducer avoids scattering
 * coupled flags through the feature hook.
 * Used by: useAggregateSubTab, which exposes the state through its existing
 * basicBuilder contract for AggregateSubTab rendering.
 * Flow: mark drag activity, update or clear drop targets, open a custom-token
 * edit with its draft text, update draft text while typing, and clear edit
 * fields after commit or cancel.
 */
export const aggregateBuilderUiReducer = (
  state: AggregateBuilderUiState,
  action: AggregateBuilderUiAction,
): AggregateBuilderUiState => {
  switch (action.type) {
    case 'setDragActive':
      return { ...state, dragActive: action.active };
    case 'setDropIndicator':
      return { ...state, dropIndicator: action.indicator };
    case 'clearDragState':
      return { ...state, dragActive: false, dropIndicator: null };
    case 'startCustomEdit':
      return { ...state, editingTokenId: action.tokenId, customDraft: action.draft };
    case 'setCustomDraft':
      return { ...state, customDraft: action.draft };
    case 'clearCustomEdit':
      return { ...state, editingTokenId: null, customDraft: '' };
  }
};
