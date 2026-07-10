import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useAuthStore, type AuthPhase } from '@/stores/authStore';

export { REFRESH_FAILURE_THRESHOLD } from '@/stores/authStore';
export type { AuthPhase };

export interface UseAuthOptions {
  /**
   * When false, the hook will wait for an explicit `refreshAuth` call
   * before making the initial /api/auth/ request.
   */
  autoStart?: boolean;
}

/** Exposes auth store state/actions as a hook and performs first-mount auth bootstrap work. */
/**
 * Used by: App, DataFolderSettingsPanel, Sidebar, and other authenticated feature consumers that need one normalized auth/session boundary.
 * Flow: subscribe to the auth-store slice, run redirect-token/bootstrap/refresh setup on mount, then derive UI-friendly auth flags and actions.
 */
export const useAuth = (options: UseAuthOptions = {}) => {
  const autoStart = options.autoStart ?? false;

  const { phase, authInfo, config, refreshAuth, loginWithGoogle, logout, getAuthHeaders } =
    useAuthStore(
      useShallow((state) => ({
        phase: state.phase,
        authInfo: state.authInfo,
        config: state.config,
        refreshAuth: state.refreshAuth,
        loginWithGoogle: state.loginWithGoogle,
        logout: state.logout,
        getAuthHeaders: state.getAuthHeaders,
      })),
    );

  useEffect(() => {
    const store = useAuthStore.getState();
    // B6: URL-token capture used to run at module-import time. Run it here on
    // first mount instead so test environments and SSR don't side-effect on
    // import. The store action is idempotent (the token is removed from the
    // URL after the first pass), so the only-once-per-app guarantee comes for
    // free.
    store.processGoogleRedirectToken();
    if (autoStart && !store.authInfo) {
      void store.runAuthFetch('bootstrap');
    }
    store.ensureRefreshInterval();
  }, [autoStart]);

  const isAuthenticated = authInfo?.authenticated ?? false;
  const user = authInfo?.user ?? null;
  const isMultiUserMode = config?.multi_user_mode ?? false;
  const requiresAuthentication = authInfo?.requires_authentication ?? false;
  const availableAuthMethods = authInfo?.available_auth_methods ?? [];
  const dataFolder = authInfo?.data_folder ?? null;
  const error = 'error' in phase ? (phase.error ?? null) : null;
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
