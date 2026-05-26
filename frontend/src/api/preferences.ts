import { getPreferencesApiPreferencesGet, updatePreferencesApiPreferencesPut } from './generated/sdk.gen';
import type { UserPreferences as GeneratedUserPreferences } from './generated/types.gen';
import type { QuotationEngineConfig } from './text';

export interface QuotationPreferences {
  engine: QuotationEngineConfig;
  last_remote_url: string;
}

export interface UserPreferences {
  hidden_views: string[];
  favorite_workspaces: string[];
  quotation: QuotationPreferences;
  // Phase 4.1: per-user multilingual defaults. ``null`` falls back to the
  // backend's per-request resolution chain (request → tokenization → "en").
  // Persisted alongside the rest of the prefs blob.
  default_language: string | null;
  default_tokenizer_model: string | null;
  ldaca_oni_api_token: string | null;
  /** Master switch for the demo-snapshot feature. When false, the
   * Save/Load buttons in every analytic tool are unmounted. Default
   * false. See ``features/snapshot-view`` / plan §3.6. */
  demo_snapshots_enabled: boolean;
}

export type UserPreferencesUpdate = Partial<UserPreferences>;

const getAuthorizationHeaders = (headers?: Record<string, string>): { authorization?: string } | undefined => {
  const authorization = headers?.Authorization ?? headers?.authorization;
  return authorization ? { authorization } : undefined;
};

const normalizePreferences = (data: GeneratedUserPreferences): UserPreferences => ({
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

export const preferencesApi = {
  get: async (headers?: Record<string, string>): Promise<UserPreferences> => {
    const { data } = await getPreferencesApiPreferencesGet({
      headers: getAuthorizationHeaders(headers),
      throwOnError: true,
    });
    return normalizePreferences(data);
  },

  update: async (body: UserPreferencesUpdate, headers?: Record<string, string>): Promise<UserPreferences> => {
    const response = await updatePreferencesApiPreferencesPut({
      body,
      headers: getAuthorizationHeaders(headers),
      throwOnError: true,
    });
    return normalizePreferences(response.data);
  },
};
