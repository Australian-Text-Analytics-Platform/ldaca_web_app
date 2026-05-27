import { getConfigApiConfigGet, updateConfigApiConfigPost } from '@/api/generated/sdk.gen';
import type { ConfigResponse, ConfigUpdate } from '@/api/generated/types.gen';

export type { ConfigResponse };

export const configApi = {
  getConfig: async (): Promise<ConfigResponse> => {
    const { data } = await getConfigApiConfigGet({ throwOnError: true });
    return data;
  },
  updateConfig: async (data: ConfigUpdate): Promise<ConfigResponse> => {
    const response = await updateConfigApiConfigPost({ body: data, throwOnError: true });
    return response.data;
  },
};
