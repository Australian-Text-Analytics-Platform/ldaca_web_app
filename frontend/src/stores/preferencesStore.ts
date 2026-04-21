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
  setQuotationLastRemoteUrl: (url: string) => void;
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
          // Fire-and-forget sync
          const { syncToBackend } = get();
          syncToBackend().catch(() => {});
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
          const { syncToBackend } = get();
          syncToBackend().catch(() => {});
        },

        isFavorite: (workspaceId) => get().favoriteWorkspaces.includes(workspaceId),

        setQuotationEngine: (config) => {
          set((state) => {
            state.quotationEngine = config;
            if (config.type === 'remote' && config.url) {
              state.quotationLastRemoteUrl = config.url;
            }
          });
          const { syncToBackend } = get();
          syncToBackend().catch(() => {});
        },

        setQuotationLastRemoteUrl: (url) => {
          set((state) => {
            state.quotationLastRemoteUrl = url;
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
          set((s) => { s.syncing = true; });
          const body: UserPreferencesUpdate = {
            hidden_views: state.hiddenViews,
            favorite_workspaces: state.favoriteWorkspaces,
            quotation: {
              engine: state.quotationEngine,
              last_remote_url: state.quotationLastRemoteUrl,
            },
          };
          try {
            await preferencesApi.update(body, headers);
          } catch {
            // Silently fail — localStorage still has the latest state
          } finally {
            set((s) => { s.syncing = false; });
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
        }),
      }
    ),
    { name: 'preferences-store' }
  )
);
