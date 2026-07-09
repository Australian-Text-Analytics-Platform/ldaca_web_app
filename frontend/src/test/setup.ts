import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { enableMapSet } from 'immer';

import { server } from './msw/server';

enableMapSet();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

// vitest is not configured with globals:true, so @testing-library/react's
// automatic DOM cleanup is not wired up. Register it explicitly so state from
// one test doesn't leak into the next.
afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

const TEST_RESIZE_OBSERVER_WIDTH = 1024;
const TEST_RESIZE_OBSERVER_HEIGHT = 768;

global.ResizeObserver = class ResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  /**
   * Triggers a deterministic measurement for components such as Recharts
   * ResponsiveContainer. Used by: chart and resizable-layout tests because
   * jsdom has no layout engine, so a no-op observer leaves elements at -1/0
   * dimensions and produces noisy false warnings.
   */
  observe(target: Element) {
    const rect = target.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : TEST_RESIZE_OBSERVER_WIDTH;
    const height = rect.height > 0 ? rect.height : TEST_RESIZE_OBSERVER_HEIGHT;
    const contentRect: DOMRectReadOnly = {
      x: rect.x,
      y: rect.y,
      width,
      height,
      top: rect.top,
      right: rect.left + width,
      bottom: rect.top + height,
      left: rect.left,
      toJSON: () => ({
        x: rect.x,
        y: rect.y,
        width,
        height,
        top: rect.top,
        right: rect.left + width,
        bottom: rect.top + height,
        left: rect.left,
      }),
    };
    this.callback(
      [
        {
          target,
          contentRect,
        } as ResizeObserverEntry,
      ],
      this,
    );
  }
  /** Used by: tests in this file. */
  unobserve() {
    /* no-op mock */
  }
  /** Used by: tests in this file. */
  disconnect() {
    /* no-op mock */
  }
};
