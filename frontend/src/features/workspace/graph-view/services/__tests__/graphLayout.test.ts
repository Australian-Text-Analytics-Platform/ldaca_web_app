import { describe, expect, it } from 'vitest';

import { computeDagreLayout } from '../graphLayout';

describe('computeDagreLayout', () => {
  it('left-aligns every root (no incoming edge), even when chain lengths differ', () => {
    // Before the super-source fix, dagre's longest-path normalisation
    // pushed the short-chain root (``isolated``) and the no-children root
    // to the *right* edge while the long-chain root (``a``) sat at the
    // left. Now they should share one minimum x.
    const nodes = [
      { id: 'a' }, // root, has a 3-node chain
      { id: 'b' },
      { id: 'c' },
      { id: 'short' }, // root, single child
      { id: 'short-child' },
      { id: 'isolated' }, // root, no descendants
    ];
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'short', target: 'short-child' },
    ];

    const positions = computeDagreLayout(nodes, edges, { rankdir: 'LR' });

    const rootXs = ['a', 'short', 'isolated'].map((id) => positions.get(id)?.x);
    expect(rootXs.every((x) => typeof x === 'number')).toBe(true);
    const [xA, xShort, xIsolated] = rootXs as number[];
    expect(xShort).toBe(xA);
    expect(xIsolated).toBe(xA);
  });

  it('never leaks the synthetic super-source into the returned positions', () => {
    const positions = computeDagreLayout(
      [{ id: 'only' }],
      [],
      { rankdir: 'LR' },
    );
    expect(positions.size).toBe(1);
    expect(positions.has('only')).toBe(true);
    for (const key of positions.keys()) {
      expect(key.startsWith('__dagre_')).toBe(false);
    }
  });

  it('returns an empty map for an empty graph', () => {
    const positions = computeDagreLayout([], [], { rankdir: 'LR' });
    expect(positions.size).toBe(0);
  });
});
