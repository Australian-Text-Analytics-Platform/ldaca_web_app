interface VisibleMatchedTextsInput {
  colourMatches: boolean;
  allMatchedTexts: string[];
  hiddenMatchedTexts: ReadonlySet<string>;
}

interface DispersionDetachActionInput extends VisibleMatchedTextsInput {
  isBusy: boolean;
  hasSearchWord: boolean;
  hasDetachTarget: boolean;
  hasSelection: boolean;
  selectedBinsHint: string;
  allHitsHint: string;
}

export interface DispersionDetachActionState {
  disabled: boolean;
  title: string;
  visibleMatchedTexts: string[] | null;
  allLegendHidden: boolean;
}

/** Returns the matched terms that should be included in a dispersion detach request. */
/**
 * Used by: combined and per-node dispersion detach buttons so legend filtering
 * maps to one backend option shape in both result modes.
 */
export function getVisibleMatchedTexts({
  colourMatches,
  allMatchedTexts,
  hiddenMatchedTexts,
}: VisibleMatchedTextsInput): string[] | null {
  if (!colourMatches) {
    return null;
  }
  return allMatchedTexts.filter((text) => !hiddenMatchedTexts.has(text));
}

/**
 * Builds the disabled/title state for Add to Workspace dispersion actions.
 * Used by: ConcordanceDispersionNodeBlock's combined and per-node branches.
 * Flow: derive visible legend terms, block all-hidden legends, then apply the
 * shared busy/search/target gates.
 */
export function buildDispersionDetachActionState({
  isBusy,
  hasSearchWord,
  hasDetachTarget,
  hasSelection,
  colourMatches,
  allMatchedTexts,
  hiddenMatchedTexts,
  selectedBinsHint,
  allHitsHint,
}: DispersionDetachActionInput): DispersionDetachActionState {
  const visibleMatchedTexts = getVisibleMatchedTexts({
    colourMatches,
    allMatchedTexts,
    hiddenMatchedTexts,
  });
  const allLegendHidden =
    visibleMatchedTexts !== null && allMatchedTexts.length > 0 && visibleMatchedTexts.length === 0;
  const disabled = isBusy || !hasSearchWord || !hasDetachTarget || allLegendHidden;
  const title = allLegendHidden
    ? 'All matched terms are hidden in the legend. Re-enable at least one to detach.'
    : hasSelection
      ? selectedBinsHint
      : allHitsHint;

  return {
    disabled,
    title,
    visibleMatchedTexts,
    allLegendHidden,
  };
}

/**
 * Toggles one matched term in the hidden-legend set without mutating caller state.
 * Used by: both dispersion legends because the combined and per-node branches
 * share the same hidden-term reducer behavior.
 */
export function toggleHiddenMatchedText(
  hiddenMatchedTexts: ReadonlySet<string>,
  text: string,
): Set<string> {
  const next = new Set(hiddenMatchedTexts);
  if (next.has(text)) {
    next.delete(text);
  } else {
    next.add(text);
  }
  return next;
}
