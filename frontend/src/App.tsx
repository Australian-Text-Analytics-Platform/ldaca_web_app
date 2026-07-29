import { useState, useEffect } from 'react';
import { AuthBootstrap, useAuth } from '@/features/auth/hooks/useAuth';
import { useBackendHealth } from '@/hooks/useBackendHealth';
import { useUIStore } from '@/stores';
import { getBlockingCopy } from '@/features/auth/authPhaseCopy';
import BlockingScreen from '@/features/auth/components/BlockingScreen';
import { LoginScreen } from '@/features/auth/components/LoginScreen';
import { LAG_HINT_DELAY_MS } from '@/config/timings';
import { loadRemoteRegistry } from '@/tutorials/remoteRegistry';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { GlobalHosts } from '@/components/layout/GlobalHosts';

function App() {
  return <AppContent />;
}

function AppContent() {
  useEffect(() => {
    void loadRemoteRegistry();
  }, []);

  const { ready: backendReady, error: backendError } = useBackendHealth();
  const openFeedback = useUIStore((state) => state.openFeedback);

  return (
    <>
      {!backendReady ? (
        <BlockingScreen
          title="Starting backend services"
          description="Hang tight while we verify the backend is up and happy."
          status="Checking /health…"
          hint={
            backendError
              ? `Last error: ${backendError}`
              : 'If this takes more than ~30s, check the backend logs.'
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
      ) : (
        <>
          <AuthBootstrap />
          <AuthGate />
        </>
      )}
      <GlobalHosts />
    </>
  );
}

/** Auth gating: blocks on bootstrapping, shows login, or renders the workspace shell. */
function AuthGate() {
  const {
    phase,
    isAuthenticated,
    isMultiUserMode,
    isLoading: authLoading,
    error: authError,
    refreshAuth,
    availableAuthMethods,
  } = useAuth();

  const [laggingHintReady, setLaggingHintReady] = useState(false);
  const showLaggingHint = laggingHintReady && phase.status === 'bootstrapping';

  useEffect(() => {
    if (phase.status !== 'bootstrapping') return;
    const timeoutId = window.setTimeout(() => {
      setLaggingHintReady(true);
    }, LAG_HINT_DELAY_MS);
    return () => {
      window.clearTimeout(timeoutId);
      setLaggingHintReady(false);
    };
  }, [phase.status]);

  const blockingCopy = getBlockingCopy(phase, showLaggingHint);
  const shouldShowLoginCard =
    isMultiUserMode && !isAuthenticated && phase.status !== 'bootstrapping';

  if (blockingCopy) {
    return (
      <BlockingScreen
        title={blockingCopy.title}
        description={blockingCopy.description}
        status={blockingCopy.status}
        hint={blockingCopy.hint}
        error={blockingCopy.error}
        actions={
          <button
            type="button"
            onClick={() => {
              void refreshAuth();
            }}
            className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white shadow hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            Retry connection
          </button>
        }
      />
    );
  }

  if (shouldShowLoginCard) {
    return (
      <LoginScreen isLoading={authLoading} error={authError} authMethods={availableAuthMethods} />
    );
  }

  return <WorkspaceShell />;
}

export default App;
