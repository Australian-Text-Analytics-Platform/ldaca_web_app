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
  // backend's per-request resolution chain (request → derived → "en").
  // Persisted alongside the rest of the prefs blob.
  default_language: string | null;
  default_tokenizer_model: string | null;
}

export type UserPreferencesUpdate = Partial<UserPreferences>;

export const preferencesApi = {
  get: (headers?: Record<string, string>) =>
    get<UserPreferences>('/preferences/', headers),

  update: (body: UserPreferencesUpdate, headers?: Record<string, string>) =>
    put<UserPreferences>('/preferences/', body, headers),
};
