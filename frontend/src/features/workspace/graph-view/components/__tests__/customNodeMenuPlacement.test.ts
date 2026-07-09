import { describe, expect, it, vi } from 'vitest';

import { computeMenuPlacement } from '../customNodeMenuPlacement';

const rect = ({
  top,
  right,
  bottom,
  left,
}: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}): DOMRect => ({
  top,
  right,
  bottom,
  left,
  x: left,
  y: top,
  width: right - left,
  height: bottom - top,
  toJSON: () => ({}),
});

const elementWithRect = (bounds: DOMRect): HTMLElement => {
  const element = document.createElement('button');
  element.getBoundingClientRect = vi.fn(() => bounds);
  return element;
};

describe('computeMenuPlacement', () => {
  it('uses the default downward and leftward expansion when there is room', () => {
    const pane = elementWithRect(rect({ top: 0, right: 500, bottom: 500, left: 0 }));
    const trigger = elementWithRect(rect({ top: 100, right: 332, bottom: 132, left: 300 }));
    trigger.closest = vi.fn(() => pane);

    expect(computeMenuPlacement(trigger)).toEqual({ opensUp: false, opensRight: false });
  });

  it('flips upward and rightward near the graph bottom-left edge', () => {
    const pane = elementWithRect(rect({ top: 0, right: 500, bottom: 500, left: 0 }));
    const trigger = elementWithRect(rect({ top: 460, right: 42, bottom: 492, left: 10 }));
    trigger.closest = vi.fn(() => pane);

    expect(computeMenuPlacement(trigger)).toEqual({ opensUp: true, opensRight: true });
  });
});
