/**
 * User preferences store. State is persisted to `localStorage` via the
 * `persist` middleware and to the backend via a debounced subscriber set
 * up in `usePreferencesInit` (`hooks/usePreferences.ts`):
 *
 *   - Setters update local state only. They do *not* call
 *     `syncToBackend` directly.
 *   - The init hook subscribes to changes after `hydrated` flips true,
 *     coalesces bursts via a 800 ms debounce, and pushes the latest
 *     persisted preference subset using auth headers from the React-side `useAuth`.
 *
 * Doing the sync at the hook level means the call always has fresh auth
 * headers; doing it via subscribe (instead of inline in each setter)
 * coalesces rapid edits (e.g. dragging the favourites list) into a
 * single request and never fires before the initial server load
 * completes.
 */
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { getPreferences, updatePreferences } from '@/api';
import type { AnnotationAiCustomProvider } from '@/api';
import type { ViewType } from '@/features/views/viewIds';
import {
  encodePreferencesUpdate,
  normalizeServerPreferences,
  projectDurablePreferences,
  type DurablePreferences,
} from './preferencesCodec';

const DEFAULT_HIDDEN_VIEWS: string[] = [];

interface PreferencesState extends DurablePreferences {
  /** True once the first backend fetch completes */
  hydrated: boolean;
  /** True while a backend sync is in-flight */
  syncing: boolean;
  /** Most recent error from syncing or loading preferences */
  lastSyncError: string | null;
}

interface PreferencesActions {
  setViewHidden: (view: ViewType, hidden: boolean) => void;
  toggleFavorite: (workspaceId: string) => void;
  isFavorite: (workspaceId: string) => boolean;
  setDefaultTokenizerModel: (model: string | null) => void;
  setLdacaOniApiToken: (token: string | null) => void;
  setAnalysisMultiTabEnabled: (enabled: boolean) => void;
  /** Save (or clear when empty) the AI API key for a provider id. */
  setAnnotationAiApiKey: (providerId: string, key: string | null) => void;
  /** Add or replace a user-defined custom AI provider (matched by id). */
  addAnnotationAiCustomProvider: (provider: AnnotationAiCustomProvider) => void;
  /** Remove a custom AI provider (and its stored API key) by id. */
  removeAnnotationAiCustomProvider: (providerId: string) => void;
  /** Fetch preferences from backend and hydrate the store */
  loadFromBackend: () => Promise<void>;
  /** Push current state to backend */
  syncToBackend: () => Promise<void>;
}

type PreferencesStore = PreferencesState & PreferencesActions;

/** Hydrates persisted preference fields into the immer draft after a successful backend load. */
/**
 * Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
 * Flow: copy resolved backend preference fields into the draft store state, then mark hydration complete for subscribers.
 */
function applyServerState(state: PreferencesState, data: DurablePreferences) {
  state.hiddenViews = data.hiddenViews;
  state.favoriteWorkspaces = data.favoriteWorkspaces;
  state.defaultTokenizerModel = data.defaultTokenizerModel;
  state.ldacaOniApiToken = data.ldacaOniApiToken;
  state.analysisMultiTabEnabled = data.analysisMultiTabEnabled;
  state.annotationAiApiKeys = data.annotationAiApiKeys;
  state.annotationAiCustomProviders = data.annotationAiCustomProviders;
  state.hydrated = true;
}

