import { httpRequest } from './http';

export interface ConfigResponse {
  data_root: string;
  multi_user_mode: boolean;
  google_client_id?: string;
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
