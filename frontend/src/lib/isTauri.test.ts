import { afterEach, describe, expect, it } from 'vitest';

import { isTauri } from './isTauri';

describe('isTauri', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    Reflect.deleteProperty(window, '__TAURI__');
  });

  it('recognizes a reloaded native webview before Tauri globals are injected', () => {
    expect(isTauri(new URL('tauri://localhost'))).toBe(true);
    expect(isTauri(new URL('https://tauri.localhost'))).toBe(true);
  });

  it('does not classify ordinary browser localhost as Tauri', () => {
    expect(isTauri(new URL('http://localhost:3000'))).toBe(false);
  });
});
