import { GoogleLogin as OAuthGoogleLogin } from '@react-oauth/google';
import { getApiBase } from '@/lib/backend/env';
import { AuthProviderCard } from '@/features/auth/components/AuthProviderCard';

interface GoogleLoginProps {
  isLoading?: boolean;
  error?: string | null;
}

export default function GoogleLogin({ isLoading, error }: GoogleLoginProps) {
  const loginUri = `${getApiBase()}/auth/google/callback`;

  return (
    <AuthProviderCard isLoading={isLoading} error={error}>
      <OAuthGoogleLogin
        onSuccess={() => {
          /* redirect mode handled server-side */
        }}
        ux_mode="redirect"
        login_uri={loginUri}
        size="large"
        text="signin_with"
        shape="rectangular"
        theme="outline"
      />
    </AuthProviderCard>
  );
}
