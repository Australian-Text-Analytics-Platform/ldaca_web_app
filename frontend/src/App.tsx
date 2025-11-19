import { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { useAuth } from './hooks/useAuth';
import { useBackendHealth } from './hooks/useBackendHealth';
import { QueryProvider } from './providers/QueryProvider';
import { WorkspaceProvider } from './providers/WorkspaceProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import GoogleLogin from './components/GoogleLogin';
import { WorkspaceView, Sidebar } from './components/layout';
import BlockingScreen from './components/startup/BlockingScreen';
import FeedbackPanel from './components/panels/FeedbackPanel';
import { useUIStore } from './stores';
import { useShallow } from 'zustand/react/shallow';
import { SidebarInset, SidebarProvider, SidebarTrigger } from './components/ui/sidebar';

// Lazy load components for code splitting
const TutorialView = lazy(() => import('./components/TutorialView'));
const DataLoaderTab = lazy(() => import('./components/tabs/DataLoaderTab'));
const DataPreprocessingTab = lazy(() => import('./components/tabs/DataPreprocessingTab'));
const ConcordanceTab = lazy(() => import('./components/tabs/ConcordanceTab'));
const QuotationTab = lazy(() => import('./components/tabs/QuotationTab'));
const TopicModelingTab = lazy(() => import('./components/tabs/TopicModelingTab'));
const SequentialAnalysisTab = lazy(() => import('./components/tabs/SequentialAnalysisTab'));
const ExportTab = lazy(() => import('./components/tabs/ExportTab'));
const TokenFrequencyTab = lazy(() => import('./components/tabs/TokenFrequencyTab'));

/**
 * Shell that renders the main workspace experience once the backend is healthy
 * and the user has completed authentication (if required).
 */
const WorkspaceShell: React.FC = () => {
  const {
    currentView,
    closeFeedbackModal,
    feedbackOpen,
  } = useUIStore(useShallow((state) => ({
    currentView: state.currentView,
    closeFeedbackModal: state.closeFeedbackModal,
    feedbackOpen: state.modals.feedbackModal,
  })));
  const {
    loginWithGoogle,
    logout,
    isAuthenticated,
    isMultiUserMode,
    isLoading: authLoading,
    error: authError,
    refreshAuth,
  } = useAuth({ autoStart: false, debugLabel: 'WorkspaceShell' });
  if (import.meta.env.DEV) {
    console.debug('[WorkspaceShell] auth state', JSON.stringify({
      authLoading,
      authError,
      isAuthenticated,
      isMultiUserMode,
    }));
  }
  const [authLagging, setAuthLagging] = useState(false);

  // Right panel width and resize handlers must be declared before any early returns (React Hooks rule)
  const [rightWidth, setRightWidth] = useState<number>(40); // percentage of total width
  const [lastRightWidth, setLastRightWidth] = useState<number>(40); // remember last width when collapsing
  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const rightWidthLiveRef = useRef<number>(rightWidth);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (!authLoading) {
      setAuthLagging(false);
      return;
    }

    const timeoutId = window.setTimeout(() => setAuthLagging(true), 8000);
    return () => window.clearTimeout(timeoutId);
  }, [authLoading]);
  const onStartResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isRightCollapsed) return; // don't resize when collapsed
    setIsResizing(true);
    let rafId: number | null = null;
    // Capture starting state to compute deltas (prevents jump on first move)
    const startX = e.clientX;
    const startPct = rightWidth;
    const onMove = (ev: MouseEvent) => {
      if (!layoutRef.current) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!layoutRef.current) return;
        const rect = layoutRef.current.getBoundingClientRect();
        // Compute delta from initial drag position to avoid any jump
        const dx = ev.clientX - startX;
        const deltaPct = -(dx / rect.width) * 100; // moving right shrinks right panel
        const pctRight = Math.min(80, Math.max(20, startPct + deltaPct));
        rightWidthLiveRef.current = pctRight;
        // Apply widths directly to avoid React rerenders during drag
        const mainEl = mainRef.current;
        const asideEl = asideRef.current;
        if (mainEl && !isRightCollapsed) {
          mainEl.style.width = `${100 - pctRight}%`;
        }
        if (asideEl && !isRightCollapsed) {
          asideEl.style.width = `${pctRight}%`;
        }
      });
    };
    const onUp = () => {
      setIsResizing(false);
      // flush any pending frame
      if (rafId !== null) cancelAnimationFrame(rafId);
      // Commit the final width to state once
      const finalPct = rightWidthLiveRef.current ?? rightWidth;
      setRightWidth(finalPct);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isRightCollapsed, rightWidth, setIsResizing, setRightWidth, layoutRef]);

  // Collapse/expand the entire right panel (Outlook-like behavior)
  const toggleRightPanel = useCallback(() => {
    setIsRightCollapsed((prev) => {
      const next = !prev;
      if (next) {
        setLastRightWidth(rightWidth);
      } else {
        // restore previous width
        setRightWidth((w) => (w === 0 ? lastRightWidth || 40 : w));
      }
      return next;
    });
  }, [rightWidth, lastRightWidth]);

  if (authLoading) {
    return (
      <BlockingScreen
        title="Signing you in"
        description="The backend is healthy; finishing the authentication handshake."
        status={authLagging ? 'Still waiting for auth…' : 'Checking your session…'}
        hint={authLagging ? 'This can happen if backend migrations are still running. You can retry below.' : 'This usually takes just a moment.'}
        error={authError}
        actions={(
          <button
            type="button"
            onClick={refreshAuth}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white font-medium shadow hover:bg-blue-700 focus-visible:outline-offset-2 focus-visible:outline-blue-500 focus-visible:outline-2"
          >
            Retry connection
          </button>
        )}
      />
    );
  }

  // Show login screen if not authenticated and in multi-user mode
  if (!isAuthenticated && isMultiUserMode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <ErrorBoundary>
          <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full mx-4">
            <h1 className="text-2xl font-bold text-gray-800 mb-6 text-center">
              LDaCA Corpus Analysis Platform
            </h1>
            <GoogleLogin 
              onLogin={loginWithGoogle} 
              onLogout={logout}
              isLoading={authLoading}
              error={authError}
            />
          </div>
        </ErrorBoundary>
      </div>
    );
  }

  // (removed duplicate resize hook block)

  return (
    <QueryProvider>
      <WorkspaceProvider>
        <ErrorBoundary>
          <SidebarProvider className="bg-gradient-to-br from-slate-50 to-blue-50">
            <div className="flex h-screen w-full overflow-hidden">
              <ErrorBoundary>
                <Sidebar />
              </ErrorBoundary>

              <SidebarInset className="flex h-screen flex-1 flex-col overflow-hidden bg-transparent">
                <FeedbackPanel open={feedbackOpen} onClose={closeFeedbackModal} />

                <header className="border-b border-border/40 bg-white px-4 py-3 md:hidden">
                  <div className="flex items-center justify-between">
                    <SidebarTrigger />
                  </div>
                </header>

                <div className="flex flex-1 flex-col overflow-hidden">
                  <div className="relative flex flex-1 overflow-hidden" ref={layoutRef}>
                    <main
                      ref={mainRef}
                      className={`relative h-full flex-1 overflow-y-auto p-6 ${isResizing ? 'transition-none' : 'transition-all duration-300 ease-in-out'}`}
                      style={{ width: isRightCollapsed ? '100%' : `${100 - rightWidth}%`, minWidth: 280 }}
                    >
                      <div className="w-full max-w-none mx-0">
                        <ErrorBoundary>
                          <Suspense fallback={
                            <div className="flex items-center justify-center py-12">
                              <div className="text-center">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
                                <p className="text-gray-600 text-sm">Loading...</p>
                              </div>
                            </div>
                          }>
                            {currentView === 'data-loader' && <DataLoaderTab />}
                            {currentView === 'filter' && <DataPreprocessingTab />}
                            {currentView === 'token-frequency' && <TokenFrequencyTab />}
                            {currentView === 'concordance' && <ConcordanceTab />}
                            {currentView === 'analysis' && <SequentialAnalysisTab />}
                            {currentView === 'topic-modeling' && <TopicModelingTab />}
                            {currentView === 'quotation' && <QuotationTab />}
                            {currentView === 'export' && <ExportTab />}
                          </Suspense>
                        </ErrorBoundary>
                      </div>
                    </main>

                    {!isRightCollapsed && (
                      <div
                        className={`w-1 ${isResizing ? 'bg-gray-300' : 'bg-gray-200 hover:bg-gray-300'} cursor-col-resize`}
                        onMouseDown={onStartResize}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize right panel"
                      />
                    )}

                    <aside
                      ref={asideRef}
                      className={`relative flex h-full flex-col overflow-hidden bg-white border-l border-gray-200 ${isResizing ? 'transition-none' : 'transition-all duration-300 ease-in-out'} ${
                        isRightCollapsed ? 'min-w-0' : 'min-w-[320px]'
                      }`}
                      style={{ width: isRightCollapsed ? 0 : `${rightWidth}%` }}
                    >
                      {!isRightCollapsed && (
                        <button
                          onClick={toggleRightPanel}
                          className="group absolute top-2 right-2 z-20 rounded-md border border-gray-300 bg-white/80 backdrop-blur px-2 py-1 text-gray-700 hover:bg-gray-50 shadow-sm flex items-center"
                          aria-label="Collapse right panel"
                          title="Collapse"
                        >
                          <span className="overflow-hidden whitespace-nowrap transition-all duration-200 max-w-0 group-hover:max-w-[120px] mr-1">Collapse</span>
                          <span aria-hidden>❯</span>
                        </button>
                      )}
                      <ErrorBoundary>
                        {!isRightCollapsed && <WorkspaceView />}
                      </ErrorBoundary>
                    </aside>

                    {isRightCollapsed && (
                      <button
                        onClick={toggleRightPanel}
                        className="group absolute top-2 right-2 z-30 rounded-md border border-gray-300 bg-white/90 backdrop-blur px-2 py-1 text-gray-700 hover:bg-gray-50 shadow flex items-center"
                        aria-label="Expand right panel"
                        title="Expand"
                      >
                        <span className="overflow-hidden whitespace-nowrap transition-all duration-200 max-w-0 group-hover:max-w-[90px] mr-1">Show</span>
                        <span aria-hidden>❮</span>
                      </button>
                    )}
                  </div>
                </div>
              </SidebarInset>
            </div>
          </SidebarProvider>
        </ErrorBoundary>
      </WorkspaceProvider>
    </QueryProvider>
  );
};

/**
 * Top-level app entry that handles tutorial routing and backend health gating
 * before rendering the main workspace shell.
 */
const App: React.FC = () => {
  const [isTutorial, setIsTutorial] = useState(false);
  const { ready: backendReady, error: backendError } = useBackendHealth();

  useEffect(() => {
    const check = () => setIsTutorial(window.location.hash.replace(/^#/, '') === '/tutorial');
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);

  if (isTutorial) {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading Tutorial...</p>
          </div>
        </div>
      }>
        <TutorialView />
      </Suspense>
    );
  }

  if (!backendReady) {
    return (
      <BlockingScreen
        title="Starting backend services"
        description="Hang tight while we verify the backend is up and happy."
        status="Checking /health…"
        hint={backendError ? `Last error: ${backendError}` : 'If this takes more than ~30s, check the backend logs.'}
      />
    );
  }

  return <WorkspaceShell />;
};

export default App;
