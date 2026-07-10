import type { NodeDataResponse, RuntimeConfigResponse, UserPreferences } from '@/api';

/** Builds backend runtime-config responses for MSW handlers while letting tests override fields. */
/** Used by: tests in this file. */
export const configResponse = (
  overrides: Partial<RuntimeConfigResponse> = {},
): RuntimeConfigResponse => ({
  multi_user_mode: false,
  ...overrides,
});

/**
 * Builds preference responses for auth/bootstrap consumers in frontend tests.
 */
export const preferencesResponse = (overrides: Partial<UserPreferences> = {}): UserPreferences => ({
  hidden_views: [],
  favorite_workspaces: [],
  default_tokenizer_model: null,
  ldaca_oni_api_token: null,
  analysis_multi_tab_enabled: false,
  annotation_ai: { api_keys: {}, custom_providers: [] },
  ...overrides,
});

/**
 * Builds a minimal paginated node-data response for shared component tests.
 * Used by: MSW handlers for generated node-data calls because language
 * detection, table, and selector tests need a normal backend-shaped page.
 * Flow: return one text row plus pagination/sorting metadata, then let tests
 * override fields for feature-specific fixtures.
 */
export const nodeDataResponse = (overrides: Partial<NodeDataResponse> = {}): NodeDataResponse => ({
  columns: ['text'],
  data: [{ text: 'This is an English sample document for language detection.' }],
  dtypes: { text: 'string' },
  revision: 'test-node-revision',
  filtering: { op: 'none' },
  pagination: {
    page: 1,
    page_size: 100,
    total_rows: 1,
    total_pages: 1,
    has_next: false,
    has_prev: false,
  },
  sorting: { descending: false, sort_by: null },
  ...overrides,
});
