/**
 * Dependency-light bearer-token boundary shared by auth state and generated
 * client configuration. It deliberately has no React, Zustand, or generated
 * SDK imports, so request configuration can read the current token without an
 * import cycle.
 *
 * Used by: `authStore` for login/logout/redirect persistence and
 * `generatedClientConfig` for per-request Authorization injection.
 */

let requiresAuthentication: boolean | null = null;

/** Reads the token captured by browser login flows, tolerating disabled storage. */
const readStoredAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem('auth_token');
  } catch {
    return null;
  }
};

/** Writes or clears the token used by generated and raw authenticated requests. */
export const persistAuthToken = (token: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem('auth_token', token);
    } else {
      window.localStorage.removeItem('auth_token');
    }
  } catch {
    // Storage can be unavailable in private browsing; auth then remains sessionless.
  }
};

/**
 * Records the resolved backend auth mode. Before bootstrap completes, `null`
 * intentionally allows a stored redirect token to authenticate the bootstrap
 * request; single-user mode then suppresses that stale token for later calls.
 */
export const setRequiresAuthentication = (required: boolean | null): void => {
  requiresAuthentication = required;
};

/** Builds the current raw Authorization header for generated and native boundaries. */
export const getAuthHeaders = (): Record<string, string> => {
  if (requiresAuthentication === false) return {};
  const token = readStoredAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};