export const usePreferencesStore = create<PreferencesStore>()(
  devtools(
    persist(
      immer((set, get) => ({
        hiddenViews: [...DEFAULT_HIDDEN_VIEWS],
        favoriteWorkspaces: [],
        defaultTokenizerModel: null,
        ldacaOniApiToken: null,
        analysisMultiTabEnabled: false,
        annotationAiApiKeys: {},
        annotationAiCustomProviders: [],
        hydrated: false,
        syncing: false,
        lastSyncError: null,

        /** Hides or reveals optional views while keeping Data Loader always reachable. */
        /** Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        setViewHidden: (view, hidden) => {
          if (view === 'data-loader') return;
          set((state) => {
            const idx = state.hiddenViews.indexOf(view);
            if (hidden && idx === -1) {
              state.hiddenViews.push(view);
            } else if (!hidden && idx !== -1) {
              state.hiddenViews.splice(idx, 1);
            }
          });
        },

        /** Toggles a workspace in the user's quick-access favorites list. */
        /** Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        toggleFavorite: (workspaceId) => {
          set((state) => {
            const idx = state.favoriteWorkspaces.indexOf(workspaceId);
            if (idx === -1) {
              state.favoriteWorkspaces.push(workspaceId);
            } else {
              state.favoriteWorkspaces.splice(idx, 1);
            }
          });
        },

        /** Checks favorite status for sidebar/workspace picker rendering. */
        /** Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        isFavorite: (workspaceId) => get().favoriteWorkspaces.includes(workspaceId),

        /**
         * Stores the preferred tokenizer model used by tokenization-aware tools.
         * Why: store consumers need one typed boundary for shared state reads, updates, and persistence.
         */
        setDefaultTokenizerModel: (model) => {
          const value = typeof model === 'string' && model.trim() ? model.trim() : null;
          set((state) => {
            state.defaultTokenizerModel = value;
          });
        },

        /** Persists the user's optional LDaCA Oni API token for portal import flows. */
        /** Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        setLdacaOniApiToken: (token) => {
          const value = typeof token === 'string' && token.trim() ? token.trim() : null;
          set((state) => {
            state.ldacaOniApiToken = value;
          });
        },

        /**
         * Shows or hides the analysis tab-strip controls without changing the
         * tab ids and sidecar state used underneath.
         * Used by: SettingsDialog and AnalysisTabsHost because the preference
         * belongs to user-visible analysis presentation, not tab persistence.
         */
        setAnalysisMultiTabEnabled: (enabled) => {
          set((state) => {
            state.analysisMultiTabEnabled = enabled;
          });
        },

        /**
         * Saves (or clears, when blank) the AI API key for a provider id.
         * Why: the Annotation AI panel commits keys on blur so they persist to
         * the TOML preferences via the debounced backend sync; an empty value
         * removes the entry so we never write blank keys.
         * Used by: AnnotationFeature's AI settings API-key input.
         */
        setAnnotationAiApiKey: (providerId, key) => {
          const value = typeof key === 'string' && key.trim() ? key.trim() : null;
          set((state) => {
            if (value === null) {
              // Reassign without the key (no-dynamic-delete forbids `delete`).
              const next: Record<string, string> = {};
              for (const [k, v] of Object.entries(state.annotationAiApiKeys)) {
                if (k !== providerId) next[k] = v;
              }
              state.annotationAiApiKeys = next;
            } else {
              state.annotationAiApiKeys[providerId] = value;
            }
          });
        },

        /**
         * Adds or replaces a user-defined custom AI provider (matched by id).
         * Why: the Annotation "Custom…" dialog registers OpenAI-compatible
         * providers that persist and reappear in the provider dropdown; updating
         * an existing id lets the same dialog edit a provider later.
         * Used by: the custom-provider dialog flow in AnnotationFeature.
         */
        addAnnotationAiCustomProvider: (provider) => {
          set((state) => {
            const idx = state.annotationAiCustomProviders.findIndex((p) => p.id === provider.id);
            if (idx === -1) {
              state.annotationAiCustomProviders.push(provider);
            } else {
              state.annotationAiCustomProviders[idx] = provider;
            }
          });
        },

        /**
         * Removes a custom AI provider and any API key stored under its id.
         * Why: the AI providers preferences panel lets users delete custom
         * providers; dropping the matching key avoids leaving an orphaned secret
         * in the persisted preferences. Built-in providers cannot be removed, so
         * callers only pass `custom:<uuid>` ids here.
         * Used by: AiProvidersPreferencesPanel's delete action.
         */
        removeAnnotationAiCustomProvider: (providerId) => {
          set((state) => {
            state.annotationAiCustomProviders = state.annotationAiCustomProviders.filter(
              (p) => p.id !== providerId,
            );
            // Reassign without the key (no-dynamic-delete forbids `delete`).
            const next: Record<string, string> = {};
            for (const [k, v] of Object.entries(state.annotationAiApiKeys)) {
              if (k !== providerId) next[k] = v;
            }
            state.annotationAiApiKeys = next;
          });
        },

        /** Loads preferences from the backend once auth is available, falling back to local state. */
        /** Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        loadFromBackend: async () => {
          try {
            const { data: preferences } = await getPreferences({
              throwOnError: true,
            });
            const data = normalizeServerPreferences(preferences);
            set((state) => {
              applyServerState(state, data);
              state.lastSyncError = null;
            });
          } catch (e) {
            set((state) => {
              state.hydrated = true;
              state.lastSyncError = e instanceof Error ? e.message : String(e);
            });
          }
        },

        /** Pushes the latest persisted preference subset to the backend from the debounce subscriber. */
        /**
         * Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
         * Flow: guard concurrent syncs, build the partial preferences payload, call the backend update, then clear syncing even if the request fails.
         */
        syncToBackend: async () => {
          const state = get();
          if (state.syncing) return;
          set((s) => {
            s.syncing = true;
          });
          const body = encodePreferencesUpdate(projectDurablePreferences(state));
          try {
            await updatePreferences({
              body,
              throwOnError: true,
            });
          } catch (e) {
            set((s) => {
              s.lastSyncError = e instanceof Error ? e.message : String(e);
            });
          } finally {
            set((s) => {
              s.syncing = false;
            });
          }
        },
      })),
      {
        name: 'ldaca-preferences',
        /** Persists only durable user choices; transient hydration/sync flags stay in memory. */
        /** Consumed by: Zustand persist for usePreferencesStore because persisted hydration needs a stable storage contract before store state is restored. */
        partialize: projectDurablePreferences,
      },
    ),
    { name: 'preferences-store' },
  ),
);
