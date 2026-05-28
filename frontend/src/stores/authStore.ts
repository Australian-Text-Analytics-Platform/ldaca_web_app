/**
 * Authentication store. Owns the auth lifecycle that used to live in eight
 * module-level globals inside `hooks/useAuth.ts`:
 *
 *   - `authInfo` / `config` / `phase` are the React-visible snapshot.
 *   - `bootstrapAttempts`, `refreshFailures`, `inFlight`, `refreshIntervalId`
 *     are imperative bookkeeping kept as module-locals (transient — they
 *     never need to drive renders).
 *
 * Actions encapsulate every side effect (config fetch, info fetch, refresh
 * scheduling, login/logout, URL-token capture). The thin `useAuth` hook
 * subscribes to a flat slice of state and adds React-side concerns
 * (autoStart bootstrap effect + once-per-app URL-token capture).
 */
import { create } from 'zustand';

import { getAuthInfo, getConfig, googleAuth, logout as logoutSession } from '@/api/generated/sdk.gen';
import type { AuthInfoResponse, ConfigResponse } from '@/api/generated/types.gen';

const AUTH_INFO_TIMEOUT_MS = 7000;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const REFRESH_FAILURE_THRESHOLD = 3;

export type FetchReason = 'bootstrap' | 'refresh' | 'manual';

export type AuthPhase =
  | { status: 'bootstrapping'; attempts: number; error?: string }
  | { status: 'ready'; info: AuthInfoResponse }
  | { status: 'refreshing'; info: AuthInfoResponse; startedAt: number }
  | { status: 'degraded'; info: AuthInfoResponse | null; attempts: number; lastFailureAt: number; error?: string }
  | { status: 'fatal'; attempts: number; lastFailureAt: number; error: string };

interface AuthState {
  authInfo: AuthInfoResponse | null;
  config: ConfigResponse | null;
  phase: AuthPhase;
}

interface AuthActions {
  /** Drive the bootstrap/refresh state machine. Coalesces concurrent calls via `inFlight`. */
  runAuthFetch: (reason: FetchReason) => Promise<void>;
  /** Idempotent — start the 5-minute refresh interval if it isn't running. */
  ensureRefreshInterval: () => void;
  /** Public refresh trigger; promotes to `bootstrap` when there's no session. */
  refreshAuth: () => Promise<void>;
  /** Multi-user only — exchange a Google ID token for our access token, then re-bootstrap. */
  loginWithGoogle: (idToken: string) => Promise<void>;
  /** Multi-user only — clear the bearer token and re-bootstrap as anonymous. */
  logout: () => Promise<void>;
  /** Synchronous header read used by API callers and react-query keys. */
  getAuthHeaders: () => Record<string, string>;
  /**
   * Pull a Google-redirect `auth_token` off the URL into localStorage and
   * scrub the query string. Idempotent — safe to call from multiple
   * mount-time effects (the URL no longer carries the token after the first
   * pass).
   */
  processGoogleRedirectToken: () => void;
}

type AuthStore = AuthState & AuthActions;

// Imperative bookkeeping — kept outside the store so updates don't trigger
// re-renders. None of these values are ever read by React.
let bootstrapAttempts = 0;
let refreshFailures = 0;
let inFlight: Promise<void> | null = null;
let refreshIntervalId: number | null = null;

/** Reads the bearer token captured from login flows without making React subscribe to storage. */
/** Consumed by: useAuthStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
const readStoredToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem('auth_token');
  } catch {
    return null;
  }
};

/** Writes or clears the bearer token for generated SDK auth header resolution. */
/** Consumed by: useAuthStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
const persistToken = (token: string | null): void => {
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

/** Builds raw Authorization headers for bootstrap/logout calls that bypass the store action. */
/** Consumed by: useAuthStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
const buildAuthHeaders = (): Record<string, string> => {
  const token = readStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Creates a bounded signal for auth probes so startup does not hang indefinitely. */
