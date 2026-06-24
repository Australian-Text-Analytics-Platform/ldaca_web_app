export interface DatetimeModalState {
  isOpen: boolean;
  column: string;
  targetType: string;
}

export interface ColumnMutationState {
  columnTypes: Record<string, string>;
  loadingCast: Record<string, boolean>;
  columnActionLoading: Record<string, boolean>;
  renamingColumn: string | null;
  datetimeModal: DatetimeModalState;
  columnToDelete: string | null;
}

export type ColumnMutationAction =
  | { type: 'schemaApplied'; columnTypes: Record<string, string> }
  | { type: 'castLoadingChanged'; column: string; active: boolean }
  | { type: 'columnActionLoadingChanged'; column: string; active: boolean }
  | { type: 'datetimeRequested'; column: string; targetType: string }
  | { type: 'datetimeClosed' }
  | { type: 'renameStarted'; column: string }
  | { type: 'renameClosed' }
  | { type: 'deleteRequested'; column: string }
  | { type: 'deleteDialogChanged'; open: boolean }
  | { type: 'columnTypeRemoved'; column: string }
  | { type: 'columnDeleteSucceeded'; column: string };

const closedDatetimeModal: DatetimeModalState = {
  isOpen: false,
  column: '',
  targetType: '',
};

/**
 * Creates the reducer-owned state for workspace column-header mutations.
 * Used by: useColumnMutations hook.
 * Why: because cast, rename, delete, and modal state are one UI workflow and
 * should not be scattered across independent useState calls.
 */
export const createColumnMutationState = (): ColumnMutationState => ({
  columnTypes: {},
  loadingCast: {},
  columnActionLoading: {},
  renamingColumn: null,
  datetimeModal: closedDatetimeModal,
  columnToDelete: null,
});

const setColumnFlag = (
  current: Record<string, boolean>,
  column: string,
  active: boolean,
): Record<string, boolean> => {
  if (active) return current[column] ? current : { ...current, [column]: true };
  if (!(column in current)) return current;
  const { [column]: _, ...next } = current;
  return next;
};

/**
 * Reduces the column mutation workflow into one state transition point.
 * Used by: useColumnMutations hook.
 * Flow: schema actions replace dtype metadata; busy actions toggle sparse
 * per-column maps; modal/delete/rename actions keep related UI state together.
 */
export const columnMutationReducer = (
  state: ColumnMutationState,
  action: ColumnMutationAction,
): ColumnMutationState => {
  switch (action.type) {
    case 'schemaApplied':
      return { ...state, columnTypes: action.columnTypes };
    case 'castLoadingChanged': {
      const loadingCast = setColumnFlag(state.loadingCast, action.column, action.active);
      return loadingCast === state.loadingCast ? state : { ...state, loadingCast };
    }
    case 'columnActionLoadingChanged': {
      const columnActionLoading = setColumnFlag(
        state.columnActionLoading,
        action.column,
        action.active,
      );
      return columnActionLoading === state.columnActionLoading
        ? state
        : { ...state, columnActionLoading };
    }
    case 'datetimeRequested':
      return {
        ...state,
        datetimeModal: { isOpen: true, column: action.column, targetType: action.targetType },
      };
    case 'datetimeClosed':
      return state.datetimeModal.isOpen ? { ...state, datetimeModal: closedDatetimeModal } : state;
    case 'renameStarted':
      return state.renamingColumn === action.column
        ? state
        : { ...state, renamingColumn: action.column };
    case 'renameClosed':
      return state.renamingColumn === null ? state : { ...state, renamingColumn: null };
    case 'deleteRequested':
      return state.columnToDelete === action.column
        ? state
        : { ...state, columnToDelete: action.column };
    case 'deleteDialogChanged':
      return action.open || state.columnToDelete === null
        ? state
        : { ...state, columnToDelete: null };
    case 'columnTypeRemoved': {
      if (!(action.column in state.columnTypes)) return state;
      const { [action.column]: _, ...columnTypes } = state.columnTypes;
      return { ...state, columnTypes };
    }
    case 'columnDeleteSucceeded':
      return state.renamingColumn === action.column ? { ...state, renamingColumn: null } : state;
    default:
      return state;
  }
};
