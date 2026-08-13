import { useReducer, type Dispatch, type SetStateAction } from 'react';
import {
  concordanceParameterReducer,
  createConcordanceParameterState,
  readConcordanceServerParams,
  type ConcordanceRequestParams,
} from './concordanceParameterState';

export { readConcordanceServerParams };

interface ConcordanceInputSelection {
  nodeId: string;
  column: string;
}

/**
 * Owns Concordance search form state and saved-request hydration.
 * Used by: ConcordanceFeature so the feature shell no longer owns individual
 * search-word/context/regex state cells or the request normalization used for
 * rerun detection.
 * Flow: initialize form defaults, keep the regex/whole-word invariant together,
 * expose current request params, and hydrate form controls plus input
 * selections from a stored task request.
 */
export function useConcordanceParameters() {
  const [parameterState, dispatchParameters] = useReducer(
    concordanceParameterReducer,
    createConcordanceParameterState(),
  );
  const {
    searchWord,
    numLeftTokens,
    numRightTokens,
    regex,
    wholeWord,
    caseSensitive,
    ignorePunctuation,
  } = parameterState;

  /**
   * Updates the search phrase while preserving the React set-state signature
   * expected by the panel and token-frequency handoff.
   * Called by: ConcordanceParameterPanel and saved-request hydration.
   */
  const setSearchWord: Dispatch<SetStateAction<string>> = (value) => {
    dispatchParameters({ type: 'setSearchWord', value });
  };

  const setNumLeftTokens: Dispatch<SetStateAction<number>> = (value) => {
    dispatchParameters({ type: 'setNumLeftTokens', value });
  };

  const setNumRightTokens: Dispatch<SetStateAction<number>> = (value) => {
    dispatchParameters({ type: 'setNumRightTokens', value });
  };

  const setRegex: Dispatch<SetStateAction<boolean>> = (value) => {
    dispatchParameters({ type: 'setRegex', value });
  };

  const setWholeWord: Dispatch<SetStateAction<boolean>> = (value) => {
    dispatchParameters({ type: 'setWholeWord', value });
  };

  const setCaseSensitive: Dispatch<SetStateAction<boolean>> = (value) => {
    dispatchParameters({ type: 'setCaseSensitive', value });
  };

  const setIgnorePunctuation: Dispatch<SetStateAction<boolean>> = (value) => {
    dispatchParameters({ type: 'setIgnorePunctuation', value });
  };

  const currentParams: ConcordanceRequestParams = {
    search_word: searchWord,
    num_left_tokens: numLeftTokens,
    num_right_tokens: numRightTokens,
    regex,
    whole_word: wholeWord,
    case_sensitive: caseSensitive,
    ignore_punctuation: ignorePunctuation,
  };

  /**
   * Restores search controls and returns the node/column selections embedded in
   * a saved request.
   * Called by: ConcordanceFeature's `useAnalysisFeature` request hydration
   * callback before it projects the saved Result.
   */
  const applyHydratedRequest = (request: Record<string, unknown>): ConcordanceInputSelection[] => {
    const nodeIds = Array.isArray(request.node_ids)
      ? request.node_ids
          .slice(0, 2)
          .filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const nodeColumns =
      request.node_columns && typeof request.node_columns === 'object'
        ? (request.node_columns as Record<string, unknown>)
        : {};

    const hydratedParams = readConcordanceServerParams(request);
    dispatchParameters({ type: 'hydrateParams', params: hydratedParams });

    return nodeIds.map((nodeId) => ({
      nodeId,
      column: typeof nodeColumns[nodeId] === 'string' ? nodeColumns[nodeId] : '',
    }));
  };

  return {
    searchWord,
    setSearchWord,
    numLeftTokens,
    setNumLeftTokens,
    numRightTokens,
    setNumRightTokens,
    regex,
    setRegex,
    wholeWord,
    setWholeWord,
    caseSensitive,
    setCaseSensitive,
    ignorePunctuation,
    setIgnorePunctuation,
    currentParams,
    applyHydratedRequest,
  };
}
