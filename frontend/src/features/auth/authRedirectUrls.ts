import type { CilogonLoginData, GoogleAuthCallbackData } from '@/api';
import { getGeneratedApiBase } from '@/lib/backend/generatedClientConfig';

const GOOGLE_AUTH_CALLBACK_PATH: GoogleAuthCallbackData['url'] = '/api/auth/google/callback';
const CILOGON_LOGIN_PATH: CilogonLoginData['url'] = '/api/auth/cilogon/login';

/**
 * Builds browser-navigation URLs for generated auth redirect endpoints.
 * Used by: GoogleLogin and CILogonLogin because OAuth redirects need native
 * browser navigation while their endpoint paths should stay tied to OpenAPI.
 */
const buildAuthRedirectUrl = (path: GoogleAuthCallbackData['url'] | CilogonLoginData['url']) =>
  `${getGeneratedApiBase()}${path}`;

export const buildGoogleLoginUri = () => buildAuthRedirectUrl(GOOGLE_AUTH_CALLBACK_PATH);

export const buildCilogonLoginUrl = () => buildAuthRedirectUrl(CILOGON_LOGIN_PATH);
