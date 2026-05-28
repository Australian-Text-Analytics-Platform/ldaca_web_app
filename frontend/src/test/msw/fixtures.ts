import type { ConfigResponse, UserPreferences } from '@/api/generated/types.gen';

/** Builds backend config responses for MSW handlers while letting tests override fields. */
/** Used by: tests in this file because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
export const configResponse = (overrides: Partial<ConfigResponse> = {}): ConfigResponse => ({
  data_root: '/tmp/ldaca-wordflow',
  multi_user_mode: false,
  ...overrides,
});

/**
 * Builds preference responses for auth/bootstrap consumers in frontend tests.
 * Why: tests need stable fixtures and mocks before exercising the behavior under assertion.
 */
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