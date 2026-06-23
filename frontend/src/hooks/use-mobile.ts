import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT = 768;

/** Reads the current mobile breakpoint state without subscribing. */
/** Called by: useIsMobile in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
const getIsMobile = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.matchMedia(`(max-width: ${String(MOBILE_BREAKPOINT - 1)}px)`).matches;
};

/** Tracks the app's mobile breakpoint for components that change interaction affordances. */
/**
 * Used by: src/components/ui/sidebar.tsx because the hook needs local steps to normalize inputs before exposing stable state to consumers.
 * Flow: seed state from matchMedia, subscribe with modern MediaQueryList change events, then update the sidebar-responsive boolean on breakpoint changes.
 */
export const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState<boolean>(() => getIsMobile());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mediaQuery = window.matchMedia(`(max-width: ${String(MOBILE_BREAKPOINT - 1)}px)`);

    /** Syncs state from the MediaQueryList for both modern and legacy listener APIs. */
    /** Used by: useIsMobile callback wiring in this module because the component or hook needs a named callback boundary for effect and prop handoff steps. */
    const handleChange = () => {
      setIsMobile(mediaQuery.matches);
    };

    handleChange();

    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return isMobile;
};
