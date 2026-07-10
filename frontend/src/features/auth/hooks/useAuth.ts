import { useShallow } from 'zustand/react/shallow';

import { useAuthStore, type AuthPhase } from '@/stores/authStore';

export { REFRESH_FAILURE_THRESHOLD } from '@/stores/authStore';
export { AuthBootstrap } from '../AuthBootstrap';
export type { AuthPhase };

/**
 * Exposes auth state/actions without owning lifecycle effects.
 *
 * Used by: App gating, account UI, raw download/EventSource boundaries, and
 * authenticated feature controls. `AuthBootstrap` is the only lifecycle owner.
 */
export const useAuth = () => {
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
