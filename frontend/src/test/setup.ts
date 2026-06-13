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

global.ResizeObserver = class {
  /** Used by: tests in this file because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
  observe() {
    /* no-op mock */
  }
  /** Used by: tests in this file because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
  unobserve() {
    /* no-op mock */
  }
  /** Used by: tests in this file because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
  disconnect() {
    /* no-op mock */
  }
};
