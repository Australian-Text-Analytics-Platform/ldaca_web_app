import { useState, useEffect, useRef, Suspense, lazy, type ReactNode } from 'react';
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
import { useResizableSplit } from './hooks/useResizableSplit';
import { loadRemoteRegistry } from './tutorials/remoteRegistry';

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

  // Resize state lives in two useResizableSplit calls below — the sidebar
  // (vertical+pixel, mutating shadcn's primitive via querySelector) and
  // the right panel (vertical+percent, DOM-imperative via mainRef/asideRef).
  // Both must be declared before any early returns (Hooks rule).
  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(false);
  const [lastAsidePanelRatio, setLastAsidePanelRatio] = useState<number>(0.4);
  const mainRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  // Sidebar: pixel-based, vertical axis. The shadcn Sidebar primitive
  // controls its own DOM via `[data-slot="sidebar-gap"]` and
  // `[data-slot="sidebar-container"]`; we mutate those during drag and
  // reset them on release so the primitive's width prop takes back over.
  // `persistKey` holds the EXPANDED width only — if/when shadcn's icon
  // mode is wired up, that mode keys off `data-state="collapsed"` on the
  // sidebar root and uses its own `--sidebar-width-icon` var (separate
  // from this persisted value).
  const {
    containerRef: sidebarHostRef,
    value: sidebarWidth,
    isDragging: isResizingSidebar,
    splitterProps: sidebarSplitterProps,
  } = useResizableSplit({
    orientation: 'vertical',
    mode: 'pixel',
    defaultValue: 208,
    min: 160,
    max: 400,
    persistKey: 'ldaca.layout.sidebarWidth',
    onDragStart: () => {
      const gapEl = document.querySelector<HTMLElement>('[data-slot="sidebar-gap"]');
      const containerEl = document.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
      if (gapEl) gapEl.style.transition = 'none';
      if (containerEl) containerEl.style.transition = 'none';
    },
    onLiveUpdate: (next) => {
      const gapEl = document.querySelector<HTMLElement>('[data-slot="sidebar-gap"]');
      const containerEl = document.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
      if (gapEl) gapEl.style.width = `${next}px`;
      if (containerEl) containerEl.style.width = `${next}px`;
    },
    onDragEnd: () => {
      const gapEl = document.querySelector<HTMLElement>('[data-slot="sidebar-gap"]');
      const containerEl = document.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
      if (gapEl) {
        gapEl.style.transition = '';
        gapEl.style.width = '';
      }
      if (containerEl) {
        containerEl.style.transition = '';
        containerEl.style.width = '';
      }
    },
  });

  // Right panel: percent-based, vertical axis, end-anchored. `value` is
  // the RIGHT (aside) pane's ratio of the layout container; the main pane
  // is `1 - value`. End-anchoring lets `maxPixels: 800` cap the aside
  // pane directly — on a 4K display 80% would be ~3000 px of workspace
  // view which is wasted whitespace; the cap keeps it sensible while
  // still letting the pane scale on normal laptops.
  //
  // We mutate widths on mainRef/asideRef during drag to keep React Flow
  // and TanStack tables off the per-frame render path.
  const {
    containerRef: layoutRef,
    value: asidePanelRatio,
    setValue: setAsidePanelRatio,
    isDragging: isResizing,
    splitterProps: rightPanelSplitterProps,
  } = useResizableSplit({
    orientation: 'vertical',
    anchor: 'end',
    mode: 'percent',
    defaultValue: 0.4,
    min: 0.2,
    max: 0.8,
    maxPixels: 800,
    persistKey: 'ldaca.layout.asidePanelRatio',
    onLiveUpdate: (next) => {
      if (isRightCollapsed) return;
      if (mainRef.current) mainRef.current.style.width = `${(1 - next) * 100}%`;
      if (asideRef.current) asideRef.current.style.width = `${next * 100}%`;
    },
  });

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

  // Collapse/expand the entire right panel (Outlook-like behavior). We
  // remember the last drag value so an uncollapse restores it. While
  // collapsed the splitter doesn't render, so the hook's value sits
  // unchanged in state.
  const toggleRightPanel = () => {
    setIsRightCollapsed((prev) => {
      if (prev) {
        setAsidePanelRatio(lastAsidePanelRatio);
        return false;
      }
      setLastAsidePanelRatio(asidePanelRatio);
      return true;
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
            <div className="flex h-dvh w-full overflow-hidden" ref={sidebarHostRef}>
              <ErrorBoundary>
                <Sidebar />
              </ErrorBoundary>

              <div
                className={`hidden md:flex shrink-0 cursor-col-resize group relative w-2 items-center justify-center ${isResizingSidebar ? 'z-20' : ''}`}
                aria-label="Resize sidebar"
                {...sidebarSplitterProps}
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
                      style={{ width: isRightCollapsed ? '100%' : `${(1 - asidePanelRatio) * 100}%`, minWidth: 280 }}
                      innerClassName="overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden p-4"
                    >
                      <div className="w-full max-w-none mx-0">
                        <ViewRouter />
                      </div>
                    </InsetCard>

                    {!isRightCollapsed && (
                      <div
                        // Hide the drag handle on touch viewports — it's
                        // hard to grab on small screens and the aside
                        // layout itself collapses to stacked below `md`
                        // (separate change; tracked in plan §3.6 Phase C).
                        className="hidden md:flex w-2 shrink-0 cursor-col-resize group relative items-center justify-center"
                        aria-label="Resize right panel"
                        {...rightPanelSplitterProps}
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
                      style={{ width: isRightCollapsed ? 0 : `${asidePanelRatio * 100}%` }}
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
  // Kick off the docs registry hydrate + background refresh once on mount.
  // Cache is read synchronously inside `loadRemoteRegistry` so the first
  // modal open never sees an empty merged registry. `loadRemoteRegistry`
  // is itself idempotent, so StrictMode's double-invoke is harmless.
  useEffect(() => {
    void loadRemoteRegistry();
  }, []);
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
