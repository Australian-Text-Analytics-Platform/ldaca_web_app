import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
// Vitest is configured without globals, so Testing Library cannot register its
// automatic cleanup hook. Keep the explicit teardown to prevent DOM leakage
// between tests.
// eslint-disable-next-line testing-library/no-manual-cleanup
import { cleanup } from '@testing-library/react';
import { enableMapSet } from 'immer';

import { server } from './msw/server';

enableMapSet();

// Node 25 exposes an incomplete process-level localStorage unless a backing
// file is configured. Bind the global name to jsdom's real Storage instance so
// StorageEvent validation and Storage.prototype spies retain browser semantics.
const storageDom = new JSDOM('', { url: 'http://localhost/' });
const browserLocalStorage = storageDom.window.localStorage;
Object.defineProperty(globalThis, 'Storage', {
  configurable: true,
  value: storageDom.window.Storage,
});
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: browserLocalStorage,
});

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
  storageDom.window.close();
});

// jsdom has no layout engine and therefore no scrollIntoView. Components that
// keep a keyboard-highlighted row in view (searchable selects, long lists) call
// it during normal interaction, so provide an inert stand-in.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    /* no-op mock */
  };
}

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
