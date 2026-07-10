import { toCellText } from '../concordanceTableDomain';

type ConcordanceParameterUpdate<T> = T | ((previous: T) => T);

export interface ConcordanceRequestParams {
  search_word: string;
  num_left_tokens: number;
  num_right_tokens: number;
  regex: boolean;
  whole_word: boolean;
  case_sensitive: boolean;
}

export interface ConcordanceParameterState {
  searchWord: string;
  numLeftTokens: number;
  numRightTokens: number;
  regex: boolean;
  wholeWord: boolean;
  caseSensitive: boolean;
}

type ConcordanceParameterAction =
  | { type: 'setSearchWord'; value: ConcordanceParameterUpdate<string> }
  | { type: 'setNumLeftTokens'; value: ConcordanceParameterUpdate<number> }
  | { type: 'setNumRightTokens'; value: ConcordanceParameterUpdate<number> }
  | { type: 'setRegex'; value: ConcordanceParameterUpdate<boolean> }
  | { type: 'setWholeWord'; value: ConcordanceParameterUpdate<boolean> }
  | { type: 'setCaseSensitive'; value: ConcordanceParameterUpdate<boolean> }
  | { type: 'hydrateParams'; params: ConcordanceRequestParams };

const resolveUpdate = <T>(value: ConcordanceParameterUpdate<T>, previous: T): T =>
  typeof value === 'function' ? (value as (current: T) => T)(previous) : value;

/**
 * Creates the Concordance search form defaults used before user edits or task
 * hydration.
 * Used by: useConcordanceParameters and reducer tests so the form's default
 * query model is documented in one place.
 */
export const createConcordanceParameterState = (): ConcordanceParameterState => ({
  searchWord: '',
  numLeftTokens: 10,
  numRightTokens: 10,
  regex: false,
  wholeWord: true,
  caseSensitive: false,
});

/**
 * Normalizes a saved concordance request's params for diffing against live form
 * values.
 * Used by: ConcordanceFeature when deciding whether the primary action is Run,
 * Re-run, or up to date.
 */
export function readConcordanceServerParams(
  request: Record<string, unknown>,
): ConcordanceRequestParams {
  const regex = typeof request.regex === 'boolean' ? request.regex : false;
  return {
    search_word: typeof request.search_word === 'string' ? request.search_word : '',
    num_left_tokens: typeof request.num_left_tokens === 'number' ? request.num_left_tokens : 5,
    num_right_tokens: typeof request.num_right_tokens === 'number' ? request.num_right_tokens : 5,
    regex,
    whole_word: regex ? false : typeof request.whole_word === 'boolean' ? request.whole_word : true,
    case_sensitive: typeof request.case_sensitive === 'boolean' ? request.case_sensitive : false,
  };
}

/**
 * Owns Concordance search form state, including the invariant that regex mode
 * disables whole-word matching.
 * Used by: useConcordanceParameters, which exposes this model through the
 * existing hook API consumed by ConcordanceFeature and ConcordanceParameterPanel.
 * Flow: apply field edits, force whole-word off when regex is enabled, and
 * hydrate all form fields from normalized saved-request params.
 */
export const concordanceParameterReducer = (
  state: ConcordanceParameterState,
  action: ConcordanceParameterAction,
): ConcordanceParameterState => {
  switch (action.type) {
    case 'setSearchWord':
      return { ...state, searchWord: resolveUpdate(action.value, state.searchWord) };
    case 'setNumLeftTokens':
      return { ...state, numLeftTokens: resolveUpdate(action.value, state.numLeftTokens) };
    case 'setNumRightTokens':
      return { ...state, numRightTokens: resolveUpdate(action.value, state.numRightTokens) };
    case 'setRegex': {
      const regex = resolveUpdate(action.value, state.regex);
      return {
        ...state,
        regex,
        wholeWord: regex ? false : state.wholeWord,
      };
    }
    case 'setWholeWord':
      return {
        ...state,
        wholeWord: state.regex ? false : resolveUpdate(action.value, state.wholeWord),
      };
    case 'setCaseSensitive':
      return { ...state, caseSensitive: resolveUpdate(action.value, state.caseSensitive) };
    case 'hydrateParams':
      return {
        searchWord: toCellText(action.params.search_word),
        numLeftTokens: action.params.num_left_tokens,
        numRightTokens: action.params.num_right_tokens,
        regex: action.params.regex,
        wholeWord: action.params.regex ? false : action.params.whole_word,
        caseSensitive: action.params.case_sensitive,
      };
  }
};
