import { useCallback, useReducer } from 'react';

import type { SequentialAnalysisRequest } from '@/api';
import { normalizeStringArray } from '../../common/parameterComparison';

export type SequentialFrequency = NonNullable<SequentialAnalysisRequest['frequency']>;
export type SequentialCustomIntervalUnit = NonNullable<
  SequentialAnalysisRequest['custom_interval_unit']
>;

export interface SequentialHydratedParams {
  timeColumn: string;
  groupByColumns: string[];
  frequency: SequentialFrequency;
  columnType: 'datetime' | 'numeric';
  numericOrigin: number | null;
  numericInterval: number | null;
  customIntervalValue: number | null;
  customIntervalUnit: SequentialCustomIntervalUnit | null;
}

export interface SequentialParameterValues {
  numericOriginValue: number | null;
  numericIntervalValue: number | null;
  isCustomDatetime: boolean;
  customIntervalValue: number | null;
  customIntervalUnitValue: SequentialCustomIntervalUnit | null;
  currentSequentialParams: {
    frequency: SequentialFrequency;
    group_by_columns: string[];
    column_type: 'datetime' | 'numeric';
    numeric_origin: number | null;
    numeric_interval: number | null;
    custom_interval_value: number | null;
    custom_interval_unit: SequentialCustomIntervalUnit | null;
  };
}

export interface SequentialParameterDraftState {
  frequency: SequentialFrequency;
  groupByColumns: string[];
  numericOriginInput: string;
  numericIntervalInput: string;
  customIntervalValueInput: string;
  customIntervalUnit: SequentialCustomIntervalUnit;
}

interface SequentialParameterState extends SequentialParameterDraftState {
  timeColumn: string;
}

type HydratedSequentialParameterState = SequentialParameterState;

/**
 * Parses optional numeric inputs while preserving `null` for empty or invalid
 * entries.
 * Used by: sequential-analysis request derivation because numeric origin and
 * interval fields are stored as user-editable strings until validation time.
 */
const parseNumericInput = (value: string): number | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Parses custom interval values that must be positive whole numbers.
 * Used by: sequential-analysis request derivation before submitting custom
 * datetime frequency runs.
 */
