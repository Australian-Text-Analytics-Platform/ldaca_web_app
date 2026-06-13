import { describe, expect, it } from 'vitest';

import {
  TAB_GAP,
  TAB_MAX_WIDTH,
  TAB_MIN_WIDTH,
  closestIndex,
  computeContentTabWidths,
  computeTabPositions,
  computeTotalWidth,
  moveInOrder,
} from '../chromeTabsLayout';

describe('chromeTabsLayout', () => {
  describe('computeContentTabWidths', () => {
    it('returns no widths for an empty strip', () => {
      expect(computeContentTabWidths([], 400)).toEqual([]);
    });

    it('hugs each title when there is ample room', () => {
      const widths = computeContentTabWidths([80, 120], 2000);
      expect(widths).toEqual([80, 120]);
    });

    it('caps an over-long title at the maximum width', () => {
      const widths = computeContentTabWidths([400, 70], 2000);
      expect(widths).toEqual([TAB_MAX_WIDTH, 70]);
    });

    it('floors short titles at the minimum width', () => {
      const widths = computeContentTabWidths([20, 30], 2000);
      expect(widths).toEqual([TAB_MIN_WIDTH, TAB_MIN_WIDTH]);
    });

    it('shrinks tabs uniformly toward the equal share when the strip is crowded', () => {
      // Three wide titles in a narrow strip: each is capped to the equal share.
      const widths = computeContentTabWidths([180, 180, 180], 300);
      const totalGap = TAB_GAP * 2;
      const expected = Math.floor((300 - totalGap) / 3);
      expect(widths).toEqual([expected, expected, expected]);
    });
  });

  describe('computeTabPositions', () => {
    it('accumulates left offsets with a gap between tabs', () => {
      expect(computeTabPositions([100, 80, 60])).toEqual([
        0,
        100 + TAB_GAP,
        100 + TAB_GAP + 80 + TAB_GAP,
      ]);
    });
  });

  describe('computeTotalWidth', () => {
    it('is zero for an empty strip', () => {
      expect(computeTotalWidth([])).toBe(0);
    });

    it('sums widths plus the gaps between them', () => {
      expect(computeTotalWidth([100, 80])).toBe(100 + 80 + TAB_GAP);
    });
  });

  describe('closestIndex', () => {
    it('finds the slot nearest the dragged tab edge', () => {
      const positions = [0, 104, 208];
      expect(closestIndex(0, positions)).toBe(0);
      expect(closestIndex(110, positions)).toBe(1);
      expect(closestIndex(260, positions)).toBe(2);
    });
  });

  describe('moveInOrder', () => {
    it('moves an item forward to a new slot', () => {
      expect(moveInOrder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    });

    it('moves an item backward to a new slot', () => {
      expect(moveInOrder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    });

    it('returns the same array when indices are equal or out of range', () => {
      const order = ['a', 'b', 'c'];
      expect(moveInOrder(order, 1, 1)).toBe(order);
      expect(moveInOrder(order, -1, 2)).toBe(order);
      expect(moveInOrder(order, 0, 5)).toBe(order);
    });
  });
});
