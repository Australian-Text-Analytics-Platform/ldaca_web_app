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
import type { UserPreferences, UserPreferencesUpdate } from '@/api';
import type { ViewType } from '@/stores/uiStore';

const DEFAULT_HIDDEN_VIEWS: string[] = [];

interface PreferencesState {
  hiddenViews: string[];
  favoriteWorkspaces: string[];
  defaultTokenizerModel: string | null;
  ldacaOniApiToken: string | null;
  analysisMultiTabEnabled: boolean;
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
  /** Fetch preferences from backend and hydrate the store */
  loadFromBackend: (headers?: Record<string, string>) => Promise<void>;
  /** Push current state to backend */
  syncToBackend: (headers?: Record<string, string>) => Promise<void>;
}

type PreferencesStore = PreferencesState & PreferencesActions;

type ResolvedUserPreferences = Omit<
  UserPreferences,
  | 'default_tokenizer_model'
  | 'favorite_workspaces'
  | 'hidden_views'
  | 'ldaca_oni_api_token'
  | 'analysis_multi_tab_enabled'
> & {
  hidden_views: string[];
  favorite_workspaces: string[];
  default_tokenizer_model: string | null;
  ldaca_oni_api_token: string | null;
  analysis_multi_tab_enabled: boolean;
};

/** Converts frontend auth header casing to the generated preferences client contract. */
/** Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
const getAuthorizationHeaders = (
  headers?: Record<string, string>,
): { authorization?: string } | undefined => {
  const authorization = headers?.Authorization ?? headers?.authorization;
  return authorization ? { authorization } : undefined;
};

/** Applies backend defaults so the store always works with concrete preference fields. */
/**
 * Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
 * Flow: fill missing backend arrays, tokenizer/token choices, and analysis UI
 * flags with concrete frontend defaults.
 */
const normalizePreferences = (data: UserPreferences): ResolvedUserPreferences => ({
  hidden_views: data.hidden_views ?? [],
  favorite_workspaces: data.favorite_workspaces ?? [],
  default_tokenizer_model: data.default_tokenizer_model ?? null,
  ldaca_oni_api_token: data.ldaca_oni_api_token ?? null,
  analysis_multi_tab_enabled: data.analysis_multi_tab_enabled ?? false,
});

/** Hydrates persisted preference fields into the immer draft after a successful backend load. */
/**
 * Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
 * Flow: copy resolved backend preference fields into the draft store state, then mark hydration complete for subscribers.
 */
function applyServerState(state: PreferencesState, data: ResolvedUserPreferences) {
  state.hiddenViews = data.hidden_views;
  state.favoriteWorkspaces = data.favorite_workspaces;
  state.defaultTokenizerModel = data.default_tokenizer_model;
  state.ldacaOniApiToken = data.ldaca_oni_api_token;
  state.analysisMultiTabEnabled = data.analysis_multi_tab_enabled;
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

        /** Loads preferences from the backend once auth is available, falling back to local state. */
        /** Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        loadFromBackend: async (headers) => {
          try {
            const { data: preferences } = await getPreferences({
              headers: getAuthorizationHeaders(headers),
              throwOnError: true,
            });
            const data = normalizePreferences(preferences);
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
        syncToBackend: async (headers) => {
          const state = get();
          if (state.syncing) return;
          set((s) => {
            s.syncing = true;
          });
          const body: UserPreferencesUpdate = {
            hidden_views: state.hiddenViews,
            favorite_workspaces: state.favoriteWorkspaces,
            ...(state.defaultTokenizerModel !== null
              ? { default_tokenizer_model: state.defaultTokenizerModel }
              : {}),
            ldaca_oni_api_token: state.ldacaOniApiToken,
            analysis_multi_tab_enabled: state.analysisMultiTabEnabled,
          };
          try {
            await updatePreferences({
              body,
              headers: getAuthorizationHeaders(headers),
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
        partialize: (state) => ({
          hiddenViews: state.hiddenViews,
          favoriteWorkspaces: state.favoriteWorkspaces,
          defaultTokenizerModel: state.defaultTokenizerModel,
          ldacaOniApiToken: state.ldacaOniApiToken,
          analysisMultiTabEnabled: state.analysisMultiTabEnabled,
        }),
      },
    ),
    { name: 'preferences-store' },
  ),
);
