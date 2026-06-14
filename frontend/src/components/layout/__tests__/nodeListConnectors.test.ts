import { describe, expect, it } from 'vitest';
import { computeConnectorLayout } from '../nodeListConnectors';

describe('computeConnectorLayout', () => {
  it('drops edges with missing endpoints and self-loops', () => {
    const layout = computeConnectorLayout(
      ['a', 'b'],
      [
        { source: 'a', target: 'missing' },
        { source: 'a', target: 'a' },
        { source: 'a', target: 'b' },
      ],
    );
    expect(layout.segments).toHaveLength(1);
    expect(layout.segments[0]).toMatchObject({ source: 'a', target: 'b', fromRow: 0, toRow: 1 });
  });

  it('keeps a continuous chain in a single lane', () => {
    const layout = computeConnectorLayout(
      ['a', 'b', 'c'],
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
    );
    expect(layout.laneCount).toBe(1);
    expect(layout.segments.every((segment) => segment.lane === 0)).toBe(true);
  });

  it('pushes crossing edges into separate lanes', () => {
    const layout = computeConnectorLayout(
      ['a', 'b', 'c', 'd'],
      [
        { source: 'a', target: 'c' },
        { source: 'b', target: 'd' },
      ],
    );
    expect(layout.laneCount).toBe(2);
    const lanes = layout.segments.map((segment) => segment.lane).sort();
    expect(lanes).toEqual([0, 1]);
  });

  it('routes edges sharing a target through one merged lane', () => {
    const layout = computeConnectorLayout(
      ['p1', 'p2', 'child'],
      [
        { source: 'p1', target: 'child' },
        { source: 'p2', target: 'child' },
      ],
    );
    // Both incoming edges converge, so their vertical lines overlap in one lane.
    expect(layout.laneCount).toBe(1);
    expect(layout.segments.every((segment) => segment.lane === 0)).toBe(true);
  });
});
