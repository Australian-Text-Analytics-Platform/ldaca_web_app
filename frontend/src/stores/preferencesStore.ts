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
import type { UserPreferences, UserPreferencesUpdate } from '@/api/preferences';
import { preferencesApi } from '@/api/preferences';
import type { QuotationEngineConfig } from '@/api/text';
import type { ViewType } from '@/stores/uiStore';

const DEFAULT_HIDDEN_VIEWS: string[] = ['ai-annotator'];

interface PreferencesState {
  hiddenViews: string[];
  favoriteWorkspaces: string[];
  quotationEngine: QuotationEngineConfig;
  quotationLastRemoteUrl: string;
  /**
   * Phase 4.1: per-user multilingual defaults. ``null`` lets the backend
   * fall back to its per-request resolution chain
   * (request → derived metadata → "en"); set this when the user wants
   * every new corpus to default to their language without manual entry.
   */
  defaultLanguage: string | null;
  defaultTokenizerModel: string | null;
  ldacaOniApiToken: string | null;
  /** Master switch for the demo-snapshot feature. When false, every
   * tool's Save/Load button is unmounted via the shared
   * ``<AnalysisFeatureHeader>``. Default false; persisted to backend
   * preferences. See ``features/snapshot-view`` / plan §3.6. */
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
  /**
   * Phase 4.1: persist a language code (e.g. ``"zh"``) or ``null`` to
   * unset. Pairs with the AddFilePanel language selector and is honored by
   * the per-feature API request builders when their explicit
   * ``language`` field is unset.
   */
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

function applyServerState(state: PreferencesState, data: UserPreferences) {
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

        isFavorite: (workspaceId) => get().favoriteWorkspaces.includes(workspaceId),

        setQuotationEngine: (config) => {
          set((state) => {
            state.quotationEngine = config;
            if (config.type === 'remote' && config.url) {
              state.quotationLastRemoteUrl = config.url;
            }
          });
        },

        updateQuotationRemoteUrl: (url) => {
          const trimmed = url.trim();
          set((state) => {
            state.quotationLastRemoteUrl = trimmed;
            if (state.quotationEngine.type === 'remote') {
              state.quotationEngine = { type: 'remote', url: trimmed };
            }
          });
        },

        setDefaultLanguage: (language) => {
          // Normalise to a trimmed lowercase code so backend resolution
          // doesn't see stray case / whitespace from form inputs.
          const value =
            typeof language === 'string' && language.trim() ? language.trim().toLowerCase() : null;
          set((state) => {
            state.defaultLanguage = value;
          });
        },

        setDefaultTokenizerModel: (model) => {
          const value = typeof model === 'string' && model.trim() ? model.trim() : null;
          set((state) => {
            state.defaultTokenizerModel = value;
          });
        },

        setLdacaOniApiToken: (token) => {
          const value = typeof token === 'string' && token.trim() ? token.trim() : null;
          set((state) => {
            state.ldacaOniApiToken = value;
          });
        },

        setDemoSnapshotsEnabled: (enabled) => {
          set((state) => {
            state.demoSnapshotsEnabled = !!enabled;
          });
        },

        loadFromBackend: async (headers) => {
          try {
            const data = await preferencesApi.get(headers);
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
            await preferencesApi.update(body, headers);
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
