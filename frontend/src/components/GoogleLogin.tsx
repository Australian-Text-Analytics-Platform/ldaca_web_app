import { GoogleLogin as OAuthGoogleLogin } from '@react-oauth/google';
import { getApiBase } from '@/api/env';

interface GoogleLoginProps {
  onLogin: (idToken: string) => Promise<void>;
  onLogout: () => void;
  isLoading?: boolean;
  error?: string | null;
}

function GoogleLogin({ onLogin: _onLogin, onLogout: _onLogout, isLoading, error }: GoogleLoginProps) {
  const loginUri = `${getApiBase()}/auth/google/callback`;

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}
      
      <OAuthGoogleLogin
        onSuccess={() => {/* redirect mode — handled server-side */}}
        ux_mode="redirect"
        login_uri={loginUri}
        size="large"
        text="signin_with"
        shape="rectangular"
        theme="outline"
      />
      
      {isLoading && (
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
          <span className="text-sm text-gray-600">Signing in...</span>
        </div>
      )}
    </div>
  );
};

export default GoogleLogin;