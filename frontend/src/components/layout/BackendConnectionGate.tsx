import type { ReactNode } from 'react';

import BlockingScreen from '@/features/auth/components/BlockingScreen';
import { useBackendHealth } from '@/hooks/useBackendHealth';
import { useUIStore } from '@/stores/uiStore';

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
        <button
          type="button"
          onClick={() => {
            openFeedback();
          }}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          Send feedback
        </button>
      }
    />
  );
}
