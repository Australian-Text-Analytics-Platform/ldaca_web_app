import { useState, useEffect, useCallback, useRef } from 'react';
import { AuthInfoResponse, GoogleAuthResponse } from '../types';
import { authApi } from '../services/authApi';

/**
 * Unified authentication hook that works with both single-user and multi-user modes.
 * Backend controls all auth logic via MULTI_USER environment variable.
 */
export const useAuth = () => {
  const [authInfo, setAuthInfo] = useState<AuthInfoResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Prevent multiple simultaneous auth checks
  const authCheckInProgressRef = useRef(false);

  // Fetch auth info from backend
  const fetchAuthInfo = useCallback(async () => {
    if (authCheckInProgressRef.current) return;
    
    authCheckInProgressRef.current = true;
    setError(null);
    
    try {
      const info = await authApi.getAuthInfo();
      setAuthInfo(info);
    } catch (err) {
      console.error('Auth info fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setAuthInfo(null);
    } finally {
      setIsLoading(false);
      authCheckInProgressRef.current = false;
    }
  }, []);

  // Initial auth check on mount
  useEffect(() => {
    fetchAuthInfo();
  }, [fetchAuthInfo]);

  // Periodic auth refresh (every 5 minutes)
  useEffect(() => {
    const interval = setInterval(fetchAuthInfo, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAuthInfo]);

  // Google login handler
  const loginWithGoogle = useCallback(async (idToken: string): Promise<void> => {
    if (!authInfo?.multi_user_mode) {
      throw new Error('Google login not available in single-user mode');
    }

    setError(null);
    
    try {
      const response: GoogleAuthResponse = await authApi.authenticateWithGoogle(idToken);
      
      // Store the access token for API calls
      localStorage.setItem('auth_token', response.access_token);
      
      // Refresh auth info to get updated state
      await fetchAuthInfo();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Google login failed';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [authInfo?.multi_user_mode, fetchAuthInfo]);

  // Logout handler
  const logout = useCallback(async (): Promise<void> => {
    if (!authInfo?.multi_user_mode) {
      // No logout needed in single-user mode
      return;
    }

    setError(null);
    
    try {
      await authApi.logout();
      localStorage.removeItem('auth_token');
      await fetchAuthInfo();
    } catch (err) {
      console.error('Logout error:', err);
      // Even if logout fails, clear local state
      localStorage.removeItem('auth_token');
      setAuthInfo(null);
    }
  }, [authInfo?.multi_user_mode, fetchAuthInfo]);

  // Get auth headers for API calls
  const getAuthHeaders = useCallback((): Record<string, string> => {
    if (!authInfo?.requires_authentication) {
      // Single-user mode doesn't need auth headers
      return {};
    }

    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [authInfo?.requires_authentication]);

  // Computed values
  const isAuthenticated = authInfo?.authenticated ?? false;
  const user = authInfo?.user ?? null;
  const isMultiUserMode = authInfo?.multi_user_mode ?? false;
  const requiresAuthentication = authInfo?.requires_authentication ?? false;
  const availableAuthMethods = authInfo?.available_auth_methods ?? [];

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
    refreshAuth: fetchAuthInfo,
    getAuthHeaders,
    
    // Raw auth info for debugging
    authInfo,
  };
};
