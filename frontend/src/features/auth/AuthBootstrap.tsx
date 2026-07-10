import { useEffect } from 'react';

import { useAuthStore } from '@/stores/authStore';

/**
 * Owns the browser auth lifecycle once after backend health succeeds.
 *
 * Rendered by: `App` beside `AuthGate`, so feature-level `useAuth` consumers
 * only subscribe to state and cannot start duplicate bootstrap/refresh work.
 * Flow: capture any redirect token, coalesce the initial auth fetch, then start
 * the store-owned refresh interval.
 */
export function AuthBootstrap() {
  useEffect(() => {
    const store = useAuthStore.getState();
    store.processGoogleRedirectToken();
    if (!store.authInfo) {
      void store.runAuthFetch('bootstrap');
    }
    store.ensureRefreshInterval();
  }, []);

  return null;
}
