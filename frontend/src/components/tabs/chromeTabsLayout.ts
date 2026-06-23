/**
 * Pure layout maths for the Chrome-style tab strip, ported from the algorithm in
 * adamschwartz/chrome-tabs (MIT). Kept framework-free so the geometry can be
 * unit-tested without a DOM and reused by ``ChromeTabs`` for both render
 * positioning and drag hit-testing.
 *
 * Model: every tab is absolutely positioned and moved with ``translateX``. Tabs
 * share the available width equally, clamped to a max so a few tabs stay
 * readable and a min so many tabs still fit, with a small gap between them. The
 * dragged tab follows the pointer while the rest slide to the slot positions
 * these helpers compute — that is what produces the live "squeeze" reflow.
 *
 * Used by: ChromeTabs (width/position rendering + closest-slot drag target).
 */

/** Gap between adjacent tabs, in pixels. */
export const TAB_GAP = 4;
/** Smallest a tab may shrink to when many are open (keeps the close button usable). */
export const TAB_MIN_WIDTH = 56;
/** Largest a tab grows to (mirrors the previous ``max-w-48`` = 12rem = 192px cap). */
export const TAB_MAX_WIDTH = 192;

/**
 * Computes each tab's pixel width from its natural (content) width.
 * Called by: ChromeTabs render and drag math because both need identical widths.
 * Why content-based (not equal-share): per the project's tab design, a tab is
 * only as wide as its title needs, capped at ``TAB_MAX_WIDTH`` and floored at
 * ``TAB_MIN_WIDTH`` — so a short-titled tab stays compact instead of stretching.
 * Flow: derive the equal share each tab could claim if space ran out (the upper
 * bound that forces tabs to shrink uniformly when the strip is crowded), then
 * give every tab the smaller of its own clamped natural width and that share, so
 * tabs hug their content when there is room and shrink together when there isn't.
 */
export function computeContentTabWidths(naturalWidths: number[], containerWidth: number): number[] {
  const count = naturalWidths.length;
  if (count <= 0) return [];
  const totalGap = TAB_GAP * (count - 1);
  const equalShare = (containerWidth - totalGap) / count;
  const shrinkCap = Math.max(TAB_MIN_WIDTH, Math.min(TAB_MAX_WIDTH, equalShare));
  return naturalWidths.map((natural) => {
    const desired = Math.max(TAB_MIN_WIDTH, Math.min(TAB_MAX_WIDTH, natural));
    return Math.floor(Math.min(desired, shrinkCap));
  });
}

/**
 * Computes the left offset of each tab from a width list.
 * Called by: ChromeTabs to place tabs and to hit-test drag targets.
 * Flow: walk the widths accumulating each tab's start, advancing by width + gap.
 */
export function computeTabPositions(widths: number[]): number[] {
  const positions: number[] = [];
  let x = 0;
  for (const width of widths) {
    positions.push(x);
    x += width + TAB_GAP;
  }
  return positions;
}

/**
 * Total pixel width occupied by the tab row (used to size the strip + place the
 * trailing "+" button).
 * Called by: ChromeTabs layout.
 */
export function computeTotalWidth(widths: number[]): number {
  if (widths.length === 0) return 0;
  const sum = widths.reduce((total, width) => total + width, 0);
  return sum + TAB_GAP * (widths.length - 1);
}

/**
 * Returns the index of the slot position nearest ``value`` (the dragged tab's
 * current left edge), i.e. the slot the dragged tab should drop into.
 * Called by: ChromeTabs drag move handler.
 * Flow: linear scan keeping the smallest absolute distance — fine for the small
 * tab counts this strip handles.
 */
export function closestIndex(value: number, positions: number[]): number {
  let best = Number.POSITIVE_INFINITY;
  let bestIndex = 0;
  positions.forEach((position, index) => {
    const distance = Math.abs(value - position);
    if (distance < best) {
      best = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

/**
 * Immutably moves the item at ``fromIndex`` to ``toIndex`` within ``order``.
 * Called by: ChromeTabs drag move handler to live-reorder the preview order.
 * Flow: clone, splice the item out, splice it back in at the destination.
 */
export function moveInOrder(order: string[], fromIndex: number, toIndex: number): string[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= order.length ||
    toIndex >= order.length
  ) {
    return order;
  }
  const next = [...order];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return order;
  next.splice(toIndex, 0, moved);
  return next;
}
