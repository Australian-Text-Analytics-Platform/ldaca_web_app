export const CONCORDANCE_DISPERSION_READ_ONLY_REASON =
  'This action is unavailable while results are read-only.';

interface VisibleMatchedTextsInput {
  colourMatches: boolean;
  allMatchedTexts: string[];
  hiddenMatchedTexts: ReadonlySet<string>;
}

interface DispersionDetachActionInput extends VisibleMatchedTextsInput {
  readOnly: boolean;
  isBusy: boolean;
  hasSearchWord: boolean;
  hasDetachTarget: boolean;
  hasSelection: boolean;
  hasMaterializedBins: boolean;
  materializeSelectionHint: string;
  selectedBinsHint: string;
  allHitsHint: string;
}

export interface DispersionDetachActionState {
  disabled: boolean;
  title: string;
  visibleMatchedTexts: string[] | null;
  scopeMismatch: boolean;
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
 * Flow: derive visible legend terms, block selected-bin detaches until bins are
 * materialized for whole-corpus scope, block all-hidden legends, then apply the
 * shared busy/read-only/search/target gates.
 */
export function buildDispersionDetachActionState({
  readOnly,
  isBusy,
  hasSearchWord,
  hasDetachTarget,
  hasSelection,
  hasMaterializedBins,
  colourMatches,
  allMatchedTexts,
  hiddenMatchedTexts,
  materializeSelectionHint,
  selectedBinsHint,
  allHitsHint,
}: DispersionDetachActionInput): DispersionDetachActionState {
  const visibleMatchedTexts = getVisibleMatchedTexts({
    colourMatches,
    allMatchedTexts,
    hiddenMatchedTexts,
  });
  const scopeMismatch = hasSelection && !hasMaterializedBins;
  const allLegendHidden =
    visibleMatchedTexts !== null && allMatchedTexts.length > 0 && visibleMatchedTexts.length === 0;
  const disabled =
    readOnly || isBusy || !hasSearchWord || !hasDetachTarget || scopeMismatch || allLegendHidden;
  const title = readOnly
    ? CONCORDANCE_DISPERSION_READ_ONLY_REASON
    : scopeMismatch
      ? materializeSelectionHint
      : allLegendHidden
        ? 'All matched terms are hidden in the legend. Re-enable at least one to detach.'
        : hasSelection
          ? selectedBinsHint
          : allHitsHint;

  return {
    disabled,
    title,
    visibleMatchedTexts,
    scopeMismatch,
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
