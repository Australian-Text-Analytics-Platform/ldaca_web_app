import { describe, expect, it } from 'vitest';

import {
  closestIndex,
  computeContentTabWidths,
  computeTabPositions,
  computeTotalWidth,
  moveInOrder,
  TAB_MAX_WIDTH,
  TAB_MIN_WIDTH,
} from '../editorTabsLayout';

describe('editorTabsLayout', () => {
  describe('computeContentTabWidths', () => {
    it('returns no widths for an empty strip', () => {
      expect(computeContentTabWidths([])).toEqual([]);
    });

    it('hugs each title at its intrinsic width', () => {
      expect(computeContentTabWidths([80, 120])).toEqual([80, 120]);
    });

    it('caps an over-long title at the maximum width', () => {
      expect(computeContentTabWidths([400, 70])).toEqual([TAB_MAX_WIDTH, 70]);
    });

    it('floors short titles at the minimum width', () => {
      expect(computeContentTabWidths([20, 30])).toEqual([TAB_MIN_WIDTH, TAB_MIN_WIDTH]);
    });

    it('preserves readable widths when the strip must scroll', () => {
      expect(computeContentTabWidths([180, 180, 180])).toEqual([180, 180, 180]);
    });
  });

  describe('computeTabPositions', () => {
    it('accumulates contiguous left offsets', () => {
      expect(computeTabPositions([100, 80, 60])).toEqual([0, 100, 180]);
    });
  });

  describe('computeTotalWidth', () => {
    it('is zero for an empty strip', () => {
      expect(computeTotalWidth([])).toBe(0);
    });

    it('sums the contiguous tab widths', () => {
      expect(computeTotalWidth([100, 80])).toBe(180);
    });
  });

  describe('closestIndex', () => {
    it('finds the slot nearest the dragged tab edge', () => {
      const positions = [0, 100, 200];
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
