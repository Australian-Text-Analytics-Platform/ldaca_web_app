import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountThemeSynchronizer } from '../AccountThemeSynchronizer';
import { applyColorTheme, getActiveTheme } from '../themeRuntime';

const state = vi.hoisted(() => ({ isSuccess: false, colorTheme: 'light-2026' }));

vi.mock('@/features/preferences/useUserPreferences', () => ({
  useUserPreferences: () => ({
    data: { color_theme: state.colorTheme },
    isSuccess: state.isSuccess,
  }),
}));

describe('AccountThemeSynchronizer', () => {
  beforeEach(() => {
    state.isSuccess = false;
    state.colorTheme = 'light-2026';
    applyColorTheme('dark-2026');
  });

  it('retains the startup cache until the preference query succeeds', () => {
    const view = render(<AccountThemeSynchronizer />);
    expect(getActiveTheme()).toBe('dark-2026');

    state.isSuccess = true;
    state.colorTheme = 'light-2026';
    view.rerender(<AccountThemeSynchronizer />);
    expect(getActiveTheme()).toBe('light-2026');
  });
});
