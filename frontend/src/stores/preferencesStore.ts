/**
 * User preferences store. State is persisted to `localStorage` via the
 * `persist` middleware and to the backend via a debounced subscriber set
 * up in `usePreferencesInit` (`hooks/usePreferences.ts`):
 *
 *   - Setters update local state only. They do *not* call
 *     `syncToBackend` directly.
 *   - The init hook subscribes to changes after `hydrated` flips true,
 *     coalesces bursts via a 800 ms debounce, and pushes the latest
 *     snapshot using auth headers from the React-side `useAuth`.
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
import { getPreferences, updatePreferences } from '@/api/generated/sdk.gen';
import type {
  LdacaWordflowModelsQuotationEngineConfig,
  QuotationPreferencesOutput,
  UserPreferences,
  UserPreferencesUpdate,
} from '@/api/generated/types.gen';
import type { ViewType } from '@/stores/uiStore';

const DEFAULT_HIDDEN_VIEWS: string[] = ['ai-annotator'];
type QuotationEngineConfig = LdacaWordflowModelsQuotationEngineConfig;

interface PreferencesState {
  hiddenViews: string[];
  favoriteWorkspaces: string[];
  quotationEngine: QuotationEngineConfig;
  quotationLastRemoteUrl: string;
  /** ``null`` lets the backend fall back to its per-request language resolver. */
  defaultLanguage: string | null;
  defaultTokenizerModel: string | null;
  ldacaOniApiToken: string | null;
  /** Master switch for the demo-snapshot feature. When false, every
   * tool's Save/Load button is unmounted via the shared
  * ``<AnalysisFeatureHeader>``. Default false; persisted to backend
  * preferences. */
  demoSnapshotsEnabled: boolean;
  /** True once the first backend fetch completes */
  hydrated: boolean;
  /** True while a backend sync is in-flight */
  syncing: boolean;
}

interface PreferencesActions {
  setViewHidden: (view: ViewType, hidden: boolean) => void;
  toggleFavorite: (workspaceId: string) => void;
  isFavorite: (workspaceId: string) => boolean;
  setQuotationEngine: (config: QuotationEngineConfig) => void;
  /**
   * Trim and write the remote URL. If the engine is currently in remote mode,
   * the engine config's `url` field is updated alongside `lastRemoteUrl` so a
   * single call keeps the two in sync.
   */
  updateQuotationRemoteUrl: (url: string) => void;
  /** Persist a language code (e.g. ``"zh"``) or ``null`` to unset. */
  setDefaultLanguage: (language: string | null) => void;
  setDefaultTokenizerModel: (model: string | null) => void;
  setLdacaOniApiToken: (token: string | null) => void;
  setDemoSnapshotsEnabled: (enabled: boolean) => void;
  /** Fetch preferences from backend and hydrate the store */
  loadFromBackend: (headers?: Record<string, string>) => Promise<void>;
  /** Push current state to backend */
  syncToBackend: (headers?: Record<string, string>) => Promise<void>;
}

type PreferencesStore = PreferencesState & PreferencesActions;

type ResolvedQuotationPreferences = Omit<QuotationPreferencesOutput, 'engine' | 'last_remote_url'> & {
  engine: QuotationEngineConfig;
  last_remote_url: string;
};

type ResolvedUserPreferences = Omit<
  UserPreferences,
  | 'default_language'
  | 'default_tokenizer_model'
  | 'demo_snapshots_enabled'
  | 'favorite_workspaces'
  | 'hidden_views'
  | 'ldaca_oni_api_token'
  | 'quotation'
> & {
  hidden_views: string[];
  favorite_workspaces: string[];
  quotation: ResolvedQuotationPreferences;
  default_language: string | null;
  default_tokenizer_model: string | null;
  ldaca_oni_api_token: string | null;
  demo_snapshots_enabled: boolean;
};

/** Converts frontend auth header casing to the generated preferences client contract. */
/** Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
const getAuthorizationHeaders = (headers?: Record<string, string>): { authorization?: string } | undefined => {
  const authorization = headers?.Authorization ?? headers?.authorization;
  return authorization ? { authorization } : undefined;
};

/** Applies backend defaults so the store always works with concrete preference fields. */
/**
 * Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
 * Flow: fill missing backend arrays, quotation fields, language/tokenizer choices, token, and demo flag with concrete frontend defaults.
 */
