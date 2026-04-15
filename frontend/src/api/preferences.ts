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
}

export type UserPreferencesUpdate = Partial<UserPreferences>;

export const preferencesApi = {
  get: (headers?: Record<string, string>) =>
    get<UserPreferences>('/preferences/', headers),

  update: (body: UserPreferencesUpdate, headers?: Record<string, string>) =>
    put<UserPreferences>('/preferences/', body, headers),
};
