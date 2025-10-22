import { post, get } from './http';

export interface GoogleAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  last_login: string;
}

export interface UserMeResponse {
  user: User;
  authenticated: boolean;
  expires_at: string;
  data_folder?: string; // Only present in single-user mode
}

export const authApi = {
  googleAuth: (idToken: string) => post<GoogleAuthResponse>('/auth/google', { id_token: idToken }),
  status: (authHeaders: Record<string,string> = {}) => get<UserMeResponse>('/auth/status', authHeaders),
  logout: (authHeaders: Record<string,string> = {}) => post('/auth/logout', {}, authHeaders),
};

export type { GoogleAuthResponse as GoogleAuthResponseType };