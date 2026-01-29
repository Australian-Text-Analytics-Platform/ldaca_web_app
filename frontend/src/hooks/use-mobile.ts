import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT = 768;

const getIsMobile = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
};

export const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState<boolean>(() => getIsMobile());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

    const handleChange = () => {
      setIsMobile(mediaQuery.matches);
    };

    handleChange();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return isMobile;
};