/** Consumed by: useAuthStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
const timeoutSignal = (timeoutMs: number): AbortSignal => AbortSignal.timeout(timeoutMs);

export const useAuthStore = create<AuthStore>((set, get) => ({
  authInfo: null,
  config: null,
  phase: { status: 'bootstrapping', attempts: 0 },

  /** Runs config/auth-info fetches as a single coalesced auth state-machine transition. */
  /**
   * Consumed by: useAuthStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
    * Flow: coalesce in-flight fetches, set bootstrap or refresh phase, load config/auth info, then record ready, degraded, or fatal outcomes.
   */
  runAuthFetch: (reason) => {
    if (inFlight) return inFlight;

    const { authInfo, phase } = get();
    const hasSession = Boolean(authInfo);
    const treatAsBootstrap = reason === 'bootstrap' || !hasSession || phase.status === 'fatal';

    if (treatAsBootstrap) {
      bootstrapAttempts += 1;
      set({ phase: { status: 'bootstrapping', attempts: bootstrapAttempts } });
    } else if (authInfo) {
      set({ phase: { status: 'refreshing', info: authInfo, startedAt: Date.now() } });
    }

    inFlight = (async () => {
      try {
        if (!get().config) {
          const { data: config } = await getConfig({ throwOnError: true });
          set({ config });
        }

        const { data: info } = await getAuthInfo({
          headers: buildAuthHeaders(),
          signal: timeoutSignal(AUTH_INFO_TIMEOUT_MS),
          throwOnError: true,
        });
        bootstrapAttempts = 0;
        refreshFailures = 0;
        set({ authInfo: info, phase: { status: 'ready', info } });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Authentication failed';
        const errorObj = error != null && typeof error === 'object' ? (error as Record<string, unknown>) : null;
        const status = typeof errorObj?.status === 'number' ? errorObj.status : null;
        const unauthorized = status === 401 || status === 403;
        const failureTime = Date.now();
        const currentAuthInfo = get().authInfo;

        if (!currentAuthInfo || treatAsBootstrap) {
          bootstrapAttempts += 1;
          set({ phase: { status: 'bootstrapping', attempts: bootstrapAttempts, error: message } });
          return;
        }

        if (unauthorized) {
          persistToken(null);
          refreshFailures = REFRESH_FAILURE_THRESHOLD;
          set({
            authInfo: null,
            phase: {
              status: 'fatal',
              attempts: REFRESH_FAILURE_THRESHOLD,
              lastFailureAt: failureTime,
              error: 'Session expired. Please sign in again.',
            },
          });
          return;
        }

        refreshFailures = Math.min(REFRESH_FAILURE_THRESHOLD, refreshFailures + 1);
        if (refreshFailures >= REFRESH_FAILURE_THRESHOLD) {
          set({
            phase: {
              status: 'fatal',
              attempts: refreshFailures,
              lastFailureAt: failureTime,
              error: message,
            },
          });
        } else {
          set({
            phase: {
              status: 'degraded',
              info: currentAuthInfo,
              attempts: refreshFailures,
              lastFailureAt: failureTime,
              error: message,
            },
          });
        }
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  },

  /** Starts the background refresh loop once so long-lived sessions stay warm. */
  /** Consumed by: useAuthStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
  ensureRefreshInterval: () => {
    if (refreshIntervalId != null || typeof window === 'undefined') return;
    refreshIntervalId = window.setInterval(() => {
      const { authInfo, phase } = get();
      if (!authInfo || inFlight || phase.status === 'fatal') return;
      void get().runAuthFetch('refresh');
    }, REFRESH_INTERVAL_MS);
  },

  /**
   * Public refresh entry point used by retry buttons and the `useAuth` hook.
   * Why: store consumers need one typed boundary for shared state reads, updates, and persistence.
   */
  refreshAuth: async () => {
    const { authInfo, phase } = get();
    const reason: FetchReason = !authInfo || phase.status === 'fatal' ? 'bootstrap' : 'manual';
    await get().runAuthFetch(reason);
  },

  /** Exchanges Google credentials for the app token and refreshes the auth snapshot. */
  /**
   * Consumed by: useAuthStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
   * Flow: require multi-user mode, exchange the Google token, persist the app access token, then bootstrap auth state or rethrow a user-facing error.
   */
  loginWithGoogle: async (idToken) => {
    if (!get().config?.multi_user_mode) {
      throw new Error('Google login not available in single-user mode');
    }

    try {
      const { data: response } = await googleAuth({
        body: { id_token: idToken },
        throwOnError: true,
      });
      persistToken(response.access_token);
      await get().runAuthFetch('bootstrap');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google login failed';
      throw new Error(message, { cause: error });
    }
  },

  /** Ends a multi-user session locally and server-side, then reboots anonymous auth state. */
  /**
   * Consumed by: useAuthStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
   * Flow: skip single-user mode, attempt server logout, clear local token and counters, reset phase, then bootstrap anonymous auth.
   */
  logout: async () => {
    if (!get().config?.multi_user_mode) return;

    try {
      await logoutSession({ headers: buildAuthHeaders(), throwOnError: true });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      persistToken(null);
      bootstrapAttempts = 0;
      refreshFailures = 0;
      set({ authInfo: null, phase: { status: 'bootstrapping', attempts: 0 } });
      await get().runAuthFetch('bootstrap');
    }
  },

  /** Returns headers for API callers while suppressing bearer tokens in single-user mode. */
  /** Consumed by: useAuthStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
  getAuthHeaders: (): Record<string, string> => {
    const token = readStoredToken();
    if (!token) return {};
    const { authInfo } = get();
    if (authInfo && !authInfo.requires_authentication) return {};
    return { Authorization: `Bearer ${token}` };
  },

  /** Captures redirect-token login results and scrubs secrets from the visible URL. */
  /**
   * Consumed by: useAuthStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
    * Flow: parse `auth_token` from the query string, persist it for SDK headers, remove the secret param, and replace the URL without navigation.
   */
  processGoogleRedirectToken: () => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('auth_token');
    if (!urlToken) return;
    persistToken(urlToken);
    params.delete('auth_token');
    const clean = params.toString();
    const newUrl = `${window.location.pathname}${clean ? `?${clean}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', newUrl);
  },
}));
