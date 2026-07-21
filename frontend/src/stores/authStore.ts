/** Cookie-session bootstrap state for the hosted and desktop profiles. */

import { create } from 'zustand';

import { deleteSession, getSession } from '@/api';
import type { SessionResponse } from '@/api';
import { clearCsrfToken, setCsrfToken } from '@/lib/backend/csrfToken';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const REFRESH_FAILURE_THRESHOLD = 3;

type FetchReason = 'bootstrap' | 'refresh' | 'manual';

export type AuthPhase =
  | { status: 'bootstrapping'; attempts: number; error?: string }
  | { status: 'ready'; info: SessionResponse }
  | { status: 'refreshing'; info: SessionResponse; startedAt: number }
  | {
      status: 'degraded';
      info: SessionResponse | null;
      attempts: number;
      lastFailureAt: number;
      error?: string;
    }
  | { status: 'fatal'; attempts: number; lastFailureAt: number; error: string };

interface AuthState {
  session: SessionResponse | null;
  phase: AuthPhase;
}

interface AuthActions {
  runAuthFetch: (reason: FetchReason) => Promise<void>;
  ensureRefreshInterval: () => void;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

type AuthStore = AuthState & AuthActions;

let bootstrapAttempts = 0;
let refreshFailures = 0;
let inFlight: Promise<void> | null = null;
let refreshIntervalId: number | null = null;

export const useAuthStore = create<AuthStore>((set, get) => ({
  session: null,
  phase: { status: 'bootstrapping', attempts: 0 },

  runAuthFetch: (reason) => {
    if (inFlight) return inFlight;

    const currentSession = get().session;
    const treatAsBootstrap =
      reason === 'bootstrap' || currentSession === null || get().phase.status === 'fatal';
    if (treatAsBootstrap) {
      bootstrapAttempts += 1;
      set({ phase: { status: 'bootstrapping', attempts: bootstrapAttempts } });
    } else {
      set({ phase: { status: 'refreshing', info: currentSession, startedAt: Date.now() } });
    }

    inFlight = (async () => {
      try {
        const { data } = await getSession({ throwOnError: true });
        setCsrfToken(data.csrf_token);
        bootstrapAttempts = 0;
        refreshFailures = 0;
        set({ session: data, phase: { status: 'ready', info: data } });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Authentication failed';
        const failureTime = Date.now();
        refreshFailures += 1;
        const current = get().session;
        if (current && !treatAsBootstrap && refreshFailures < REFRESH_FAILURE_THRESHOLD) {
          set({
            phase: {
              status: 'degraded',
              info: current,
              attempts: refreshFailures,
              lastFailureAt: failureTime,
              error: message,
            },
          });
        } else {
          if (refreshFailures >= REFRESH_FAILURE_THRESHOLD || treatAsBootstrap) {
            set({
              session: current,
              phase: {
                status: 'fatal',
                attempts: bootstrapAttempts,
                lastFailureAt: failureTime,
                error: message,
              },
            });
          } else {
            set({
              phase: {
                status: 'degraded',
                info: current,
                attempts: refreshFailures,
                lastFailureAt: failureTime,
                error: message,
              },
            });
          }
        }
        throw error;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  ensureRefreshInterval: () => {
    if (refreshIntervalId !== null) return;
    refreshIntervalId = window.setInterval(() => {
      if (get().session?.authenticated)
        void get()
          .runAuthFetch('refresh')
          .catch(() => undefined);
    }, REFRESH_INTERVAL_MS);
  },

  refreshAuth: () => get().runAuthFetch('manual'),

  logout: async () => {
    await deleteSession({ throwOnError: true });
    clearCsrfToken();
    set({ session: null, phase: { status: 'bootstrapping', attempts: 0 } });
    await get().runAuthFetch('bootstrap');
  },
}));
