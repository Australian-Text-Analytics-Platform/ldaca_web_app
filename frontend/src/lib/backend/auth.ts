import {
  getAuthInfoApiAuthGet,
  googleAuthApiAuthGooglePost,
  logoutApiAuthLogoutPost,
} from '@/api/generated/sdk.gen';
import type { AuthInfoResponse, GoogleOut } from '@/api/generated/types.gen';

export type { AuthInfoResponse };
export type GoogleAuthResponse = GoogleOut;

const timeoutSignal = (timeoutMs?: number): AbortSignal | undefined => {
  if (!timeoutMs) return undefined;
  return AbortSignal.timeout(timeoutMs);
};

export const authApi = {
  googleAuth: async (idToken: string): Promise<GoogleAuthResponse> => {
    const { data } = await googleAuthApiAuthGooglePost({
      body: { id_token: idToken },
      throwOnError: true,
    });
    return data;
  },
  info: async (
    authHeaders: Record<string, string> = {},
    options?: { timeoutMs?: number },
  ): Promise<AuthInfoResponse> => {
    const { data } = await getAuthInfoApiAuthGet({
      headers: authHeaders,
      signal: timeoutSignal(options?.timeoutMs),
      throwOnError: true,
    });
    return data;
  },
  logout: async (authHeaders: Record<string, string> = {}): Promise<unknown> => {
    const { data } = await logoutApiAuthLogoutPost({ headers: authHeaders, throwOnError: true });
    return data;
  },
};