import { useEffect } from 'react';

import { useAuthStore } from '@/stores/authStore';
import { startProviderCredentialStorageSync } from '@/features/provider-credentials/providerCredentialsStore';

/**
 * Owns the browser auth lifecycle once after backend health succeeds.
 *
 * Rendered by: `App` beside `AuthGate`, so feature-level `useAuth` consumers
 * only subscribe to state and cannot start duplicate bootstrap/refresh work.
 * Flow: coalesce the initial cookie-session fetch, then start the store-owned
 * refresh interval.
 */
export function AuthBootstrap() {
  useEffect(() => {
    const store = useAuthStore.getState();
    if (!store.session) {
      void store.runAuthFetch('bootstrap');
    }
    store.ensureRefreshInterval();
    return startProviderCredentialStorageSync();
  }, []);

  return null;
}
