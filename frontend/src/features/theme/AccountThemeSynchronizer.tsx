import { useEffect } from 'react';

import { useUserPreferences } from '@/features/preferences/useUserPreferences';
import { applyColorTheme, isColorTheme } from './themeRuntime';

/** Reconciles the flicker-free local bootstrap theme with the account authority. */
export function AccountThemeSynchronizer() {
  const { data: preferences, isSuccess } = useUserPreferences();

  useEffect(() => {
    if (isSuccess && isColorTheme(preferences?.color_theme)) {
      applyColorTheme(preferences.color_theme);
    }
  }, [isSuccess, preferences?.color_theme]);

  return null;
}
