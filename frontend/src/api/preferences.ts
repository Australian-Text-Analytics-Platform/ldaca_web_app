import { get, put } from './http';
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

export const preferencesApi = {
  get: (headers?: Record<string, string>) => get<UserPreferences>('/preferences/', headers),

  update: (body: UserPreferencesUpdate, headers?: Record<string, string>) =>
    put<UserPreferences>('/preferences/', body, headers),
};
