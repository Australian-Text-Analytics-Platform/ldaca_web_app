import { getConfigApiConfigGet, updateConfigApiConfigPost } from './generated/sdk.gen';
import type { ConfigResponse, ConfigUpdate } from './generated/types.gen';

export type { ConfigResponse };
export type UpdateConfigRequest = ConfigUpdate;

export const configApi = {
  getConfig: async (): Promise<ConfigResponse> => {
    const { data } = await getConfigApiConfigGet({ throwOnError: true });
    return data;
  },
  updateConfig: async (data: UpdateConfigRequest): Promise<ConfigResponse> => {
    const response = await updateConfigApiConfigPost({ body: data, throwOnError: true });
    return response.data;
  },
};
