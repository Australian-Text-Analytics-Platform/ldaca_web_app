export interface DatetimeModalState {
  isOpen: boolean;
  column: string;
  targetType: string;
}

export interface ColumnMutationState {
  columnTypes: Record<string, string>;
  loadingCast: Record<string, boolean>;
  datetimeModal: DatetimeModalState;
}

export type ColumnMutationAction =
  | { type: 'schemaApplied'; columnTypes: Record<string, string> }
  | { type: 'castLoadingChanged'; column: string; active: boolean }
  | { type: 'datetimeRequested'; column: string; targetType: string }
  | { type: 'datetimeClosed' };

const closedDatetimeModal: DatetimeModalState = {
  isOpen: false,
  column: '',
  targetType: '',
};

export const createColumnMutationState = (): ColumnMutationState => ({
  columnTypes: {},
  loadingCast: {},
  datetimeModal: closedDatetimeModal,
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

export const columnMutationReducer = (
  state: ColumnMutationState,
  action: ColumnMutationAction,
): ColumnMutationState => {
  switch (action.type) {
    case 'schemaApplied': {
      const currentEntries = Object.entries(state.columnTypes);
      const nextEntries = Object.entries(action.columnTypes);
      const unchanged =
        currentEntries.length === nextEntries.length &&
        nextEntries.every(([column, type]) => state.columnTypes[column] === type);
      return unchanged ? state : { ...state, columnTypes: action.columnTypes };
    }
    case 'castLoadingChanged': {
      const loadingCast = setColumnFlag(state.loadingCast, action.column, action.active);
      return loadingCast === state.loadingCast ? state : { ...state, loadingCast };
    }
    case 'datetimeRequested':
      return {
        ...state,
        datetimeModal: { isOpen: true, column: action.column, targetType: action.targetType },
      };
    case 'datetimeClosed':
      return state.datetimeModal.isOpen ? { ...state, datetimeModal: closedDatetimeModal } : state;
    default:
      return state;
  }
};
