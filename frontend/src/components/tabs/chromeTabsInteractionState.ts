interface ChromeTabsDragRenderState {
  order: string[] | null;
  tabId: string | null;
  deltaX: number;
  homeLeft: number;
}

interface ChromeTabsRenameState {
  id: string | null;
  draftTitle: string;
}

export interface ChromeTabsInteractionState {
  drag: ChromeTabsDragRenderState;
  rename: ChromeTabsRenameState;
}

export type ChromeTabsInteractionAction =
  | { type: 'dragStarted'; tabId: string; order: string[]; homeLeft: number }
  | { type: 'dragMoved'; deltaX: number; order: string[] }
  | { type: 'dragCleared' }
  | { type: 'renameStarted'; tabId: string; title: string }
  | { type: 'renameDraftChanged'; title: string }
  | { type: 'renameCancelled' };

const idleDragState: ChromeTabsDragRenderState = {
  order: null,
  tabId: null,
  deltaX: 0,
  homeLeft: 0,
};

const idleRenameState: ChromeTabsRenameState = {
  id: null,
  draftTitle: '',
};

/**
 * Creates the reducer-owned interaction state for the reusable Chrome tab strip.
 * Used by: ChromeTabs component.
 * Why: because drag preview and inline rename are coupled tab-strip modes, not
 * independent state cells.
 */
export const createChromeTabsInteractionState = (): ChromeTabsInteractionState => ({
  drag: idleDragState,
  rename: idleRenameState,
});

/**
 * Reduces tab-strip interaction state without knowing about DOM pointer events.
 * Used by: ChromeTabs component and reducer tests.
 * Flow: drag actions own the render-time preview order/offsets, while rename
 * actions own the active tab id and editable title draft.
 */
export const chromeTabsInteractionReducer = (
  state: ChromeTabsInteractionState,
  action: ChromeTabsInteractionAction,
): ChromeTabsInteractionState => {
  switch (action.type) {
    case 'dragStarted':
      return {
        ...state,
        drag: {
          order: [...action.order],
          tabId: action.tabId,
          deltaX: 0,
          homeLeft: action.homeLeft,
        },
      };
    case 'dragMoved':
      return state.drag.tabId
        ? { ...state, drag: { ...state.drag, deltaX: action.deltaX, order: [...action.order] } }
        : state;
    case 'dragCleared':
      return state.drag.tabId || state.drag.order ? { ...state, drag: idleDragState } : state;
    case 'renameStarted':
      return {
        ...state,
        rename: { id: action.tabId, draftTitle: action.title },
      };
    case 'renameDraftChanged':
      return state.rename.id
        ? { ...state, rename: { ...state.rename, draftTitle: action.title } }
        : state;
    case 'renameCancelled':
      return state.rename.id ? { ...state, rename: idleRenameState } : state;
    default:
      return state;
  }
};
