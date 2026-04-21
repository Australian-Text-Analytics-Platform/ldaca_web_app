import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { enableMapSet } from 'immer';

enableMapSet();

// vitest is not configured with globals:true, so @testing-library/react's
// automatic DOM cleanup is not wired up. Register it explicitly so state from
// one test doesn't leak into the next.
afterEach(() => {
  cleanup();
});

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
