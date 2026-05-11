import { useState, useEffect, useRef, useCallback, Suspense, lazy, type ReactNode } from 'react';
import { useAuth } from './hooks/useAuth';
import { useBackendHealth } from './hooks/useBackendHealth';
import { usePreferencesInit } from './hooks/usePreferences';
import { QueryProvider } from './providers/QueryProvider';
import { WorkspaceProvider } from '@/features/workspace/common/WorkspaceProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import Sidebar from './components/layout/Sidebar';
import { InsetCard } from './components/layout/InsetCard';
import BlockingScreen from './components/startup/BlockingScreen';
import { LoginScreen } from './components/startup/LoginScreen';
import { RefreshStatusBanner } from './components/startup/RefreshStatusBanner';
import { getBlockingCopy } from './components/startup/authPhaseCopy';
import { useUIStore } from './stores';
import { usePreferencesStore } from './stores/preferencesStore';
import { useShallow } from 'zustand/react/shallow';
import { SidebarInset, SidebarProvider, SidebarTrigger } from './components/ui/sidebar';
import { Toaster } from './components/ui/sonner';
import { DocumentModalHost } from './components/dialogs/DocumentModalHost';
import { ViewRouter } from './components/layout/ViewRouter';
import { LAG_HINT_DELAY_MS } from './config/timings';

// Lazy load components for code splitting. Per-view feature components live
// inside <ViewRouter> so the active feature unmounts cleanly on view switch.
const FeedbackPanel = lazy(() => import('./components/panels/FeedbackPanel'));
const WorkspaceView = lazy(() => import('./components/layout/WorkspaceView'));
const HintsController = lazy(() => import('./features/hints/HintsController'));

/**
 * Shell that renders the main workspace experience once the backend is healthy
 * and the user has completed authentication (if required).
 */
