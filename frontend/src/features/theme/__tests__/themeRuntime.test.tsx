import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyColorTheme,
  DARK_THEME,
  getActiveTheme,
  LIGHT_THEME,
  startThemeStorageSync,
  THEME_STORAGE_KEY,
  useActiveTheme,
} from '../themeRuntime';

describe('theme runtime', () => {
  beforeEach(() => {
    localStorage.clear();
    applyColorTheme(LIGHT_THEME);
  });

  it('applies and publishes both supported themes to the root and startup cache', () => {
    const view = renderHook(() => useActiveTheme());

    act(() => applyColorTheme(DARK_THEME));

    expect(view.result.current).toBe(DARK_THEME);
    expect(getActiveTheme()).toBe(DARK_THEME);
    expect(document.documentElement.dataset.theme).toBe(DARK_THEME);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(DARK_THEME);
  });

  it('continues applying the account theme when startup storage is unavailable', () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage unavailable');
    });

    expect(() => applyColorTheme(DARK_THEME)).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe(DARK_THEME);
    storage.mockRestore();
  });

  it('accepts valid cross-window cache events and ignores invalid values', () => {
    const stop = startThemeStorageSync();
    window.dispatchEvent(
      new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: DARK_THEME }),
    );
    expect(getActiveTheme()).toBe(DARK_THEME);

    window.dispatchEvent(
      new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'system' }),
    );
    expect(getActiveTheme()).toBe(DARK_THEME);
    stop();
  });
});
