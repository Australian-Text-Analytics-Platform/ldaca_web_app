import { useReducer, type KeyboardEvent } from 'react';
import { DEFAULT_CONTEXT_LENGTH, clampContextLength } from '../quotationTextClip';

interface UseQuotationContextPreferenceArgs {
  currentWorkspaceId: string | null;
  hasLoaded: boolean;
  persistPreference: (value: number) => Promise<unknown>;
}

interface QuotationContextPreferenceState {
  contextLength: number;
  contextLengthInput: string;
  contextLengthError: string | null;
  isSavingContextLength: boolean;
}

type QuotationContextPreferenceAction =
  | { type: 'edit'; input: string }
  | { type: 'hydrate'; value: number }
  | { type: 'validation-error'; message: string }
  | { type: 'commit'; value: number }
  | { type: 'saving'; isSaving: boolean }
  | { type: 'persist-error'; message: string };

export interface UseQuotationContextPreferenceResult extends QuotationContextPreferenceState {
  setContextLengthInput: (input: string) => void;
  applyContextLengthInput: () => Promise<void>;
  handleContextLengthBlur: () => void;
  handleContextLengthKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  applyPreferenceFromResult: (payload: unknown) => void;
}

const INVALID_CONTEXT_LENGTH_MESSAGE = 'Enter a non-negative number.';
const PERSIST_CONTEXT_LENGTH_ERROR = 'Failed to save preference. Please try again.';

const initialState: QuotationContextPreferenceState = {
  contextLength: DEFAULT_CONTEXT_LENGTH,
  contextLengthInput: String(DEFAULT_CONTEXT_LENGTH),
  contextLengthError: null,
  isSavingContextLength: false,
};

const reducer = (
  state: QuotationContextPreferenceState,
  action: QuotationContextPreferenceAction,
): QuotationContextPreferenceState => {
  switch (action.type) {
    case 'edit':
      return {
        ...state,
        contextLengthInput: action.input,
        contextLengthError: state.contextLengthError ? null : state.contextLengthError,
      };
    case 'hydrate':
      return {
        ...state,
        contextLength: action.value,
        contextLengthInput: String(action.value),
        contextLengthError: null,
      };
    case 'validation-error':
      return { ...state, contextLengthError: action.message };
    case 'commit':
      return {
        ...state,
        contextLength: action.value,
        contextLengthInput: String(action.value),
        contextLengthError: null,
      };
    case 'saving':
      return { ...state, isSavingContextLength: action.isSaving };
    case 'persist-error':
      return {
        ...state,
        contextLengthError: action.message,
        isSavingContextLength: false,
      };
    default:
      return state;
  }
};

/**
 * Owns the quotation context-length edit/persist state machine.
 *
 * Used by: QuotationFeature because the results toolbar needs one coherent
 * model for the active clipped-context value, draft input, validation message,
 * and async preference persistence instead of four independent feature states.
 *
 * Flow: hydrate saved preferences from task results, keep draft edits local
 * until blur/Enter commits them, clamp valid values to the clipping helper's
 * supported range, and persist only when loaded quotation results belong to an
 * active workspace.
 */
export function useQuotationContextPreference({
  currentWorkspaceId,
  hasLoaded,
  persistPreference,
}: UseQuotationContextPreferenceArgs): UseQuotationContextPreferenceResult {
  const [state, dispatch] = useReducer(reducer, initialState);

  /** Updates the editable draft and clears any prior validation error. */
  // Called by: QuotationFeature context-length input because each keystroke should not immediately alter the rendered quote clipping.
  const setContextLengthInput = (input: string) => {
    dispatch({ type: 'edit', input });
  };

  /** Applies persisted context-length preferences returned with quotation task results. */
  // Called by: QuotationFeature task hydration and polling callbacks because saved task preferences should restore the toolbar and clipping value together.
  const applyPreferenceFromResult = (payload: unknown) => {
    const payloadObject = payload as Record<string, unknown> | null | undefined;
    const prefs = payloadObject?.preferences as Record<string, unknown> | undefined;
    const prefValue = Number(prefs?.context_length ?? prefs?.contextLength);
    if (!Number.isFinite(prefValue)) {
      return;
    }
    dispatch({ type: 'hydrate', value: clampContextLength(prefValue) });
  };

  /** Validates the draft, commits it locally, and persists changed loaded-task preferences. */
  // Called by: blur and Enter handlers because the toolbar should commit complete user edits rather than every intermediate input value.
  const applyContextLengthInput = async () => {
    const trimmed = state.contextLengthInput.trim();
    if (!trimmed.length) {
      dispatch({ type: 'validation-error', message: INVALID_CONTEXT_LENGTH_MESSAGE });
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      dispatch({ type: 'validation-error', message: INVALID_CONTEXT_LENGTH_MESSAGE });
      return;
    }

    const normalized = clampContextLength(parsed);
    const shouldPersist = Boolean(
      hasLoaded && currentWorkspaceId && normalized !== state.contextLength,
    );

    dispatch({ type: 'commit', value: normalized });

    if (!shouldPersist) {
      return;
    }

    dispatch({ type: 'saving', isSaving: true });
    try {
      await persistPreference(normalized);
      dispatch({ type: 'saving', isSaving: false });
    } catch (error) {
      console.error('Failed to save context length preference', error);
      dispatch({ type: 'persist-error', message: PERSIST_CONTEXT_LENGTH_ERROR });
    }
  };

  /** Commits context-length edits when focus leaves the input. */
  // Called by: QuotationFeature context-length input blur events because blur is the product-level commit point for this preference.
  const handleContextLengthBlur = () => {
    void applyContextLengthInput();
  };

  /** Lets Enter commit context-length edits without submitting surrounding controls. */
  // Called by: QuotationFeature context-length input key events because keyboard users need an explicit commit path.
  const handleContextLengthKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    void applyContextLengthInput();
  };

  return {
    ...state,
    setContextLengthInput,
    applyContextLengthInput,
    handleContextLengthBlur,
    handleContextLengthKeyDown,
    applyPreferenceFromResult,
  };
}
