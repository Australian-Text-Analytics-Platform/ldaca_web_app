/**
 * Take the N most recently selected items from an ordered selection array.
 *
 * Selection arrays are ordered chronologically: the earliest selection is at
 * index 0 and the most recent selection is at the end. When more items are
 * selected than a feature allows, this helper keeps the *most recent* ones.
 */
export function takeMostRecent<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return items.slice(-max);
}
