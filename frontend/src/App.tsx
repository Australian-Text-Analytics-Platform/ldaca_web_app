import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { useAuth } from './hooks/useAuth';
import { useBackendHealth } from './hooks/useBackendHealth';
import { QueryProvider } from './providers/QueryProvider';
import { WorkspaceProvider } from './providers/WorkspaceProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import GoogleLogin from './components/GoogleLogin';
import { WorkspaceView, Sidebar } from './components/layout';
import logo from './logo.png';
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
const TimelineTab = lazy(() => import('./components/tabs/TimelineTab'));
const ExportTab = lazy(() => import('./components/tabs/ExportTab'));
const TokenFrequencyTab = lazy(() => import('./components/tabs/TokenFrequencyTab'));

/**
 * Improved App component with proper error boundaries and loading states
 */
const App: React.FC = () => {
  const {
    currentView,
    closeFeedbackModal,
    feedbackOpen,
  } = useUIStore(useShallow((state) => ({
    currentView: state.currentView,
    closeFeedbackModal: state.closeFeedbackModal,
    feedbackOpen: state.modals.feedbackModal,
  })));
  const [isTutorial, setIsTutorial] = useState<boolean>(false);
  const { loginWithGoogle, logout, isAuthenticated, isMultiUserMode, isLoading, error } = useAuth();
  const { ready: backendReady } = useBackendHealth();

  // Right panel width and resize handlers must be declared before any early returns (React Hooks rule)
  const [rightWidth, setRightWidth] = useState<number>(40); // percentage of total width
  const [lastRightWidth, setLastRightWidth] = useState<number>(40); // remember last width when collapsing
  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const rightWidthLiveRef = useRef<number>(rightWidth);
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

  // Hash-based lightweight routing for tutorial page
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

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Wait for backend readiness before showing anything else (prevents empty file list due to race)
  if (!backendReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center flex flex-col items-center space-y-5 bg-white/80 backdrop-blur px-10 py-8 rounded-xl shadow-lg border border-gray-100">
          <img src={logo} alt="LDaCA Logo" className="h-16 w-auto object-contain" />
          <h1 className="text-2xl font-bold text-gray-800">LDaCA Corpus Analysis</h1>
          <div className="flex flex-col items-center space-y-3">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-200 border-t-blue-600" />
            <p className="text-gray-700 font-medium">Backend not ready yet</p>
            <p className="text-xs text-gray-500">Waiting for API /health...</p>
          </div>
        </div>
      </div>
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
              isLoading={isLoading}
              error={error}
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
                            {currentView === 'analysis' && <TimelineTab />}
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

export default App;
