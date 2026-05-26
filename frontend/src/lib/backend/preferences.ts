import { getPreferencesApiPreferencesGet, updatePreferencesApiPreferencesPut } from '@/api/generated/sdk.gen';
import type {
  QuotationPreferences as GeneratedQuotationPreferences,
  UserPreferences as GeneratedUserPreferences,
  UserPreferencesUpdate as GeneratedUserPreferencesUpdate,
} from '@/api/generated/types.gen';
import type { QuotationEngineConfig } from './text';

export type QuotationPreferences = Omit<GeneratedQuotationPreferences, 'engine' | 'last_remote_url'> & {
  engine: QuotationEngineConfig;
  last_remote_url: string;
};

export type UserPreferences = Omit<
  GeneratedUserPreferences,
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
  quotation: QuotationPreferences;
  default_language: string | null;
  default_tokenizer_model: string | null;
  ldaca_oni_api_token: string | null;
  demo_snapshots_enabled: boolean;
};

export type UserPreferencesUpdate = GeneratedUserPreferencesUpdate;

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
