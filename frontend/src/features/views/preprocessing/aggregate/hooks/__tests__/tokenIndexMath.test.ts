import { describe, expect, it } from 'vitest';

import { clampIndex, insertItemAt, moveItemTo, removeItemAt } from '../tokenIndexMath';

describe('clampIndex', () => {
  it('returns the value when it falls inside [0, max]', () => {
    expect(clampIndex(0, 5)).toBe(0);
    expect(clampIndex(3, 5)).toBe(3);
    expect(clampIndex(5, 5)).toBe(5);
  });

  it('clamps negative values to 0', () => {
    expect(clampIndex(-1, 5)).toBe(0);
    expect(clampIndex(-100, 5)).toBe(0);
  });

  it('clamps values above max to max', () => {
    expect(clampIndex(6, 5)).toBe(5);
    expect(clampIndex(100, 5)).toBe(5);
  });

  it('falls back to max for NaN inputs (typical when index? is read from a malformed event)', () => {
    expect(clampIndex(NaN, 7)).toBe(7);
  });
});

describe('insertItemAt', () => {
  it('appends when targetIndex is undefined', () => {
    expect(insertItemAt(['a', 'b', 'c'], undefined, 'd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('inserts at the beginning when targetIndex is 0', () => {
    expect(insertItemAt(['a', 'b'], 0, 'X')).toEqual(['X', 'a', 'b']);
  });

  it('inserts in the middle at the given slot', () => {
    expect(insertItemAt(['a', 'b', 'c'], 1, 'X')).toEqual(['a', 'X', 'b', 'c']);
  });

  it('clamps a negative target to the beginning', () => {
    expect(insertItemAt(['a', 'b'], -5, 'X')).toEqual(['X', 'a', 'b']);
  });

  it('clamps an out-of-range target to the end', () => {
    expect(insertItemAt(['a', 'b'], 999, 'X')).toEqual(['a', 'b', 'X']);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c'];
    const out = insertItemAt(input, 1, 'X');
    expect(input).toEqual(['a', 'b', 'c']);
    expect(out).not.toBe(input);
  });
});

describe('removeItemAt', () => {
  it('removes the entry at the given index', () => {
    expect(removeItemAt(['a', 'b', 'c'], 0)).toEqual(['b', 'c']);
    expect(removeItemAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
    expect(removeItemAt(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
  });

  it('returns a copy unchanged for out-of-range indexes', () => {
    const input = ['a', 'b'];
    expect(removeItemAt(input, -1)).toEqual(['a', 'b']);
    expect(removeItemAt(input, 5)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c'];
    const out = removeItemAt(input, 1);
    expect(input).toEqual(['a', 'b', 'c']);
    expect(out).not.toBe(input);
  });
});

describe('moveItemTo', () => {
  // The post-removal adjustment is the subtle part: when fromIndex < toIndex,
  // toIndex is interpreted as the slot in the array AFTER the source has been
  // removed, so we have to decrement by one.

  describe('forward moves (fromIndex < toIndex)', () => {
    it('moves an early item one slot later when toIndex equals length', () => {
      // ['a','b','c','d'], move 'a' (idx 0) to "after the end" (idx 4) → ['b','c','d','a']
      expect(moveItemTo(['a', 'b', 'c', 'd'], 0, 4)).toEqual(['b', 'c', 'd', 'a']);
    });

    it('moves an item past the next neighbour (the "land 1 slot too far left" trap)', () => {
      // Without the adjustment, moving 'a' to index 2 in ['a','b','c','d']
      // would yield ['b','a','c','d']. With the adjustment it yields
      // ['b','a','c','d'] still — let's pick a clearer example.
      // 'a' (idx 0) → index 3 in original means: insert at position 3 after
      // removing the source. After removal we have ['b','c','d']; target 3
      // becomes 2 (decremented), so 'a' lands at index 2: ['b','c','a','d'].
      expect(moveItemTo(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'a', 'd']);
    });

    it('moves a middle item one slot later', () => {
      // ['a','b','c','d'], move 'b' (idx 1) to index 3 → ['a','c','b','d']
      expect(moveItemTo(['a', 'b', 'c', 'd'], 1, 3)).toEqual(['a', 'c', 'b', 'd']);
    });
  });

  describe('backward moves (fromIndex > toIndex)', () => {
    it('moves a late item to the front', () => {
      // ['a','b','c','d'], move 'd' (idx 3) to index 0 → ['d','a','b','c']
      expect(moveItemTo(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    });

    it('moves a middle item one slot earlier', () => {
      // ['a','b','c','d'], move 'c' (idx 2) to index 1 → ['a','c','b','d']
      expect(moveItemTo(['a', 'b', 'c', 'd'], 2, 1)).toEqual(['a', 'c', 'b', 'd']);
    });
  });

  describe('no-op cases', () => {
    it('returns a copy of the input when from == to', () => {
      const input = ['a', 'b', 'c'];
      expect(moveItemTo(input, 1, 1)).toEqual(['a', 'b', 'c']);
    });

    it('returns a copy when forward move adjusts down to the same index (target == from + 1)', () => {
      // ['a','b','c'], move 'b' (idx 1) to index 2 → after removal target=1
      // (decremented from 2). target === fromIndex → no-op.
      expect(moveItemTo(['a', 'b', 'c'], 1, 2)).toEqual(['a', 'b', 'c']);
    });

    it('returns a copy when fromIndex is out of range', () => {
      const input = ['a', 'b'];
      expect(moveItemTo(input, -1, 0)).toEqual(['a', 'b']);
      expect(moveItemTo(input, 5, 0)).toEqual(['a', 'b']);
    });
  });

  describe('clamping', () => {
    it('clamps a negative target to 0', () => {
      // ['a','b','c'], move 'c' (idx 2) to negative → 0
      expect(moveItemTo(['a', 'b', 'c'], 2, -10)).toEqual(['c', 'a', 'b']);
    });

    it('clamps an excessive target to length', () => {
      // ['a','b','c'], move 'a' (idx 0) past the end → effectively last
      expect(moveItemTo(['a', 'b', 'c'], 0, 999)).toEqual(['b', 'c', 'a']);
    });
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c', 'd'];
    const out = moveItemTo(input, 0, 3);
    expect(input).toEqual(['a', 'b', 'c', 'd']);
    expect(out).not.toBe(input);
  });
});
