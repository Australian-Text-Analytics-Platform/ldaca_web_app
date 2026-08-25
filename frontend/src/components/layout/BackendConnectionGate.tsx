import type { ReactNode } from 'react';

import BlockingScreen from '@/features/auth/components/BlockingScreen';
import { useBackendHealth } from '@/hooks/useBackendHealth';
import { useUIStore } from '@/stores/uiStore';
import { Button } from '@/components/ui/button';

/** Holds API-dependent application content until the active backend is configured and ready. */
export function BackendConnectionGate({ children }: { children: ReactNode }) {
  const { ready, error } = useBackendHealth();
  const openFeedback = useUIStore((state) => state.openFeedback);

  if (ready) return children;

  return (
    <BlockingScreen
      title="Starting backend services"
      description="Hang tight while we verify the backend is up and happy."
      status="Checking /health…"
      hint={
        error ? `Last error: ${error}` : 'If this takes more than ~30s, check the backend logs.'
      }
      actions={
        <Button
          type="button"
          onClick={() => {
            openFeedback();
          }}
        >
          Send feedback
        </Button>
      }
    />
  );
}