const parsePositiveIntegerInput = (value: string): number | null => {
  const parsed = parseNumericInput(value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

/**
 * Derives typed request values from the editable parameter state.
 * Used by: SequentialAnalysisFeature for rerun diffing and task submission,
 * and by tests to verify request normalization without mounting the feature.
 */
export function deriveSequentialParameterValues(
  state: SequentialParameterDraftState,
  derivedColumnType: 'datetime' | 'numeric',
): SequentialParameterValues {
  const numericOriginValue =
    derivedColumnType === 'numeric' ? parseNumericInput(state.numericOriginInput) : null;
  const numericIntervalValue =
    derivedColumnType === 'numeric' ? parseNumericInput(state.numericIntervalInput) : null;
  const isCustomDatetime = derivedColumnType === 'datetime' && state.frequency === 'custom';
  const customIntervalValue = isCustomDatetime
    ? parsePositiveIntegerInput(state.customIntervalValueInput)
    : null;
  const customIntervalUnitValue: SequentialCustomIntervalUnit | null = isCustomDatetime
    ? state.customIntervalUnit
    : null;

  return {
    numericOriginValue,
    numericIntervalValue,
    isCustomDatetime,
    customIntervalValue,
    customIntervalUnitValue,
    currentSequentialParams: {
      frequency: state.frequency,
      group_by_columns: normalizeStringArray(state.groupByColumns),
      column_type: derivedColumnType,
      numeric_origin: derivedColumnType === 'numeric' ? numericOriginValue : null,
      numeric_interval: derivedColumnType === 'numeric' ? numericIntervalValue : null,
      custom_interval_value: isCustomDatetime ? customIntervalValue : null,
      custom_interval_unit: isCustomDatetime ? customIntervalUnitValue : null,
    },
  };
}

const INITIAL_SEQUENTIAL_PARAMETER_STATE: SequentialParameterState = {
  timeColumn: '',
  groupByColumns: [],
  frequency: 'daily',
  numericOriginInput: '',
  numericIntervalInput: '1',
  customIntervalValueInput: '1',
  customIntervalUnit: 'minutes',
};

type SequentialParameterAction =
  | { type: 'set-time-column'; value: string }
  | { type: 'set-group-by-columns'; value: string[] }
  | { type: 'set-frequency'; value: SequentialFrequency }
  | { type: 'set-numeric-origin-input'; value: string }
  | { type: 'set-numeric-interval-input'; value: string }
  | { type: 'set-custom-interval-value-input'; value: string }
  | { type: 'set-custom-interval-unit'; value: SequentialCustomIntervalUnit }
  | { type: 'add-group-by-column' }
  | { type: 'remove-group-by-column'; index: number }
  | { type: 'change-group-by-column'; index: number; value: string }
  | { type: 'hydrate'; state: SequentialParameterState };

/**
 * Owns the coupled edits for the sequential-analysis parameter form.
 * Used by: useSequentialAnalysisParameters because hydration and clear actions
 * update several fields together while simple panel edits should remain local
 * field actions.
 */
const sequentialParameterReducer = (
  state: SequentialParameterState,
  action: SequentialParameterAction,
): SequentialParameterState => {
  switch (action.type) {
    case 'set-time-column':
      return { ...state, timeColumn: action.value };
    case 'set-group-by-columns':
      return { ...state, groupByColumns: action.value };
    case 'set-frequency':
      return { ...state, frequency: action.value };
    case 'set-numeric-origin-input':
      return { ...state, numericOriginInput: action.value };
    case 'set-numeric-interval-input':
      return { ...state, numericIntervalInput: action.value };
    case 'set-custom-interval-value-input':
      return { ...state, customIntervalValueInput: action.value };
    case 'set-custom-interval-unit':
      return { ...state, customIntervalUnit: action.value };
    case 'add-group-by-column':
      return state.groupByColumns.length < 3
        ? { ...state, groupByColumns: [...state.groupByColumns, ''] }
        : state;
    case 'remove-group-by-column':
      return {
        ...state,
        groupByColumns: state.groupByColumns.filter((_, i) => i !== action.index),
      };
    case 'change-group-by-column': {
      const groupByColumns = [...state.groupByColumns];
      groupByColumns[action.index] = action.value;
      return { ...state, groupByColumns };
    }
    case 'hydrate':
      return action.state;
  }
};

/**
 * Normalizes the subset of stored request parameters used for rerun diffing.
 * Used by: SequentialAnalysisFeature to compare current form state against the
 * last submitted task request.
 */
export function readSequentialServerParams(request: SequentialAnalysisRequest) {
  const serverColumnType = request.column_type ?? 'datetime';
  const serverFrequency = request.frequency ?? 'daily';
  const serverIsCustomDatetime = serverColumnType === 'datetime' && serverFrequency === 'custom';
  return {
    frequency: serverFrequency,
    group_by_columns: normalizeStringArray(request.group_by_columns ?? []),
    column_type: serverColumnType,
    numeric_origin: serverColumnType === 'numeric' ? (request.numeric_origin ?? null) : null,
    numeric_interval: serverColumnType === 'numeric' ? (request.numeric_interval ?? null) : null,
    custom_interval_value: serverIsCustomDatetime ? (request.custom_interval_value ?? null) : null,
    custom_interval_unit: serverIsCustomDatetime ? (request.custom_interval_unit ?? null) : null,
  };
}

/**
 * Converts a fetched task request into parameter state and hydration metadata.
 * Used by: useSequentialAnalysisParameters so stored task requests restore the
 * form and the result summary from one normalization path.
 */
function resolveHydratedSequentialParameters(req: SequentialAnalysisRequest): {
  nodeId: string;
  state: HydratedSequentialParameterState;
  hydratedParams: SequentialHydratedParams;
  columnType: 'datetime' | 'numeric';
} {
  const nodeId = req.node_id;
  const timeColumn = req.time_column;
  const columnType = req.column_type === 'numeric' ? 'numeric' : 'datetime';
  const numericOrigin = columnType === 'numeric' ? (req.numeric_origin ?? null) : null;
  const numericInterval = columnType === 'numeric' ? (req.numeric_interval ?? null) : null;
  const groupByColumns = normalizeStringArray(req.group_by_columns ?? []);
  const frequency = req.frequency ?? 'daily';
  const customIntervalValue =
    columnType === 'datetime' &&
    frequency === 'custom' &&
    req.custom_interval_value != null &&
    Number.isInteger(req.custom_interval_value) &&
    req.custom_interval_value > 0
      ? req.custom_interval_value
      : null;
  const customIntervalUnit =
    columnType === 'datetime' && frequency === 'custom' && req.custom_interval_unit != null
      ? req.custom_interval_unit
      : null;
  return {
    nodeId,
    columnType,
    state: {
      timeColumn,
      groupByColumns,
      frequency,
      numericOriginInput:
        columnType === 'numeric' && numericOrigin != null ? String(numericOrigin) : '',
      numericIntervalInput:
        columnType === 'numeric' && numericInterval != null ? String(numericInterval) : '1',
      customIntervalValueInput:
        frequency === 'custom' && columnType === 'datetime' && customIntervalValue != null
          ? String(customIntervalValue)
          : '1',
      customIntervalUnit:
        frequency === 'custom' && columnType === 'datetime'
          ? (customIntervalUnit ?? 'minutes')
          : 'minutes',
    },
    hydratedParams: {
      timeColumn,
      groupByColumns,
      frequency,
      columnType,
      numericOrigin,
      numericInterval,
      customIntervalValue,
      customIntervalUnit,
    },
  };
}

/**
 * Owns editable sequential-analysis parameter state. SequentialAnalysisFeature
 * uses this hook to keep form drafts, request hydration, and group-by handlers
 * out of the orchestration shell.
 * Flow: initialize form defaults, expose small field setters for the parameter
 * panel and normalize hydrated task requests.
 */
export function useSequentialAnalysisParameters() {
  const [state, dispatch] = useReducer(
    sequentialParameterReducer,
    INITIAL_SEQUENTIAL_PARAMETER_STATE,
  );
  const setTimeColumn = useCallback((value: string) => {
    dispatch({ type: 'set-time-column', value });
  }, []);
  const setGroupByColumns = useCallback((value: string[]) => {
    dispatch({ type: 'set-group-by-columns', value });
  }, []);
  const setFrequency = useCallback((value: SequentialFrequency) => {
    dispatch({ type: 'set-frequency', value });
  }, []);
  const setNumericOriginInput = useCallback((value: string) => {
    dispatch({ type: 'set-numeric-origin-input', value });
  }, []);
  const setNumericIntervalInput = useCallback((value: string) => {
    dispatch({ type: 'set-numeric-interval-input', value });
  }, []);
  const setCustomIntervalValueInput = useCallback((value: string) => {
    dispatch({ type: 'set-custom-interval-value-input', value });
  }, []);
  const setCustomIntervalUnit = useCallback((value: SequentialCustomIntervalUnit) => {
    dispatch({ type: 'set-custom-interval-unit', value });
  }, []);

  /**
   * Adds a blank grouping control up to the supported three-column limit.
   * Called by: SequentialAnalysisParameterPanel because the UI owns rendering
   * group slots while this hook owns their editable array state.
   */
  const addGroupByColumn = useCallback(() => {
    dispatch({ type: 'add-group-by-column' });
  }, []);

  /**
   * Removes one grouping control while preserving the order of the remaining
   * groups.
   * Called by: SequentialAnalysisParameterPanel group delete controls.
   */
  const removeGroupByColumn = useCallback((index: number) => {
    dispatch({ type: 'remove-group-by-column', index });
  }, []);

  /**
   * Updates the selected column for one grouping slot.
   * Called by: SequentialAnalysisParameterPanel group selectors.
   */
  const changeGroupByColumn = useCallback((index: number, value: string) => {
    dispatch({ type: 'change-group-by-column', index, value });
  }, []);

  /**
   * Restores parameter controls from a submitted task request.
   * Called by: SequentialAnalysisFeature hydration after it fetches the stored
   * request for an Analysis identity.
   */
  const applyHydratedRequest = useCallback((request: SequentialAnalysisRequest) => {
    const hydrated = resolveHydratedSequentialParameters(request);
    dispatch({ type: 'hydrate', state: hydrated.state });
    return hydrated;
  }, []);

  return {
    timeColumn: state.timeColumn,
    setTimeColumn,
    groupByColumns: state.groupByColumns,
    setGroupByColumns,
    frequency: state.frequency,
    setFrequency,
    numericOriginInput: state.numericOriginInput,
    setNumericOriginInput,
    numericIntervalInput: state.numericIntervalInput,
    setNumericIntervalInput,
    customIntervalValueInput: state.customIntervalValueInput,
    setCustomIntervalValueInput,
    customIntervalUnit: state.customIntervalUnit,
    setCustomIntervalUnit,
    addGroupByColumn,
    removeGroupByColumn,
    changeGroupByColumn,
    applyHydratedRequest,
  };
}
