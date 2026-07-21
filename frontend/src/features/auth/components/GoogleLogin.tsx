import { GoogleLogin as OAuthGoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProviderCard } from '@/features/auth/components/AuthProviderCard';
import { buildGoogleLoginUri } from '@/features/auth/authRedirectUrls';
import { useAuth } from '@/features/auth/hooks/useAuth';

interface GoogleLoginProps {
  isLoading?: boolean;
  error?: string | null;
}

export default function GoogleLogin({ isLoading, error }: GoogleLoginProps) {
  const loginUri = buildGoogleLoginUri();
  const { authInfo } = useAuth();
  const injectedClientId = authInfo?.google_client_id?.trim();
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- empty runtime/build values intentionally fall through */
  const clientId =
    injectedClientId ||
    import.meta.env.VITE_GOOGLE_CLIENT_ID ||
    '460163662698-lof601jcnsk9ugjjr3dpjqn31bv6krem.apps.googleusercontent.com';
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

  return (
    <GoogleOAuthProvider clientId={clientId}>
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
    </GoogleOAuthProvider>
  );
}
