import { useShallow } from 'zustand/react/shallow';

import { useAuthStore, type AuthPhase } from '@/stores/authStore';

export { REFRESH_FAILURE_THRESHOLD } from '@/stores/authStore';
export { AuthBootstrap } from '../AuthBootstrap';
export type { AuthPhase };

/**
 * Exposes auth state/actions without owning lifecycle effects.
 *
 * Used by: App gating, account UI, and authenticated feature controls.
 * `AuthBootstrap` is the only lifecycle owner.
 */
export const useAuth = () => {
  const { phase, session, refreshAuth, logout } = useAuthStore(
    useShallow((state) => ({
      phase: state.phase,
      session: state.session,
      refreshAuth: state.refreshAuth,
      logout: state.logout,
    })),
  );

  const isAuthenticated = session?.authenticated ?? false;
  const user = session?.user ?? null;
  const isMultiUserMode = session?.mode === 'multi_user';
  const requiresAuthentication = isMultiUserMode;
  const availableAuthMethods = (session?.providers ?? []).map((provider) => ({
    name: provider.id,
    display_name: provider.display_name,
    enabled: true,
  }));
  const error = 'error' in phase ? (phase.error ?? null) : null;
  const isLoading = phase.status === 'bootstrapping';

  return {
    phase,
    authInfo: session,
    isAuthenticated,
    user,
    isMultiUserMode,
    requiresAuthentication,
    availableAuthMethods,
    error,
    isLoading,
    logout,
    refreshAuth,
  };
};
