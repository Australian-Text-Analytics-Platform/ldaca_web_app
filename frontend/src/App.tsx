import { useState, useEffect } from 'react';
import { AuthBootstrap, useAuth } from '@/features/auth/hooks/useAuth';
import { getBlockingCopy } from '@/features/auth/authPhaseCopy';
import BlockingScreen from '@/features/auth/components/BlockingScreen';
import { LoginScreen } from '@/features/auth/components/LoginScreen';
import { LAG_HINT_DELAY_MS } from '@/config/timings';
import { loadRemoteRegistry } from '@/tutorials/remoteRegistry';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { GlobalHosts } from '@/components/layout/GlobalHosts';
import { BackendBootstrapGate } from '@/components/layout/BackendBootstrapGate';
import { DesktopWindowFrame } from '@/components/layout/DesktopWindowFrame';
import { Button } from '@/components/ui/button';

function App() {
  return <AppContent />;
}

function AppContent() {
  useEffect(() => {
    void loadRemoteRegistry();
  }, []);

  return (
    <DesktopWindowFrame>
      <BackendBootstrapGate>
        <>
          <AuthBootstrap />
          <AuthGate />
        </>
      </BackendBootstrapGate>
      <GlobalHosts />
    </DesktopWindowFrame>
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
          <Button
            type="button"
            onClick={() => {
              void refreshAuth();
            }}
          >
            Retry connection
          </Button>
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
