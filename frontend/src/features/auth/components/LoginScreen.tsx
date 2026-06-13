import logo from '@/logo.png';
import CILogonLogin from '@/features/auth/components/CILogonLogin';
import GoogleLogin from '@/features/auth/components/GoogleLogin';
import { ErrorBoundary } from '@/components/ErrorBoundary';

interface LoginScreenProps {
  isLoading?: boolean;
  error?: string | null;
  authMethods?: { name: string; display_name: string; enabled: boolean }[];
}

/**
 * Multi-provider login screen rendered when the backend requires interactive
 * sign-in. It chooses the enabled provider button from backend auth metadata
 * and wraps it in `ErrorBoundary` so OAuth widget failures stay recoverable.
 * Rendered by: App while auth state requires interactive login because provider widgets should fail inside the card, not the app shell.
 * Flow: inspect enabled auth methods, choose the provider label and button, wrap OAuth UI in ErrorBoundary, then render the branded sign-in card.
 */
export function LoginScreen({ isLoading, error, authMethods = [] }: LoginScreenProps) {
  const hasCILogon = authMethods.some((m) => m.name === 'cilogon' && m.enabled);
  const hasGoogle = authMethods.some((m) => m.name === 'google' && m.enabled);
  const providerLabel = hasCILogon
    ? 'CILogon'
    : hasGoogle
      ? 'a Google account'
      : 'your institutional account';

  return (
    <div className="min-h-dvh bg-linear-to-br from-slate-50 via-slate-100 to-blue-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl text-center space-y-4 bg-white/80 backdrop-blur rounded-2xl shadow-2xl border border-white/60 px-10 py-12">
        <div className="flex justify-center">
          <img src={logo} alt="LDaCA Logo" className="h-16 w-auto object-contain drop-shadow" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-gray-900">Sign in to continue</h1>
          <p className="text-base text-gray-600">
            LDaCA Wordflow requires you to sign in with {providerLabel}.
          </p>
        </div>
        <ErrorBoundary>
          <div className="flex justify-center pt-2">
            {hasCILogon && <CILogonLogin isLoading={isLoading} error={error} />}
            {hasGoogle && !hasCILogon && <GoogleLogin isLoading={isLoading} error={error} />}
          </div>
        </ErrorBoundary>
      </div>
    </div>
  );
}
