import { useState, useEffect, useRef, useCallback, Suspense, lazy, type ReactNode } from 'react';
import { useAuth, type AuthPhase, REFRESH_FAILURE_THRESHOLD } from './hooks/useAuth';
import { useBackendHealth } from './hooks/useBackendHealth';
import { usePreferencesInit } from './hooks/usePreferences';
import { QueryProvider } from './providers/QueryProvider';
import { WorkspaceProvider } from './providers/WorkspaceProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import GoogleLogin from './components/GoogleLogin';
import Sidebar from './components/layout/Sidebar';
import BlockingScreen from './components/startup/BlockingScreen';
import { useUIStore } from './stores';
import { usePreferencesStore } from './stores/preferencesStore';
import { useShallow } from 'zustand/react/shallow';
import { SidebarInset, SidebarProvider, SidebarTrigger } from './components/ui/sidebar';
import { Toaster } from './components/ui/sonner';
import { Dialog, DialogContent, DialogTitle } from './components/ui/dialog';

// Lazy load components for code splitting
const TutorialView = lazy(() => import('./components/TutorialView'));
const FeedbackPanel = lazy(() => import('./components/panels/FeedbackPanel'));
const WorkspaceView = lazy(() => import('./components/layout/WorkspaceView'));
const DataLoaderFeature = lazy(() => import('./features/analysis/data-loader/DataLoaderFeature'));
const DataPreprocessingFeature = lazy(() => import('./features/analysis/data-preprocessing/DataPreprocessingFeature'));
const ConcordanceFeature = lazy(() => import('./features/analysis/concordance/ConcordanceFeature'));
const QuotationFeature = lazy(() => import('./features/analysis/quotation/QuotationFeature'));
const TopicModelingFeature = lazy(() => import('./features/analysis/topic-modeling/TopicModelingFeature'));
const SequentialAnalysisFeature = lazy(() => import('./features/analysis/sequential-analysis/SequentialAnalysisFeature'));
const ExportFeature = lazy(() => import('./features/analysis/export/ExportFeature'));
const TokenFrequencyFeature = lazy(() => import('./features/analysis/token-frequency/TokenFrequencyFeature'));
const AiAnnotatorFeature = lazy(() => import('./features/analysis/ai-annotator/AiAnnotatorFeature'));

const REFRESH_CHIP_DELAY_MS = 3000;
const LAG_HINT_DELAY_MS = 8000;

/**
 * Shell that renders the main workspace experience once the backend is healthy
 * and the user has completed authentication (if required).
 */
