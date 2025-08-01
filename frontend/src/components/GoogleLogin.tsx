import React from 'react';
import { GoogleLogin as OAuthGoogleLogin } from '@react-oauth/google';

interface GoogleLoginProps {
  onLogin: (idToken: string) => Promise<void>;
  onLogout: () => void;
  isLoading?: boolean;
  error?: string | null;
}

const GoogleLogin: React.FC<GoogleLoginProps> = ({ onLogin, onLogout, isLoading, error }) => {
  const handleGoogleSuccess = async (credentialResponse: any) => {
    try {
      if (credentialResponse.credential) {
        await onLogin(credentialResponse.credential);
      }
    } catch (error) {
      console.error('Google login failed:', error);
    }
  };

  const handleGoogleError = () => {
    console.error('Google Login Failed');
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}
      
      <OAuthGoogleLogin
        onSuccess={handleGoogleSuccess}
        onError={handleGoogleError}
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