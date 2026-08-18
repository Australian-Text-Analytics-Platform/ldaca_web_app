import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as XYFlowReact from '@xyflow/react';

import { TopicLassoCanvas } from '../TopicModelingFlowChart';
import type { TopicBubbleModel } from '../topicModelingGraph';

vi.mock('@xyflow/react', async (importOriginal) => {
  const original = await importOriginal<typeof XYFlowReact>();
  return {
    ...original,
    useReactFlow: () => ({
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    }),
  };
});

const bubble: TopicBubbleModel = {
  id: 7,
  topic: {
    id: 7,
    representative_words: [{ word: 'topic', occurrence_count: 1 }],
    size: [1],
    total_size: 1,
    x: 0,
    y: 0,
  },
  position: { x: 50, y: 50 },
  radius: 20,
  fill: '#2563eb',
  selected: false,
  lassoed: false,
  hovered: false,
  filteredOut: false,
};

describe('TopicLassoCanvas', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  it('commits a normal release outside the canvas using the latest freehand path', () => {
    const onComplete = vi.fn();
    render(<TopicLassoCanvas enabled bubbles={[bubble]} onComplete={onComplete} />);
    const canvas = screen.getByLabelText('Draw an additive lasso around topic bubbles');

    fireEvent.pointerDown(canvas, { pointerId: 4, button: 0, clientX: 35, clientY: 35 });
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 65, clientY: 35 });
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 65, clientY: 65 });
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 35, clientY: 65 });

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(new Set([7]));
  });

  it('discards cancelled gestures without changing the filter', () => {
    const onComplete = vi.fn();
    render(<TopicLassoCanvas enabled bubbles={[bubble]} onComplete={onComplete} />);
    const canvas = screen.getByLabelText('Draw an additive lasso around topic bubbles');

    fireEvent.pointerDown(canvas, { pointerId: 9, button: 0, clientX: 35, clientY: 35 });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 65, clientY: 35 });
    fireEvent.pointerCancel(window, { pointerId: 9 });
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 65, clientY: 65 });

    expect(onComplete).not.toHaveBeenCalled();
  });
});
