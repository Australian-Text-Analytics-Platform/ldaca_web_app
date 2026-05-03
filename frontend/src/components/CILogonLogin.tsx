import { getApiBase } from '@/api/env';

interface CILogonLoginProps {
  isLoading?: boolean;
  error?: string | null;
}

/**
 * CILogon OIDC sign-in button. Clicking redirects to the backend's
 * /api/auth/cilogon/login endpoint which initiates the authorization code
 * flow and bounces the user to CILogon. On success CILogon redirects back
 * to /api/auth/cilogon/callback which issues a local session and sends the
 * browser back to the SPA with auth_token in the URL.
 */
function CILogonLogin({ isLoading, error }: CILogonLoginProps) {
  const loginUrl = `${getApiBase()}/auth/cilogon/login`;

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      <a href={loginUrl} className="block">
        <button
          type="button"
          className="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-gray-300 rounded-md bg-white text-gray-700 text-sm font-medium shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
        >
          <img
            src="https://www.cilogon.org/favicon.ico"
            alt=""
            className="w-5 h-5"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          Sign in with CILogon
        </button>
      </a>

      {isLoading && (
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
          <span className="text-sm text-gray-600">Signing in...</span>
        </div>
      )}
    </div>
  );
}

export default CILogonLogin;
