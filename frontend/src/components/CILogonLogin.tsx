import { getApiBase } from '@/lib/backend/env';
import { AuthProviderCard } from '@/components/startup/AuthProviderCard';

interface CILogonLoginProps {
  isLoading?: boolean;
  error?: string | null;
}

export default function CILogonLogin({ isLoading, error }: CILogonLoginProps) {
  const loginUrl = `${getApiBase()}/auth/cilogon/login`;

  return (
    <AuthProviderCard isLoading={isLoading} error={error}>
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
    </AuthProviderCard>
  );
}