const WorkspaceShell: React.FC = () => {
  const {
    currentView,
    closeFeedbackModal,
    feedbackOpen,
    tutorialModal,
    tutorialTarget,
    closeTutorialModal,
  } = useUIStore(useShallow((state) => ({
    currentView: state.currentView,
    closeFeedbackModal: state.closeFeedbackModal,
    feedbackOpen: state.modals.feedbackModal,
    tutorialModal: state.modals.tutorialModal,
    tutorialTarget: state.tutorialTarget,
    closeTutorialModal: state.closeTutorialModal,
  })));
  const {
    phase,
    loginWithGoogle,
    logout,
    isAuthenticated,
    isMultiUserMode,
    isLoading: authLoading,
    error: authError,
    refreshAuth,
  } = useAuth({ autoStart: true, debugLabel: 'WorkspaceShell' });

  // Initialize preferences from backend and sync visible views into uiStore
  usePreferencesInit();
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const syncVisibleViews = useUIStore((s) => s.syncVisibleViewsFromPreferences);
  useEffect(() => {
    if (prefsHydrated) syncVisibleViews();
  }, [prefsHydrated, syncVisibleViews]);
  if (import.meta.env.DEV) {
    console.debug('[WorkspaceShell] auth phase', phase.status, {
      isAuthenticated,
      isMultiUserMode,
    });
  }
  const [laggingHintReady, setLaggingHintReady] = useState(false);
  const [refreshChipReady, setRefreshChipReady] = useState(false);
  const showLaggingHint = laggingHintReady && phase.status === 'bootstrapping';
  const refreshChipVisible = refreshChipReady && phase.status === 'refreshing';

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
    if (phase.status !== 'bootstrapping') return;
    const timeoutId = window.setTimeout(() => setLaggingHintReady(true), LAG_HINT_DELAY_MS);
    return () => {
      window.clearTimeout(timeoutId);
      setLaggingHintReady(false);
    };
  }, [phase.status]);

  useEffect(() => {
    if (phase.status !== 'refreshing') return;
    const timeoutId = window.setTimeout(() => setRefreshChipReady(true), REFRESH_CHIP_DELAY_MS);
    return () => {
      window.clearTimeout(timeoutId);
      setRefreshChipReady(false);
    };
  }, [phase.status]);

  const blockingCopy = getBlockingCopy(phase, showLaggingHint);
  const shouldShowLoginCard = isMultiUserMode && !isAuthenticated && phase.status !== 'bootstrapping';
  const degradedPhase = phase.status === 'degraded' ? phase : null;
  const showRefreshBanner = Boolean(degradedPhase);
  const bannerAttemptsLabel = degradedPhase ? formatAttemptLabel(degradedPhase.attempts) : null;
  const bannerMessage = degradedPhase?.error ?? 'Having trouble refreshing your session.';
  const bannerTime = degradedPhase ? formatTimestamp(degradedPhase.lastFailureAt) : null;
  const showRefreshChip = phase.status === 'refreshing' && refreshChipVisible;
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
  const toggleRightPanel = () => {
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
  };

  if (blockingCopy) {
    return (
      <BlockingScreen
        title={blockingCopy.title}
        description={blockingCopy.description}
        status={blockingCopy.status}
        hint={blockingCopy.hint}
        error={blockingCopy.error}
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
  if (shouldShowLoginCard) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 flex items-center justify-center">
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

  return (
    <QueryProvider>
      <WorkspaceProvider>
        <ErrorBoundary>
          <SidebarProvider className="bg-linear-to-br from-slate-50 to-blue-50">
            {/* Tutorial Modal */}
            <Dialog open={tutorialModal} onOpenChange={(open) => !open && closeTutorialModal()}>
              <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
                <DialogTitle className="sr-only">Tutorial</DialogTitle>
                <div className="flex-1 overflow-y-auto">
                  <Suspense fallback={<div className="p-8 flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>}>
                    <TutorialView onClose={closeTutorialModal} target={tutorialTarget} />
                  </Suspense>
                </div>
              </DialogContent>
            </Dialog>

            {(showRefreshBanner || showRefreshChip) && (
              <div className="pointer-events-none fixed left-1/2 top-4 z-50 flex -translate-x-1/2 flex-col gap-2">
                {showRefreshBanner && bannerAttemptsLabel && (
                  <div className="pointer-events-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-lg">
                    <span className="font-medium text-amber-900">Connection hiccup</span>
                    <span className="text-xs text-amber-900/80">{bannerMessage}</span>
                    <span className="text-xs text-amber-900/70">Attempts {bannerAttemptsLabel}</span>
                    {bannerTime && (
                      <span className="text-xs text-amber-900/60">Last failure {bannerTime}</span>
                    )}
                    <button
                      type="button"
                      onClick={refreshAuth}
                      className="rounded-full border border-amber-400 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                    >
                      Retry now
                    </button>
                  </div>
                )}
                {showRefreshChip && (
                  <div className="flex items-center gap-2 self-center rounded-full bg-slate-900/90 px-3 py-1 text-xs font-medium text-white shadow-lg">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" aria-hidden />
                    Reconnecting…
                  </div>
                )}
              </div>
            )}
            <div className="flex h-screen w-full overflow-hidden">
              <ErrorBoundary>
                <Sidebar />
              </ErrorBoundary>

              <SidebarInset className="flex h-screen flex-1 flex-col overflow-hidden bg-transparent">
                <Suspense fallback={null}>
                  <FeedbackPanel open={feedbackOpen} onClose={closeFeedbackModal} />
                </Suspense>

                <header className="border-b border-border/40 bg-white px-4 py-3 md:hidden">
                  <div className="flex items-center justify-between">
                    <SidebarTrigger />
                  </div>
                </header>

                <div className="flex flex-1 flex-col overflow-hidden">
                  <div className="relative flex flex-1 overflow-hidden" ref={layoutRef}>
                    <main
                      ref={mainRef}
                      className={`relative h-full flex-1 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden p-6 ${isResizing ? 'transition-none' : 'transition-all duration-300 ease-in-out'}`}
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
                            {currentView === 'data-loader' && <DataLoaderFeature />}
                            {currentView === 'filter' && <DataPreprocessingFeature />}
                            {currentView === 'token-frequency' && <TokenFrequencyFeature />}
                            {currentView === 'concordance' && <ConcordanceFeature />}
                            {currentView === 'analysis' && <SequentialAnalysisFeature />}
                            {currentView === 'topic-modeling' && <TopicModelingFeature />}
                            {currentView === 'quotation' && <QuotationFeature />}
                            {currentView === 'ai-annotator' && <AiAnnotatorFeature />}
                            {currentView === 'export' && <ExportFeature />}
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
                          <span className="overflow-hidden whitespace-nowrap transition-all duration-200 max-w-0 group-hover:max-w-30 mr-1">Collapse</span>
                          <span aria-hidden>❯</span>
                        </button>
                      )}
                      <ErrorBoundary>
                        {!isRightCollapsed && (
                          <Suspense
                            fallback={(
                              <div className="flex h-full items-center justify-center bg-white text-sm text-muted-foreground">
                                Loading workspace view…
                              </div>
                            )}
                          >
                            <WorkspaceView />
                          </Suspense>
                        )}
                      </ErrorBoundary>
                    </aside>

                    {isRightCollapsed && (
                        <button
                        onClick={toggleRightPanel}
                        className="group absolute top-2 right-2 z-30 rounded-md border border-gray-300 bg-white/90 backdrop-blur px-2 py-1 text-gray-700 hover:bg-gray-50 shadow flex items-center"
                        aria-label="Expand right panel"
                        title="Expand"
                      >
                        <span className="overflow-hidden whitespace-nowrap transition-all duration-200 max-w-0 group-hover:max-w-24 mr-1">Show</span>
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
 * Top-level app entry that handles backend health gating
 * before rendering the main workspace shell.
 */
const App: React.FC = () => {
  const { ready: backendReady, error: backendError } = useBackendHealth();
  let content: ReactNode;

  if (!backendReady) {
    content = (
      <BlockingScreen
        title="Starting backend services"
        description="Hang tight while we verify the backend is up and happy."
        status="Checking /health…"
        hint={backendError ? `Last error: ${backendError}` : 'If this takes more than ~30s, check the backend logs.'}
      />
    );
  } else {
    content = <WorkspaceShell />;
  }

  return (
    <>
      {content}
      <Toaster />
    </>
  );
};

type BlockingCopy = {
  title: string;
  description: string;
  status: string;
  hint?: string;
  error?: string;
};

const formatTimestamp = (value?: number | null) => {
  if (!value) return null;
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const formatAttemptLabel = (attempts: number) => `${Math.min(attempts, REFRESH_FAILURE_THRESHOLD)}/${REFRESH_FAILURE_THRESHOLD}`;

const getBlockingCopy = (phase: AuthPhase, showLaggingHint: boolean): BlockingCopy | null => {
  if (phase.status === 'bootstrapping') {
    return {
      title: 'Signing you in',
      description: 'The backend is healthy; finishing the authentication handshake.',
      status: showLaggingHint ? 'Still waiting for auth…' : 'Checking your session…',
      hint: showLaggingHint
        ? 'This can happen if backend migrations are still running. You can retry below.'
        : 'This usually takes just a moment.',
      error: phase.error,
    };
  }

  if (phase.status === 'fatal') {
    return {
      title: 'Reconnecting your session',
      description: 'Multiple background refresh attempts failed, so we paused the workspace until the backend responds again.',
      status: `Retrying (${formatAttemptLabel(phase.attempts)})…`,
      hint: formatTimestamp(phase.lastFailureAt)
        ? `Last failure at ${formatTimestamp(phase.lastFailureAt)}. Check your connection or restart the backend, then retry below.`
        : 'Check your connection or restart the backend, then retry below.',
      error: phase.error,
    };
  }

  return null;
};

export default App;
