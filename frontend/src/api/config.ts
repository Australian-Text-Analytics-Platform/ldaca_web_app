import { httpRequest } from './http';

export interface ConfigResponse {
  data_root: string;
  multi_user_mode: boolean;
}

export interface UpdateConfigRequest {
  data_root: string;
}

export const configApi = {
  getConfig: () => httpRequest<ConfigResponse>('/config/', { method: 'GET' }),
  updateConfig: (data: UpdateConfigRequest) => httpRequest<ConfigResponse>('/config/', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
};
