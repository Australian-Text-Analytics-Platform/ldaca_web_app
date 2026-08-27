export interface CaseFoldedSeriesVisibility<Key> {
  uncased: boolean;
  excludedKeys: Set<Key>;
}

export type CaseFoldedSeriesVisibilityAction<Key> =
  | { type: 'toggle-members'; keys: readonly Key[] }
  | { type: 'set-uncased'; value: boolean }
  | { type: 'reset' };

export function createCaseFoldedSeriesVisibility<Key>(): CaseFoldedSeriesVisibility<Key> {
  return { uncased: false, excludedKeys: new Set<Key>() };
}

/** Applies the shared exact-member visibility contract used by case-folded legends. */
export function reduceCaseFoldedSeriesVisibility<Key>(
  state: CaseFoldedSeriesVisibility<Key>,
  action: CaseFoldedSeriesVisibilityAction<Key>,
): CaseFoldedSeriesVisibility<Key> {
  if (action.type === 'reset') return createCaseFoldedSeriesVisibility<Key>();
  if (action.type === 'set-uncased') {
    if (action.value === state.uncased) return state;
    return { uncased: action.value, excludedKeys: new Set<Key>() };
  }

  const excludedKeys = new Set(state.excludedKeys);
  const restore = action.keys.every((key) => excludedKeys.has(key));
  for (const key of action.keys) {
    if (restore) excludedKeys.delete(key);
    else excludedKeys.add(key);
  }
  return { ...state, excludedKeys };
}
