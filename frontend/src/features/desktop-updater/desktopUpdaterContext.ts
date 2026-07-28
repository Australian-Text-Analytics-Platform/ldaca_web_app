import { createContext, useContext } from 'react';

export type DesktopUpdaterStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'installing'
  | 'restarting'
  | 'error';

export interface DesktopUpdaterContextValue {
  status: DesktopUpdaterStatus;
  currentVersion: string | null;
  availableVersion: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
  checkNow: () => Promise<void>;
}

export const DesktopUpdaterContext = createContext<DesktopUpdaterContextValue | null>(null);

/** Returns the single app-wide desktop updater state and actions. */
export function useDesktopUpdater(): DesktopUpdaterContextValue {
  const context = useContext(DesktopUpdaterContext);
  if (!context) throw new Error('useDesktopUpdater must be used inside DesktopUpdaterProvider');
  return context;
}
