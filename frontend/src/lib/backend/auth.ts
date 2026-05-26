import {
  getAuthInfoApiAuthGet,
  googleAuthApiAuthGooglePost,
  logoutApiAuthLogoutPost,
} from '@/api/generated/sdk.gen';
import type { AuthInfoResponse, User } from '@/types';
import type { AuthInfoResponse as GeneratedAuthInfoResponse, GoogleOut } from '@/api/generated/types.gen';

export type { AuthInfoResponse };
export type GoogleAuthResponse = GoogleOut;

const timeoutSignal = (timeoutMs?: number): AbortSignal | undefined => {
  if (!timeoutMs) return undefined;
  return AbortSignal.timeout(timeoutMs);
};

const normalizeUser = (user: GeneratedAuthInfoResponse['user']): User | null => {
  if (!user) return null;
  return {
    ...user,
    created_at: user.created_at ?? undefined,
    is_active: user.is_active ?? undefined,
    is_verified: user.is_verified ?? undefined,
    last_login: user.last_login ?? undefined,
    picture: user.picture ?? null,
  };
};

const normalizeAuthInfo = (data: GeneratedAuthInfoResponse): AuthInfoResponse => ({
  authenticated: data.authenticated,
  available_auth_methods: data.available_auth_methods ?? [],
  data_folder: data.data_folder ?? undefined,
  requires_authentication: data.requires_authentication,
  user: normalizeUser(data.user),
});

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
    return normalizeAuthInfo(data);
  },
  logout: async (authHeaders: Record<string, string> = {}): Promise<unknown> => {
    const { data } = await logoutApiAuthLogoutPost({ headers: authHeaders, throwOnError: true });
    return data;
  },
};