import { useEffect, useCallback, useSyncExternalStore } from 'react';
import { AuthInfoResponse } from '../types';
import { authApi } from '../api/auth';
import { configApi, ConfigResponse } from '../api/config';

if (import.meta.env.DEV) {
  console.debug('[useAuth] module loaded', import.meta.url);
}

const AUTH_INFO_TIMEOUT_MS = 7000;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const REFRESH_FAILURE_THRESHOLD = 3;

type FetchReason = 'bootstrap' | 'refresh' | 'manual';

export type AuthPhase =
  | { status: 'bootstrapping'; attempts: number; error?: string }
  | { status: 'ready'; info: AuthInfoResponse }
  | { status: 'refreshing'; info: AuthInfoResponse; startedAt: number }
  | { status: 'degraded'; info: AuthInfoResponse | null; attempts: number; lastFailureAt: number; error?: string }
  | { status: 'fatal'; attempts: number; lastFailureAt: number; error: string };

type AuthSnapshot = {
  phase: AuthPhase;
  authInfo: AuthInfoResponse | null;
  config: ConfigResponse | null;
};

// ------------------------------------------------------------
// Global singleton state so every component shares the same
// authentication lifecycle (and StrictMode double-mounts are safe).
// ------------------------------------------------------------
let globalAuthInfo: AuthInfoResponse | null = null;
let globalConfig: ConfigResponse | null = null;
let globalPhase: AuthPhase = { status: 'bootstrapping', attempts: 0 };
let globalBootstrapAttempts = 0;
let globalRefreshFailures = 0;
let inFlight: Promise<void> | null = null;
let refreshIntervalId: number | null = null;
const listeners = new Set<() => void>();

const computeSnapshot = (): AuthSnapshot => ({
  phase: globalPhase,
  authInfo: globalAuthInfo,
  config: globalConfig,
});

let currentSnapshot: AuthSnapshot = computeSnapshot();

const notify = () => {
  const nextSnapshot = computeSnapshot();
  if (
    nextSnapshot.phase === currentSnapshot.phase &&
    nextSnapshot.authInfo === currentSnapshot.authInfo &&
    nextSnapshot.config === currentSnapshot.config
  ) {
    return;
  }
  currentSnapshot = nextSnapshot;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // no-op
    }
  });
};

