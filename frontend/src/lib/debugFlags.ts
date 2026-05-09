/**
 * Centralised opt-in debug flags.
 *
 * Each flag is checked via localStorage so it can be toggled without rebuild
 * (`localStorage.setItem('debugGraph', '1')` from devtools).
 */

export const DEBUG_GRAPH_KEY = 'debugGraph';

/** True when graph-related verbose logging has been opted into. */
export const isGraphDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    if ((window as Window & { __LDACA_DEBUG_GRAPH?: boolean }).__LDACA_DEBUG_GRAPH) {
      return true;
    }
    return window.localStorage.getItem(DEBUG_GRAPH_KEY) === '1';
  } catch {
    return false;
  }
};
