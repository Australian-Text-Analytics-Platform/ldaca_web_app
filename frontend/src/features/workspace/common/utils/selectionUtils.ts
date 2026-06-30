/**
 * Take the N most recently selected items from an ordered selection array.
 *
 * Selection arrays are ordered chronologically: the earliest selection is at
 * index 0 and the most recent selection is at the end. When more items are
 * selected than a feature allows, this helper keeps the *most recent* ones.
 */
/** Used by: src/features/views/concordance/components/ConcordanceDispersionNodeBlock.tsx, src/features/views/concordance/components/ConcordanceTableNodeBlock.tsx, src/features/views/quotation/QuotationFeature.tsx and other importers because the utility needs local normalization steps before returning a shared result. */
export function takeMostRecent<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return items.slice(-max);
}

/**
 * Remove duplicate node ids from a selection while preserving first-seen order.
 *
 * Used by multi-node preprocessing sub-tabs (concat/join) where the upstream
 * selection store can briefly contain repeats during reordering.
 * Why: importers need one shared normalization boundary to keep behavior consistent.
 */
export const dedupeNodeIds = (nodeIds: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of nodeIds) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
};
