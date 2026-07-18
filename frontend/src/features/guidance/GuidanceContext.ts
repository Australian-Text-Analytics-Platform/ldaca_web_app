import { createContext, useContext } from 'react';

export interface GuidanceContextValue {
  requestContextualHint: (id: string) => void;
  startGuidedTour: (id: string) => void;
}

export const GuidanceContext = createContext<GuidanceContextValue | null>(null);

export function useGuidance() {
  const context = useContext(GuidanceContext);
  if (!context) {
    throw new Error('useGuidance must be used within GuidanceProvider');
  }
  return context;
}