const setPhase = (phase: AuthPhase) => {
  globalPhase = phase;
  notify();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => currentSnapshot;

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

const runAuthFetch = (reason: FetchReason): Promise<void> => {
  if (inFlight) return inFlight;

  const hasSession = Boolean(globalAuthInfo);
  const treatAsBootstrap = reason === 'bootstrap' || !hasSession || globalPhase.status === 'fatal';

  if (treatAsBootstrap) {
    globalBootstrapAttempts += 1;
    setPhase({ status: 'bootstrapping', attempts: globalBootstrapAttempts });
  } else if (globalAuthInfo) {
    setPhase({ status: 'refreshing', info: globalAuthInfo, startedAt: Date.now() });
  }

  inFlight = (async () => {
    try {
      // Fetch config if not already loaded
      if (!globalConfig) {
        globalConfig = await configApi.getConfig();
      }

      const info = await authApi.info(buildAuthHeaders(), { timeoutMs: AUTH_INFO_TIMEOUT_MS });
      globalAuthInfo = info;
      globalBootstrapAttempts = 0;
      globalRefreshFailures = 0;
      setPhase({ status: 'ready', info });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed';
      const status = typeof (error as any)?.status === 'number' ? (error as any).status : null;
      const unauthorized = status === 401 || status === 403;
      const failureTime = Date.now();

      if (!globalAuthInfo || treatAsBootstrap) {
        globalBootstrapAttempts += 1;
        setPhase({ status: 'bootstrapping', attempts: globalBootstrapAttempts, error: message });
        return;
      }

      if (unauthorized) {
        persistToken(null);
        globalAuthInfo = null;
        globalRefreshFailures = REFRESH_FAILURE_THRESHOLD;
        setPhase({
          status: 'fatal',
          attempts: REFRESH_FAILURE_THRESHOLD,
          lastFailureAt: failureTime,
          error: 'Session expired. Please sign in again.',
        });
        return;
      }

      globalRefreshFailures = Math.min(REFRESH_FAILURE_THRESHOLD, globalRefreshFailures + 1);
      if (globalRefreshFailures >= REFRESH_FAILURE_THRESHOLD) {
        setPhase({ status: 'fatal', attempts: globalRefreshFailures, lastFailureAt: failureTime, error: message });
      } else {
        setPhase({
          status: 'degraded',
          info: globalAuthInfo,
          attempts: globalRefreshFailures,
          lastFailureAt: failureTime,
          error: message,
        });
      }
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
};

const ensureRefreshInterval = () => {
  if (refreshIntervalId != null || typeof window === 'undefined') return;
  refreshIntervalId = window.setInterval(() => {
    if (!globalAuthInfo || inFlight || globalPhase.status === 'fatal') return;
    runAuthFetch('refresh');
  }, REFRESH_INTERVAL_MS);
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

export const useAuth = (options: UseAuthOptions = {}) => {
  const autoStart = options.autoStart ?? false;
  const debugLabel = options.debugLabel ?? 'useAuth';
  const { phase, authInfo, config } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (import.meta.env.DEV) {
    console.debug(`[useAuth] snapshot (${debugLabel})`, {
      phase: phase.status,
      hasAuthInfo: Boolean(authInfo),
      hasConfig: Boolean(config),
      inFlight: Boolean(inFlight),
    });
  }

  useEffect(() => {
    if (autoStart && !globalAuthInfo) {
      runAuthFetch('bootstrap');
    }
    ensureRefreshInterval();
  }, [autoStart]);

  const refreshAuth = useCallback(async () => {
    const reason: FetchReason = !globalAuthInfo || globalPhase.status === 'fatal' ? 'bootstrap' : 'manual';
    await runAuthFetch(reason);
  }, []);

  const loginWithGoogle = useCallback(async (idToken: string) => {
    if (!globalConfig?.multi_user_mode) {
      throw new Error('Google login not available in single-user mode');
    }

    try {
      const response = await authApi.googleAuth(idToken);
      persistToken(response.access_token);
      await runAuthFetch('bootstrap');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google login failed';
      throw new Error(message);
    }
  }, []);

  const logout = useCallback(async () => {
    if (!globalConfig?.multi_user_mode) {
      return;
    }

    try {
      await authApi.logout(buildAuthHeaders());
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      persistToken(null);
      globalAuthInfo = null;
      globalBootstrapAttempts = 0;
      globalRefreshFailures = 0;
      setPhase({ status: 'bootstrapping', attempts: 0 });
      await runAuthFetch('bootstrap');
    }
  }, []);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = readStoredToken();
    if (!token) return {};
    if (globalAuthInfo && !globalAuthInfo.requires_authentication) {
      return {};
    }
    return { Authorization: `Bearer ${token}` };
  }, []);

  const isAuthenticated = authInfo?.authenticated ?? false;
  const user = authInfo?.user ?? null;
  const isMultiUserMode = config?.multi_user_mode ?? false;
  const requiresAuthentication = authInfo?.requires_authentication ?? false;
  const availableAuthMethods = authInfo?.available_auth_methods ?? [];
  const dataFolder = authInfo?.data_folder ?? null;
  const error = 'error' in phase ? phase.error ?? null : null;
  const isLoading = phase.status === 'bootstrapping';

  return {
    phase,
    authInfo,
    isAuthenticated,
    user,
    isMultiUserMode,
    requiresAuthentication,
    availableAuthMethods,
    dataFolder,
    error,
    isLoading,
    loginWithGoogle,
    logout,
    refreshAuth,
    getAuthHeaders,
  };
};
