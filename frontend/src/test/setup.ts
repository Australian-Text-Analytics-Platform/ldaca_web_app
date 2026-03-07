import '@testing-library/jest-dom/vitest';
import { enableMapSet } from 'immer';

enableMapSet();

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
