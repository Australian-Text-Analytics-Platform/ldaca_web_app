import type { ArrowField } from '@/lib/arrow/arrowTable';

export interface DatetimeModalState {
  isOpen: boolean;
  column: string;
  targetType: string;
}

export interface ColumnMutationState {
  columnFields: Record<string, ArrowField>;
  loadingCast: Record<string, boolean>;
  columnActionLoading: Record<string, boolean>;
  renamingColumn: string | null;
  datetimeModal: DatetimeModalState;
  columnToDelete: string | null;
}

export type ColumnMutationAction =
  | { type: 'schemaApplied'; columnFields: Record<string, ArrowField> }
  | { type: 'castLoadingChanged'; column: string; active: boolean }
  | { type: 'columnActionLoadingChanged'; column: string; active: boolean }
  | { type: 'datetimeRequested'; column: string; targetType: string }
  | { type: 'datetimeClosed' }
  | { type: 'renameStarted'; column: string }
  | { type: 'renameClosed' }
  | { type: 'deleteRequested'; column: string }
  | { type: 'deleteDialogChanged'; open: boolean }
  | { type: 'columnFieldRemoved'; column: string };

const closedDatetimeModal: DatetimeModalState = {
  isOpen: false,
  column: '',
  targetType: '',
};

export const createColumnMutationState = (): ColumnMutationState => ({
  columnFields: {},
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

export const columnMutationReducer = (
  state: ColumnMutationState,
  action: ColumnMutationAction,
): ColumnMutationState => {
  switch (action.type) {
    case 'schemaApplied': {
      const currentEntries = Object.entries(state.columnFields);
      const nextEntries = Object.entries(action.columnFields);
      const unchanged =
        currentEntries.length === nextEntries.length &&
        nextEntries.every(([column, field]) => state.columnFields[column] === field);
      return unchanged ? state : { ...state, columnFields: action.columnFields };
    }
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
    case 'columnFieldRemoved': {
      if (!(action.column in state.columnFields)) return state;
      const { [action.column]: _, ...columnFields } = state.columnFields;
      return {
        ...state,
        columnFields,
        renamingColumn: state.renamingColumn === action.column ? null : state.renamingColumn,
      };
    }
    default:
      return state;
  }
};
