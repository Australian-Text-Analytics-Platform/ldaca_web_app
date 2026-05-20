import { httpRequest } from './http';

export interface ConfigResponse {
  data_root: string;
  multi_user_mode: boolean;
  google_client_id?: string;
  // TEMPORARY (Phase 2/2.5 local-testing aid) — surfaces the backend's
  // LDACA_LAZY_TOKENISE env flag so <LazyTokeniseDevBadge /> can render
  // a fixed-position dev indicator while the feature is being tested.
  // REMOVE BEFORE PUBLISH (Phase 3+): drop this field, the matching
  // backend field in api/config.py, the component, and its mount in
  // App.tsx. The lazy path itself stays.
  lazy_tokenise_enabled?: boolean;
}

export interface UpdateConfigRequest {
  data_root: string;
}

export const configApi = {
  getConfig: () => httpRequest<ConfigResponse>('/config/', { method: 'GET' }),
  updateConfig: (data: UpdateConfigRequest) => httpRequest<ConfigResponse>('/config/', {
    method: 'POST',
    body: data,
  }),
};
