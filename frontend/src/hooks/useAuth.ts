import { useEffect, useCallback, useSyncExternalStore } from 'react';
import { AuthInfoResponse } from '../types';
// Migrated to modular API layer
import { authApi } from '../api/auth';

if (import.meta.env.DEV) {
  console.debug('[useAuth] module loaded', import.meta.url);
}

/**
 * Unified authentication hook that works with both single-user and multi-user modes.
 * Backend controls all auth logic via MULTI_USER environment variable.
 */
// ------------------------------------------------------------
// Global (module-level) singleton auth state to prevent the flood
// of /api/auth/ requests caused by multiple components invoking
// useAuth independently (and React 18 StrictMode double-mount).
// ------------------------------------------------------------
let globalAuthInfo: AuthInfoResponse | null = null;
let globalIsLoading = true;
let globalError: string | null = null;
let inFlight: Promise<void> | null = null;
let refreshIntervalId: number | null = null;
const listeners = new Set<() => void>();
const AUTH_INFO_TIMEOUT_MS = 7000;

type AuthSnapshot = {
  authInfo: AuthInfoResponse | null;
  isLoading: boolean;
  error: string | null;
};

let currentSnapshot: AuthSnapshot = {
  authInfo: globalAuthInfo,
  isLoading: globalIsLoading,
  error: globalError,
};

const computeSnapshot = (): AuthSnapshot => ({
  authInfo: globalAuthInfo,
  isLoading: globalIsLoading,
  error: globalError,
});

const updateSnapshot = () => {
  const nextSnapshot = computeSnapshot();
  if (
    nextSnapshot.authInfo === currentSnapshot.authInfo &&
    nextSnapshot.isLoading === currentSnapshot.isLoading &&
    nextSnapshot.error === currentSnapshot.error
  ) {
    return false;
  }
  currentSnapshot = nextSnapshot;
  return true;
};

export interface UseAuthOptions {
  /**
   * When false, the hook will wait for an explicit `refreshAuth` call
   * before making the initial /api/auth/ request.
   */
  autoStart?: boolean;
  /** Optional label for development logging */
  debugLabel?: string;
}

const readStoredToken = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem('auth_token');
  } catch {
    return null;
  }
};

const persistToken = (token: string | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem('auth_token', token);
    } else {
      window.localStorage.removeItem('auth_token');
    }
  } catch {
    // Ignore storage errors (Safari private mode, etc.)
  }
};

const buildAuthHeaders = (): Record<string, string> => {
  const token = readStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const notify = () => {
  const changed = updateSnapshot();
  if (!changed) {
    return;
  }
  listeners.forEach(l => {
    try { l(); } catch { /* ignore */ }
  });
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => currentSnapshot;

const fetchAuthInfoOnce = async () => {
  if (inFlight) return inFlight;
  globalIsLoading = true;
  globalError = null;
  notify();
  inFlight = (async () => {
    try {
      if (import.meta.env.DEV) {
        console.debug('[useAuth] fetching /api/auth/');
      }
      const info = await authApi.info(buildAuthHeaders(), { timeoutMs: AUTH_INFO_TIMEOUT_MS });
      globalAuthInfo = info;
      if (import.meta.env.DEV) {
        console.debug('[useAuth] auth success', JSON.stringify(info));
      }
    } catch (err) {
      console.error('Auth info fetch failed:', err);
      globalError = err instanceof Error ? err.message : 'Authentication failed';
      globalAuthInfo = null;
    } finally {
      globalIsLoading = false;
      inFlight = null;
      if (import.meta.env.DEV) {
        console.debug('[useAuth] notify listeners', JSON.stringify({ globalIsLoading, listeners: listeners.size }));
      }
      notify();
    }
  })();
  return inFlight;
};

const ensureRefreshInterval = () => {
  if (refreshIntervalId != null || typeof window === 'undefined') return;
  // Refresh every 5 minutes only once globally
  refreshIntervalId = window.setInterval(fetchAuthInfoOnce, 5 * 60 * 1000);
};

export const useAuth = (options: UseAuthOptions = {}) => {
  const autoStart = options.autoStart ?? true;
  const debugLabel = options.debugLabel ?? 'useAuth';
  const { authInfo, isLoading, error } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (import.meta.env.DEV) {
    console.debug(`[useAuth] render snapshot (${debugLabel})`, JSON.stringify({
      isLoading,
      hasAuthInfo: Boolean(authInfo),
      inFlight: Boolean(inFlight),
    }));
  }

  useEffect(() => {
    // Kick off initial load if needed
    if (autoStart && globalAuthInfo === null && !inFlight) {
      fetchAuthInfoOnce();
    }
    ensureRefreshInterval();
  }, [autoStart]);

  const refreshAuth = useCallback(async () => {
    await fetchAuthInfoOnce();
  }, []);

  // Google login handler
  const loginWithGoogle = useCallback(async (idToken: string): Promise<void> => {
    if (!globalAuthInfo?.multi_user_mode) {
      throw new Error('Google login not available in single-user mode');
    }
    globalError = null;
    notify();
    try {
      const response = await authApi.googleAuth(idToken);
      persistToken(response.access_token);
      // Re-fetch to populate user info
      await fetchAuthInfoOnce();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Google login failed';
      globalError = errorMessage;
      notify();
      throw new Error(errorMessage);
    }
  }, []);

  // Logout handler
  const logout = useCallback(async (): Promise<void> => {
    if (!globalAuthInfo?.multi_user_mode) {
      // No logout needed in single-user mode
      return;
    }
    globalError = null;
    notify();
    try {
      await authApi.logout(buildAuthHeaders());
      persistToken(null);
      await fetchAuthInfoOnce();
    } catch (err) {
      console.error('Logout error:', err);
      persistToken(null);
      globalAuthInfo = null;
      notify();
    }
  }, []);

  // Get auth headers for API calls
  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = readStoredToken();
    if (!token) return {};
    if (globalAuthInfo && !globalAuthInfo.requires_authentication) {
      return {};
    }
    return { Authorization: `Bearer ${token}` };
  }, []);

  // Computed values
  const isAuthenticated = authInfo?.authenticated ?? false;
  const user = authInfo?.user ?? null;
  const isMultiUserMode = authInfo?.multi_user_mode ?? false;
  const requiresAuthentication = authInfo?.requires_authentication ?? false;
  const availableAuthMethods = authInfo?.available_auth_methods ?? [];
  const dataFolder = authInfo?.data_folder ?? null;

  return {
    // Auth state
    isAuthenticated,
    user,
    isMultiUserMode,
    requiresAuthentication,
    availableAuthMethods,
    dataFolder,
    
    // Loading and error states
    isLoading,
    error,
    
    // Actions
    loginWithGoogle,
    logout,
    refreshAuth,
    getAuthHeaders,
    
    // Raw auth info for debugging
    authInfo: globalAuthInfo,
  };
};
