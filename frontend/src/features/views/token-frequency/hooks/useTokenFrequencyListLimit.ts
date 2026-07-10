import { useEffect, useMemo, useReducer, type ChangeEvent } from 'react';
import type { NodeResultView } from '../tokenFrequencyAdapters';

interface UseTokenFrequencyListLimitOptions {
  nodeDisplayResults: NodeResultView[];
  effectiveTokenLimit: number;
  tokenLimitInput: string;
  onTokenLimitBlur: () => void;
  applyCloudTokenLimit: (value: number) => Promise<void> | void;
}

interface TokenFrequencyListLimitState {
  listLimit: number;
  listLimitInput: string;
  listLimitError: string | null;
}

type TokenFrequencyListLimitAction =
  | { type: 'sync-cloud-limit'; effectiveTokenLimit: number }
  | { type: 'edit-list-input'; value: string }
  | { type: 'invalid-list-input'; message: string }
  | { type: 'apply-list-limit'; value: number }
  | { type: 'mirror-cloud-limit'; value: number };

const INITIAL_LIST_LIMIT_STATE: TokenFrequencyListLimitState = {
  listLimit: 0,
  listLimitInput: '',
  listLimitError: null,
};

const CLOUD_TOKEN_LIMIT_CAP = 100;
const MIN_TOKEN_LIMIT = 10;

/**
 * Returns the largest vocabulary available to the list view.
 * Used by: useTokenFrequencyListLimit so the list-side display limit can
 * exceed the cloud cap while still staying inside the loaded result rows.
 */
export const deriveTokenFrequencyMaxVocabulary = (nodeDisplayResults: NodeResultView[]): number => {
  let max = 0;
  for (const node of nodeDisplayResults) {
    const filtered = Array.isArray(node.filteredRows) ? node.filteredRows.length : 0;
    const raw = Array.isArray(node.rows) ? node.rows.length : 0;
    if (filtered > max) max = filtered;
    if (raw > max) max = raw;
  }
  return Math.max(max, MIN_TOKEN_LIMIT);
};

/**
 * Owns the list/cloud display-limit draft state for token-frequency results.
 * Used by: useTokenFrequencyListLimit because cloud and list limits have
 * asymmetric caps but still need predictable mirroring rules.
 */
const tokenFrequencyListLimitReducer = (
  state: TokenFrequencyListLimitState,
  action: TokenFrequencyListLimitAction,
): TokenFrequencyListLimitState => {
  switch (action.type) {
    case 'sync-cloud-limit': {
      if (!Number.isFinite(action.effectiveTokenLimit) || action.effectiveTokenLimit <= 0) {
        return state;
      }
      return {
        ...state,
        listLimit:
          state.listLimit > CLOUD_TOKEN_LIMIT_CAP ? state.listLimit : action.effectiveTokenLimit,
        listLimitInput:
          Number.isFinite(Number.parseInt(state.listLimitInput, 10)) &&
          Number.parseInt(state.listLimitInput, 10) > CLOUD_TOKEN_LIMIT_CAP
            ? state.listLimitInput
            : String(action.effectiveTokenLimit),
      };
    }
    case 'edit-list-input':
      return {
        ...state,
        listLimitInput: action.value,
        listLimitError: state.listLimitError ? null : state.listLimitError,
      };
    case 'invalid-list-input':
      return { ...state, listLimitError: action.message };
    case 'apply-list-limit':
      return {
        ...state,
        listLimit: action.value,
        listLimitInput: String(action.value),
        listLimitError: null,
      };
    case 'mirror-cloud-limit':
      return {
        ...state,
        listLimit: action.value,
        listLimitInput: String(action.value),
        listLimitError: null,
      };
  }
};

/**
 * Coordinates the token-frequency result panel's list-side display limit with
 * the backend-persisted cloud token limit.
 * Used by: TokenFrequencyResultsPanel so the panel renders controls while this
 * hook owns validation, vocabulary clamping, and cloud-cap mirroring.
 * Flow: sync from backend cloud limit until the list limit intentionally
 * exceeds 100, apply list edits with vocabulary clamping, and mirror cloud
 * applies back down to the list limit.
 */
export function useTokenFrequencyListLimit({
  nodeDisplayResults,
  effectiveTokenLimit,
  tokenLimitInput,
  onTokenLimitBlur,
  applyCloudTokenLimit,
}: UseTokenFrequencyListLimitOptions) {
  const globalMaxVocab = useMemo(
    () => deriveTokenFrequencyMaxVocabulary(nodeDisplayResults),
    [nodeDisplayResults],
  );
  const [state, dispatch] = useReducer(tokenFrequencyListLimitReducer, INITIAL_LIST_LIMIT_STATE);

  useEffect(() => {
    dispatch({ type: 'sync-cloud-limit', effectiveTokenLimit });
  }, [effectiveTokenLimit]);

  /** Captures list-limit edits and clears stale validation errors. */
  const handleListLimitInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: 'edit-list-input', value: event.target.value });
  };

  /**
   * Applies the list-side limit and mirrors the capped value to cloud
   * preferences when the backend value needs to change.
   */
  const handleApplyListLimit = () => {
    const parsed = Number.parseInt(state.listLimitInput, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      dispatch({
        type: 'invalid-list-input',
        message: 'Enter a whole number greater than zero.',
      });
      return;
    }
    const clamped = Math.max(MIN_TOKEN_LIMIT, Math.min(parsed, globalMaxVocab));
    dispatch({ type: 'apply-list-limit', value: clamped });
    const cloudTarget = Math.min(clamped, CLOUD_TOKEN_LIMIT_CAP);
    if (cloudTarget !== effectiveTokenLimit) {
      void applyCloudTokenLimit(cloudTarget);
    }
  };

  /**
   * Applies the cloud-side limit and mirrors the capped value into list state.
   * The persisted cloud preference still flows through the caller's blur path.
   */
  const handleApplyCloudLimit = () => {
    const parsed = Number.parseInt(tokenLimitInput, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      const cloudClamped = Math.max(MIN_TOKEN_LIMIT, Math.min(parsed, CLOUD_TOKEN_LIMIT_CAP));
      dispatch({ type: 'mirror-cloud-limit', value: cloudClamped });
    }
    onTokenLimitBlur();
  };

  return {
    globalMaxVocab,
    listLimit: state.listLimit,
    listLimitInput: state.listLimitInput,
    listLimitError: state.listLimitError,
    handleListLimitInputChange,
    handleApplyListLimit,
    handleApplyCloudLimit,
  };
}
