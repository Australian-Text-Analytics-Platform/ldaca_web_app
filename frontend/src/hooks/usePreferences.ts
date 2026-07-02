import { useEffect } from 'react';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useAuth } from '@/features/auth/hooks/useAuth';
import type { AnnotationAiCustomProvider } from '@/api';

/**
 * Coalesce rapid preference changes into a single backend write. Hand-tuned:
 * long enough that toggling a few view-visibility checkboxes in quick
 * succession only fires one PUT, short enough that the user perceives the
 * change as "saved" by the time they navigate away.
 */
const SYNC_DEBOUNCE_MS = 800;

interface PersistedSnapshot {
  hiddenViews: readonly string[];
  favoriteWorkspaces: readonly string[];
  defaultTokenizerModel: string | null;
  ldacaOniApiToken: string | null;
  analysisMultiTabEnabled: boolean;
  annotationAiApiKeys: Record<string, string>;
  annotationAiCustomProviders: readonly AnnotationAiCustomProvider[];
}

/**
 * Cheap stable string for change detection. Persisted shape is small
 * (≤ a handful of strings + one engine config object), so re-stringifying
 * on every store change is fine — saves writing a per-field shallow eq.
 */
/** Called by: usePreferencesInit in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
const snapshotPersisted = (
  state: ReturnType<typeof usePreferencesStore.getState>,
): PersistedSnapshot => ({
  hiddenViews: state.hiddenViews,
  favoriteWorkspaces: state.favoriteWorkspaces,
  defaultTokenizerModel: state.defaultTokenizerModel,
  ldacaOniApiToken: state.ldacaOniApiToken,
  analysisMultiTabEnabled: state.analysisMultiTabEnabled,
  annotationAiApiKeys: state.annotationAiApiKeys,
  annotationAiCustomProviders: state.annotationAiCustomProviders,
});

/** Compares the persisted preference subset so cosmetic store changes do not sync to the backend. */
/**
 * Called by: usePreferencesInit because only durable preference changes should trigger a debounced backend write.
 * Flow: compare scalar preferences first, then hidden-view and favorite arrays in order, returning true only for identical persisted snapshots.
 */
const snapshotsEqual = (a: PersistedSnapshot, b: PersistedSnapshot) => {
  if (a.defaultTokenizerModel !== b.defaultTokenizerModel) return false;
  if (a.ldacaOniApiToken !== b.ldacaOniApiToken) return false;
  if (a.analysisMultiTabEnabled !== b.analysisMultiTabEnabled) return false;
  if (a.hiddenViews.length !== b.hiddenViews.length) return false;
  if (a.favoriteWorkspaces.length !== b.favoriteWorkspaces.length) return false;
  for (let i = 0; i < a.hiddenViews.length; i++) {
    if (a.hiddenViews[i] !== b.hiddenViews[i]) return false;
  }
  for (let i = 0; i < a.favoriteWorkspaces.length; i++) {
    if (a.favoriteWorkspaces[i] !== b.favoriteWorkspaces[i]) return false;
  }
  // annotation_ai keys/providers are small; stringify-compare is cheap and simple.
  if (
    JSON.stringify(a.annotationAiApiKeys) !== JSON.stringify(b.annotationAiApiKeys)
  ) {
    return false;
  }
  if (
    JSON.stringify(a.annotationAiCustomProviders) !==
    JSON.stringify(b.annotationAiCustomProviders)
  ) {
    return false;
  }
  return true;
};

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
  const { getAuthHeaders, isAuthenticated } = useAuth();
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const loadFromBackend = usePreferencesStore((s) => s.loadFromBackend);

  useEffect(() => {
    if (hydrated) return;
    const headers = isAuthenticated ? getAuthHeaders() : undefined;
    void loadFromBackend(headers);
  }, [hydrated, isAuthenticated, getAuthHeaders, loadFromBackend]);

  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;

    let lastSnapshot = snapshotPersisted(usePreferencesStore.getState());
    let pending: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = usePreferencesStore.subscribe((state) => {
      const snapshot = snapshotPersisted(state);
      if (snapshotsEqual(snapshot, lastSnapshot)) return;
      lastSnapshot = snapshot;

      if (pending !== null) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        void usePreferencesStore.getState().syncToBackend(getAuthHeaders());
      }, SYNC_DEBOUNCE_MS);
    });

    return () => {
      if (pending !== null) clearTimeout(pending);
      unsubscribe();
    };
  }, [hydrated, isAuthenticated, getAuthHeaders]);
}
