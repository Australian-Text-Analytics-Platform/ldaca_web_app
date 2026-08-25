import { AuthProviderCard } from '@/features/auth/components/AuthProviderCard';
import { buildCilogonLoginUrl } from '@/features/auth/authRedirectUrls';
import { Button } from '@/components/ui/button';

interface CILogonLoginProps {
  isLoading?: boolean;
  error?: string | null;
}

export default function CILogonLogin({ isLoading, error }: CILogonLoginProps) {
  const loginUrl = buildCilogonLoginUrl();

  return (
    <AuthProviderCard isLoading={isLoading} error={error}>
      <Button asChild variant="secondary" className="w-full">
        <a href={loginUrl}>
          <img
            src="https://www.cilogon.org/favicon.ico"
            alt=""
            className="w-5 h-5"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          Sign in with CILogon
        </a>
      </Button>
    </AuthProviderCard>
  );
}
