import type { ConfigResponse, UserPreferences } from '@/api/generated/types.gen';

export const configResponse = (overrides: Partial<ConfigResponse> = {}): ConfigResponse => ({
  data_root: '/tmp/ldaca-wordflow',
  multi_user_mode: false,
  ...overrides,
});

export const preferencesResponse = (overrides: Partial<UserPreferences> = {}): UserPreferences => ({
  hidden_views: [],
  favorite_workspaces: [],
  quotation: {
    engine: { type: 'local' },
    last_remote_url: '',
  },
  default_language: null,
  default_tokenizer_model: null,
  ldaca_oni_api_token: null,
  demo_snapshots_enabled: false,
  ...overrides,
});