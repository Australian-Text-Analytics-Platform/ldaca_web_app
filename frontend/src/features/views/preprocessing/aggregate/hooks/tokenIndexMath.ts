/**
 * Pure index-arithmetic helpers for the aggregate sub-tab's token builder.
 *
 * Lifted out of `useAggregateSubTab.ts` so the splice + clamp logic can be
 * unit-tested in isolation. The operations are subtle: `moveItemTo` has to
 * apply the post-removal adjustment when the destination index sits after
 * the source, otherwise the moved item lands one slot too far to the left.
 */

/**
 * Clamp `value` into `[0, max]`. NaN and out-of-range values fall back to `max`.
 * Used by the helpers below to clamp drag-and-drop insertion indexes.
 */
export const clampIndex = (value: number, max: number): number => {
  if (Number.isNaN(value)) return max;
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
};

/**
 * Insert `item` into a copy of `items` at `targetIndex`, clamped to
 * `[0, items.length]`. `undefined` for `targetIndex` appends.
 * Used by `useAggregateSubTab` when adding builder tokens.
 */
export const insertItemAt = <T>(
  items: readonly T[],
  targetIndex: number | undefined,
  item: T,
): T[] => {
  const next = [...items];
  const idx = clampIndex(targetIndex ?? next.length, next.length);
  next.splice(idx, 0, item);
  return next;
};

/**
 * Remove the entry at `index`. Out-of-range indexes return the array
 * unchanged.
 * Used by `useAggregateSubTab` when removing builder tokens and operations.
 */
export const removeItemAt = <T>(items: readonly T[], index: number): T[] => {
  if (index < 0 || index >= items.length) return [...items];
  const next = [...items];
  next.splice(index, 1);
  return next;
};

/**
 * Move an item from `fromIndex` to `toIndex`. Returns the original array
 * (same reference allowed) when the move is a no-op or out-of-range.
 *
 * `toIndex` is interpreted as the *insertion slot in the array after the
 * source item has been removed*. When `fromIndex < toIndex` we therefore
 * decrement `toIndex` by one — without that adjustment, the moved item
 * would land one slot too far to the left.
 * Used by `useAggregateSubTab` when reordering builder tokens.
 * Steps: reject invalid moves, remove the source item, adjust the post-removal target, and
 * reinsert only when the order changes.
 */
export const moveItemTo = <T>(items: readonly T[], fromIndex: number, toIndex: number): T[] => {
  if (fromIndex < 0 || fromIndex >= items.length) return [...items];

  const arr = [...items];
  const [item] = arr.splice(fromIndex, 1) as [T];
  let target = clampIndex(toIndex, arr.length + 1);
  if (fromIndex < target) {
    target -= 1;
  }
  if (target === fromIndex) {
    return [...items];
  }
  arr.splice(target, 0, item);
  return arr;
};
