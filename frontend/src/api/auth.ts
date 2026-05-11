import { type AuthInfoResponse } from '../types';
import { post, httpRequest } from './http';

export interface GoogleAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export const authApi = {
  googleAuth: (idToken: string) => post<GoogleAuthResponse>('/auth/google', { id_token: idToken }),
  info: (
    authHeaders: Record<string, string> = {},
    options?: { timeoutMs?: number },
  ) => httpRequest<AuthInfoResponse>('/auth/', {
    method: 'GET',
    headers: authHeaders,
    timeoutMs: options?.timeoutMs,
  }),
  logout: (authHeaders: Record<string,string> = {}) => post('/auth/logout', {}, authHeaders),
};