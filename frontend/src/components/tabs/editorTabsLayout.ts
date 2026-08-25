/**
 * Pure layout maths for the editor tab strip, based on the interaction model in
 * adamschwartz/chrome-tabs (MIT). Kept framework-free so the geometry can be
 * unit-tested without a DOM and reused by ``EditorTabs`` for both render
 * positioning and drag hit-testing.
 *
 * Model: every tab is absolutely positioned and moved with ``translateX``. Tabs
 * keep their intrinsic width within readable min/max bounds and use the strip's
 * horizontal overflow when the row is wider than its container. The dragged
 * tab follows the pointer while the rest slide to the slot positions these
 * helpers compute.
 */

/** VS Code keeps adjacent tab hit targets contiguous. */
const TAB_GAP = 0;
/** Smallest a tab may shrink to when many are open. */
export const TAB_MIN_WIDTH = 50;
/** Largest a tab grows before its title tail fades. */
export const TAB_MAX_WIDTH = 320;

/** Computes intrinsic tab widths; the containing strip owns horizontal overflow. */
export function computeContentTabWidths(naturalWidths: number[]): number[] {
  return naturalWidths.map((natural) =>
    Math.floor(Math.max(TAB_MIN_WIDTH, Math.min(TAB_MAX_WIDTH, natural))),
  );
}

/** Computes the contiguous left offset of each tab from a width list. */
export function computeTabPositions(widths: number[]): number[] {
  const positions: number[] = [];
  let offset = 0;
  for (const width of widths) {
    positions.push(offset);
    offset += width + TAB_GAP;
  }
  return positions;
}

/** Returns the total width occupied by the tab row. */
export function computeTotalWidth(widths: number[]): number {
  if (widths.length === 0) return 0;
  const sum = widths.reduce((total, width) => total + width, 0);
  return sum + TAB_GAP * (widths.length - 1);
}

/** Returns the slot nearest the dragged tab's current left edge. */
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

/** Immutably moves an item to another slot in the tab order. */
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