const normalizePreferences = (data: UserPreferences): ResolvedUserPreferences => ({
  hidden_views: data.hidden_views ?? [],
  favorite_workspaces: data.favorite_workspaces ?? [],
  quotation: {
    engine: (data.quotation?.engine ?? { type: 'local' }) as QuotationEngineConfig,
    last_remote_url: data.quotation?.last_remote_url ?? '',
  },
  default_language: data.default_language ?? null,
  default_tokenizer_model: data.default_tokenizer_model ?? null,
  ldaca_oni_api_token: data.ldaca_oni_api_token ?? null,
  demo_snapshots_enabled: data.demo_snapshots_enabled ?? false,
});

/** Hydrates persisted preference fields into the immer draft after a successful backend load. */
/**
 * Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates.
 * Flow: copy resolved backend preference fields into the draft store state, then mark hydration complete for subscribers.
 */
function applyServerState(state: PreferencesState, data: ResolvedUserPreferences) {
  state.hiddenViews = data.hidden_views;
  state.favoriteWorkspaces = data.favorite_workspaces;
  state.quotationEngine = data.quotation.engine;
  state.quotationLastRemoteUrl = data.quotation.last_remote_url;
  state.defaultLanguage = data.default_language;
  state.defaultTokenizerModel = data.default_tokenizer_model;
  state.ldacaOniApiToken = data.ldaca_oni_api_token;
  state.demoSnapshotsEnabled = data.demo_snapshots_enabled;
  state.hydrated = true;
}

export const usePreferencesStore = create<PreferencesStore>()(
  devtools(
    persist(
      immer((set, get) => ({
        hiddenViews: [...DEFAULT_HIDDEN_VIEWS],
        favoriteWorkspaces: [],
        quotationEngine: { type: 'local' } as QuotationEngineConfig,
        quotationLastRemoteUrl: '',
        defaultLanguage: null,
        defaultTokenizerModel: null,
        ldacaOniApiToken: null,
        demoSnapshotsEnabled: false,
        hydrated: false,
        syncing: false,

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

        /** Stores the active quotation extraction engine configuration from the settings dialog. */
        /** Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        setQuotationEngine: (config) => {
          set((state) => {
            state.quotationEngine = config;
            if (config.type === 'remote' && config.url) {
              state.quotationLastRemoteUrl = config.url;
            }
          });
        },

        /** Updates the remembered remote quotation URL and active remote engine together. */
        /** Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        updateQuotationRemoteUrl: (url) => {
          const trimmed = url.trim();
          set((state) => {
            state.quotationLastRemoteUrl = trimmed;
            if (state.quotationEngine.type === 'remote') {
              state.quotationEngine = { type: 'remote', url: trimmed };
            }
          });
        },

        /** Stores the user's default language for language-aware analysis controls. */
        /** Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        setDefaultLanguage: (language) => {
          // Normalise to a trimmed lowercase code so backend resolution
          // doesn't see stray case / whitespace from form inputs.
          const value =
            typeof language === 'string' && language.trim() ? language.trim().toLowerCase() : null;
          set((state) => {
            state.defaultLanguage = value;
          });
        },

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

        /** Enables or disables demo snapshot controls across analysis feature headers. */
        /** Consumed by: usePreferencesStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
        setDemoSnapshotsEnabled: (enabled) => {
          set((state) => {
            state.demoSnapshotsEnabled = !!enabled;
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
            });
          } catch {
            // Backend unavailable — keep localStorage state; mark hydrated so UI isn't blocked
            set((state) => {
              state.hydrated = true;
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
            quotation: {
              engine: state.quotationEngine,
              last_remote_url: state.quotationLastRemoteUrl,
            },
            // Backend's partial-update contract treats ``null`` as
            // "no change". To avoid losing a previously-set value when
            // the user hasn't touched the language UI this session, only
            // include the field when the user explicitly has one.
            ...(state.defaultLanguage !== null ? { default_language: state.defaultLanguage } : {}),
            ...(state.defaultTokenizerModel !== null
              ? { default_tokenizer_model: state.defaultTokenizerModel }
              : {}),
            ldaca_oni_api_token: state.ldacaOniApiToken,
            demo_snapshots_enabled: state.demoSnapshotsEnabled,
          };
          try {
            await updatePreferences({
              body,
              headers: getAuthorizationHeaders(headers),
              throwOnError: true,
            });
          } catch {
            // Silently fail — localStorage still has the latest state
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
          quotationEngine: state.quotationEngine,
          quotationLastRemoteUrl: state.quotationLastRemoteUrl,
          defaultLanguage: state.defaultLanguage,
          defaultTokenizerModel: state.defaultTokenizerModel,
          ldacaOniApiToken: state.ldacaOniApiToken,
          demoSnapshotsEnabled: state.demoSnapshotsEnabled,
        }),
      },
    ),
    { name: 'preferences-store' },
  ),
);
