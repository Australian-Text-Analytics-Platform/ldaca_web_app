interface Props {
  matchedTexts: string[];
  matchedTextColors: Record<string, string>;
  hiddenMatchedTexts: Set<string>;
  onToggle: (text: string) => void;
  /**
   * Per-matched-text total count across the *full* displayed graph.
   * Pre-computed by the caller; the legend renders
   * ``(n)`` after each label in the same colour/style.
   *
   * Hidden items keep their number; toggling visibility doesn't
   * recompute to zero so the user always sees the underlying weight of
   * the filter they just turned off.
   */
  totals: ReadonlyMap<string, number>;
  /**
   * Per-matched-text count across just the user-selected bins, when a
   * selection is active. ``null`` / undefined → no selection, render
   * the plain ``(n)`` form. When non-null, render ``(m/n)`` where
   * ``m`` is the per-text selected count (0 is rendered as ``0``,
   * never collapsed) and ``n`` is the full-graph total.
   */
  selectedTotals?: ReadonlyMap<string, number> | null;
}

const DEFAULT_COLOR = '#0284c7';

/**
 * Rendered by: ConcordanceDispersionNodeBlock to show matched-text visibility controls and bin counts because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
export function ConcordanceDispersionLegend({
  matchedTexts,
  matchedTextColors,
  hiddenMatchedTexts,
  onToggle,
  totals,
  selectedTotals,
}: Props) {
  if (matchedTexts.length === 0) return null;
  const hasSelection = !!selectedTotals;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-2">
      {matchedTexts.map((text) => {
        const color = matchedTextColors[text] ?? DEFAULT_COLOR;
        const isHidden = hiddenMatchedTexts.has(text);
        const total = totals.get(text) ?? 0;
        const selected = selectedTotals?.get(text) ?? 0;
        const countSuffix = hasSelection
          ? ` (${String(selected)}/${String(total)})`
          : ` (${String(total)})`;
        return (
          <button
            key={text}
            type="button"
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-0.5 transition-opacity hover:bg-muted/60"
            style={{ opacity: isHidden ? 0.4 : 1 }}
            onClick={() => {
              onToggle(text);
            }}
            aria-pressed={!isHidden}
            aria-label={isHidden ? `Show ${text}` : `Hide ${text}`}
          >
            <div className="h-4 w-0.5 rounded-full" style={{ backgroundColor: color }} />
            <span
              className="text-sm font-medium text-muted-foreground"
              style={{ textDecoration: isHidden ? 'line-through' : 'none' }}
            >
              {text}
              {countSuffix}
            </span>
          </button>
        );
      })}
    </div>
  );
}
