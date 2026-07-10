import { useEffect } from 'react';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  durablePreferencesEqual,
  projectDurablePreferences,
} from '@/stores/preferencesCodec';

/**
 * Coalesce rapid preference changes into a single backend write. Hand-tuned:
 * long enough that toggling a few view-visibility checkboxes in quick
 * succession only fires one PUT, short enough that the user perceives the
 * change as "saved" by the time they navigate away.
 */
const SYNC_DEBOUNCE_MS = 800;

/**
 * One-time fetch of user preferences from the backend on mount, plus a
 * debounced subscriber that pushes local changes back to the server.
 *
 * The subscriber only registers after `hydrated` flips true (so the
 * load-from-backend step doesn't immediately trigger a sync of the same
 * data we just received) and only when authenticated (anonymous edits
 * stay in `localStorage` until the user signs in).
 */
/**
 * Used by: src/App.tsx because the hook needs local steps to normalize inputs before exposing stable state to consumers.
 * Flow: load backend preferences once auth state is known, then subscribe after hydration and debounce authenticated syncs back to the server.
 */
export function usePreferencesInit() {
  const { isAuthenticated } = useAuth();
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const loadFromBackend = usePreferencesStore((s) => s.loadFromBackend);

  useEffect(() => {
    if (hydrated) return;
    void loadFromBackend();
  }, [hydrated, isAuthenticated, loadFromBackend]);

  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;

    let lastSnapshot = projectDurablePreferences(usePreferencesStore.getState());
    let pending: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = usePreferencesStore.subscribe((state) => {
      const snapshot = projectDurablePreferences(state);
      if (durablePreferencesEqual(snapshot, lastSnapshot)) return;
      lastSnapshot = snapshot;

      if (pending !== null) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        void usePreferencesStore.getState().syncToBackend();
      }, SYNC_DEBOUNCE_MS);
    });

    return () => {
      if (pending !== null) clearTimeout(pending);
      unsubscribe();
    };
  }, [hydrated, isAuthenticated]);
}