const WorkspaceShell: React.FC = () => {
  const {
    closeFeedbackModal,
    feedbackOpen,
  } = useUIStore(useShallow((state) => ({
    closeFeedbackModal: state.closeFeedbackModal,
    feedbackOpen: state.modals.feedbackModal,
  })));
  const {
    phase,
    isAuthenticated,
    isMultiUserMode,
    isLoading: authLoading,
    error: authError,
    refreshAuth,
    availableAuthMethods,
  } = useAuth({ autoStart: true, debugLabel: 'WorkspaceShell' });

  // Initialize preferences from backend and sync visible views into uiStore
  usePreferencesInit();
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const syncVisibleViews = useUIStore((s) => s.syncVisibleViewsFromPreferences);
  useEffect(() => {
    if (prefsHydrated) syncVisibleViews();
  }, [prefsHydrated, syncVisibleViews]);
  const [laggingHintReady, setLaggingHintReady] = useState(false);
  const showLaggingHint = laggingHintReady && phase.status === 'bootstrapping';

  // Right panel width and resize handlers must be declared before any early returns (React Hooks rule)
  const [rightWidth, setRightWidth] = useState<number>(40); // percentage of total width
  const [lastRightWidth, setLastRightWidth] = useState<number>(40); // remember last width when collapsing
  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(208); // px, matches default SIDEBAR_WIDTH (16rem at 13px base)
  const layoutRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const rightWidthLiveRef = useRef<number>(rightWidth);

  const onStartSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const gapEl = document.querySelector<HTMLElement>('[data-slot="sidebar-gap"]');
    const containerEl = document.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
    // Disable primitive's width transition so the sidebar tracks the cursor exactly (same pattern as other separators)
    if (gapEl) gapEl.style.transition = 'none';
    if (containerEl) containerEl.style.transition = 'none';
    let rafId: number | null = null;
    let liveWidth = startWidth;
    const onMove = (ev: MouseEvent) => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        liveWidth = Math.min(400, Math.max(160, startWidth + (ev.clientX - startX)));
        if (gapEl) gapEl.style.width = `${liveWidth}px`;
        if (containerEl) containerEl.style.width = `${liveWidth}px`;
      });
    };
    const onUp = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      setSidebarWidth(liveWidth);
      setIsResizingSidebar(false);
      if (gapEl) {
        gapEl.style.transition = '';
        gapEl.style.width = '';
      }
      if (containerEl) {
        containerEl.style.transition = '';
        containerEl.style.width = '';
      }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  useEffect(() => {
    if (phase.status !== 'bootstrapping') return;
    const timeoutId = window.setTimeout(() => setLaggingHintReady(true), LAG_HINT_DELAY_MS);
    return () => {
      window.clearTimeout(timeoutId);
      setLaggingHintReady(false);
    };
  }, [phase.status]);

  const blockingCopy = getBlockingCopy(phase, showLaggingHint);
  const shouldShowLoginCard = isMultiUserMode && !isAuthenticated && phase.status !== 'bootstrapping';
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

  // Show login screen if not authenticated and in multi-user mode.
  // Reuses the same full-screen layout as BlockingScreen, but swaps the
  // spinner card for a Google sign-in card.
  if (shouldShowLoginCard) {
    return <LoginScreen isLoading={authLoading} error={authError} authMethods={availableAuthMethods} />;
  }

  return (
    <QueryProvider>
      <WorkspaceProvider>
        <ErrorBoundary>
          <SidebarProvider
            className="bg-linear-to-br from-slate-50 to-blue-50"
            style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` } as React.CSSProperties}
          >
            <DocumentModalHost />

            <RefreshStatusBanner />
            <Suspense fallback={null}>
              <HintsController />
            </Suspense>
            <div className="flex h-dvh w-full overflow-hidden">
              <ErrorBoundary>
                <Sidebar />
              </ErrorBoundary>

              <div
                className={`hidden md:flex shrink-0 cursor-col-resize group relative w-2 items-center justify-center ${isResizingSidebar ? 'z-20' : ''}`}
                onMouseDown={onStartSidebarResize}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize sidebar"
              >
                <div
                  className={`pointer-events-none w-1 h-10 rounded-full transition-colors ${
                    isResizingSidebar ? 'bg-gray-500' : 'bg-gray-300 group-hover:bg-gray-500'
                  }`}
                />
              </div>

              <SidebarInset className="flex h-full flex-1 flex-col overflow-hidden bg-transparent md:m-0! md:ml-0! md:rounded-none! md:shadow-none!">
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
                    <InsetCard
                      ref={mainRef}
                      role="main"
                      className={`relative h-full p-2 pl-1 ${
                        isRightCollapsed ? 'pr-2' : 'pr-1'
                      } ${isResizing ? 'transition-none' : 'transition-all duration-300 ease-in-out'}`}
                      style={{ width: isRightCollapsed ? '100%' : `${100 - rightWidth}%`, minWidth: 280 }}
                      innerClassName="overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden p-4"
                    >
                      <div className="w-full max-w-none mx-0">
                        <ViewRouter />
                      </div>
                    </InsetCard>

                    {!isRightCollapsed && (
                      <div
                        className="w-2 shrink-0 cursor-col-resize group relative flex items-center justify-center"
                        onMouseDown={onStartResize}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize right panel"
                      >
                        <div
                          className={`pointer-events-none w-1 h-10 rounded-full transition-colors ${
                            isResizing ? 'bg-gray-500' : 'bg-gray-300 group-hover:bg-gray-500'
                          }`}
                        />
                      </div>
                    )}

                    <aside
                      ref={asideRef}
                      className={`relative flex h-full flex-col overflow-hidden bg-transparent ${isResizing ? 'transition-none' : 'transition-all duration-300 ease-in-out'} ${
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
  // Read feedback-modal state from the shared UI store; the pre-auth and
  // post-auth paths both surface the same Send-feedback button so it'd be
  // surprising for them to maintain separate visibility state.
  const {
    feedbackOpen,
    openFeedbackModal,
    closeFeedbackModal,
  } = useUIStore(useShallow((state) => ({
    feedbackOpen: state.modals.feedbackModal,
    openFeedbackModal: state.openFeedbackModal,
    closeFeedbackModal: state.closeFeedbackModal,
  })));
  let content: ReactNode;

  if (!backendReady) {
    content = (
      <>
        <BlockingScreen
          title="Starting backend services"
          description="Hang tight while we verify the backend is up and happy."
          status="Checking /health…"
          hint={backendError ? `Last error: ${backendError}` : 'If this takes more than ~30s, check the backend logs.'}
          actions={(
            <button
              type="button"
              onClick={openFeedbackModal}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 font-medium shadow-sm hover:bg-gray-50 focus-visible:outline-offset-2 focus-visible:outline-blue-500 focus-visible:outline-2"
            >
              Send feedback
            </button>
          )}
        />
        <Suspense fallback={null}>
          <FeedbackPanel open={feedbackOpen} onClose={closeFeedbackModal} />
        </Suspense>
      </>
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

export default App;
