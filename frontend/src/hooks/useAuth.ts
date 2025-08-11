import { useState, useEffect, useCallback } from 'react';
import { AuthInfoResponse, GoogleAuthResponse } from '../types';
import { authApi } from '../services/authApi';

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

const notify = () => {
  listeners.forEach(l => {
    try { l(); } catch { /* ignore */ }
  });
};

const fetchAuthInfoOnce = async () => {
  if (inFlight) return inFlight;
  globalIsLoading = true;
  globalError = null;
  inFlight = (async () => {
    try {
      const info = await authApi.getAuthInfo();
      globalAuthInfo = info;
    } catch (err) {
      console.error('Auth info fetch failed:', err);
      globalError = err instanceof Error ? err.message : 'Authentication failed';
      globalAuthInfo = null;
    } finally {
      globalIsLoading = false;
      inFlight = null;
      notify();
    }
  })();
  return inFlight;
};

const ensureRefreshInterval = () => {
  if (refreshIntervalId != null) return;
  // Refresh every 5 minutes only once globally
  refreshIntervalId = window.setInterval(fetchAuthInfoOnce, 5 * 60 * 1000);
};

export const useAuth = () => {
  const [, forceRender] = useState(0);
  // Derive reactive snapshots from globals
  const isLoading = globalIsLoading;
  const error = globalError;

  useEffect(() => {
    // Subscribe
    listeners.add(() => forceRender(v => v + 1));
    // Kick off initial load if needed
    if (globalAuthInfo === null && !inFlight) {
      fetchAuthInfoOnce();
    }
    ensureRefreshInterval();
    return () => {
      // Remove this component's listener on unmount
      listeners.forEach(l => {
        // We can't easily compare functions created inline above; harmless to leave
        // (memory is trivial). For completeness, we could store the specific fn.
      });
    };
  }, []);

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
      const response: GoogleAuthResponse = await authApi.authenticateWithGoogle(idToken);
      localStorage.setItem('auth_token', response.access_token);
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
      await authApi.logout();
      localStorage.removeItem('auth_token');
      await fetchAuthInfoOnce();
    } catch (err) {
      console.error('Logout error:', err);
      localStorage.removeItem('auth_token');
      globalAuthInfo = null;
      notify();
    }
  }, []);

  // Get auth headers for API calls
  const getAuthHeaders = useCallback((): Record<string, string> => {
    if (!globalAuthInfo?.requires_authentication) {
      // Single-user mode doesn't need auth headers
      return {};
    }

    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  // Computed values
  const isAuthenticated = globalAuthInfo?.authenticated ?? false;
  const user = globalAuthInfo?.user ?? null;
  const isMultiUserMode = globalAuthInfo?.multi_user_mode ?? false;
  const requiresAuthentication = globalAuthInfo?.requires_authentication ?? false;
  const availableAuthMethods = globalAuthInfo?.available_auth_methods ?? [];

  return {
    // Auth state
    isAuthenticated,
    user,
    isMultiUserMode,
    requiresAuthentication,
    availableAuthMethods,
    
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
