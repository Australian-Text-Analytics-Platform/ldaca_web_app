import { useEffect } from 'react';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useAuth } from '@/hooks/useAuth';

/**
 * Triggers a one-time fetch of user preferences from the backend on mount,
 * then keeps the Zustand store in sync with localStorage as a cache.
 */
export function usePreferencesInit() {
  const { getAuthHeaders, isAuthenticated } = useAuth();
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const loadFromBackend = usePreferencesStore((s) => s.loadFromBackend);

  useEffect(() => {
    if (hydrated) return;
    const headers = isAuthenticated ? getAuthHeaders() : undefined;
    loadFromBackend(headers);
  }, [hydrated, isAuthenticated, getAuthHeaders, loadFromBackend]);
}
