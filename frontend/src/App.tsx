import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import { useAuth } from './hooks/useAuth';
import { QueryProvider } from './providers/QueryProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import GoogleLogin from './components/GoogleLogin';
import DataLoaderTab from './components/DataLoaderTab';
import FilterTab from './components/FilterTab';
import ConcordanceTab from './components/ConcordanceTab';
import TimelineTab from './components/TimelineTab';
import TokenFrequencyTab from './components/TokenFrequencyTab';
import WorkspaceView from './components/WorkspaceView';
import Sidebar from './components/Sidebar';

/**
 * Improved App component with proper error boundaries and loading states
 */
const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'data-loader' | 'filter' | 'token-frequency' | 'concordance' | 'analysis' | 'export'>('data-loader');
  const { user, loginWithGoogle, logout, isAuthenticated, isMultiUserMode, isLoading, error } = useAuth();

  // Right panel width and resize handlers must be declared before any early returns (React Hooks rule)
  const [rightWidth, setRightWidth] = useState<number>(50); // percentage of total width
  const [lastRightWidth, setLastRightWidth] = useState<number>(50); // remember last width when collapsing
  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const onStartResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isRightCollapsed) return; // don't resize when collapsed
    setIsResizing(true);
    const onMove = (ev: MouseEvent) => {
      if (!layoutRef.current) return;
      const rect = layoutRef.current.getBoundingClientRect();
      const offsetX = ev.clientX - rect.left;
      const pctRight = Math.min(80, Math.max(20, ((rect.width - offsetX) / rect.width) * 100));
      setRightWidth(pctRight);
    };
    const onUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isRightCollapsed, setIsResizing, setRightWidth, layoutRef]);

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

  // Listen for navigation events from TokenFrequencyTab
  useEffect(() => {
    const handleNavigateToConcordance = (event: CustomEvent) => {
      console.log('Navigating to concordance with token:', event.detail.token);
      setActiveTab('concordance');
    };

    window.addEventListener('navigateToConcordance', handleNavigateToConcordance as EventListener);

    return () => {
      window.removeEventListener('navigateToConcordance', handleNavigateToConcordance as EventListener);
    };
  }, []);

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
      <ErrorBoundary>
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
          {/* Global drag-and-drop overlay removed; users can drop directly onto the file list */}
          {/* Header */}
          <header className="bg-white border-b border-gray-200 px-6 py-4 relative">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold text-gray-800">LDaCA Corpus Analysis</h1>
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-600">Welcome, {user?.name}</span>
                <button
                  onClick={logout}
                  className="text-sm text-red-600 hover:text-red-700 transition-colors"
                >
                  Logout
                </button>
              </div>
            </div>
          </header>

          <div className="flex h-[calc(100vh-73px)] relative" ref={layoutRef}>
            {/* Left Sidebar */}
            <ErrorBoundary>
              <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
            </ErrorBoundary>

            {/* Middle Panel - Operation UI */}
            <main
              className="p-6 overflow-y-auto relative transition-all duration-300 ease-in-out"
              style={{ width: isRightCollapsed ? '100%' : `${100 - rightWidth}%`, minWidth: 280 }}
            >
              <div className={`${isRightCollapsed ? 'w-full max-w-none mx-0' : 'w-full max-w-4xl mx-auto'}`}>
                <ErrorBoundary>
                  {activeTab === 'data-loader' && <DataLoaderTab />}
                  {activeTab === 'filter' && <FilterTab />}
                  {activeTab === 'concordance' && <ConcordanceTab />}
                  {activeTab === 'token-frequency' && <TokenFrequencyTab />}
                  {activeTab === 'analysis' && <TimelineTab />}
                  {activeTab === 'export' && (
                    <div className="text-center py-12">
                      <h2 className="text-xl font-semibold text-gray-700">Export Tools</h2>
                      <p className="text-gray-500 mt-2">Coming soon...</p>
                    </div>
                  )}
                </ErrorBoundary>
              </div>
            </main>

            {/* Vertical drag handle between main and right panel */}
            {!isRightCollapsed && (
              <div
                className={`w-1 ${isResizing ? 'bg-gray-300' : 'bg-gray-200 hover:bg-gray-300'} cursor-col-resize`}
                onMouseDown={onStartResize}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize right panel"
              />
            )}

            {/* Right Panel - Workspace View */}
            <aside
              className={`bg-white border-l border-gray-200 relative overflow-hidden transition-all duration-300 ease-in-out ${
                isRightCollapsed ? 'min-w-0' : 'min-w-[320px]'
              }`}
              style={{ width: isRightCollapsed ? 0 : `${rightWidth}%` }}
            >
              {/* Outlook-like collapse button at top-right of the right panel */}
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

            {/* Floating expand button when panel is collapsed (top-right), Outlook style */}
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
      </ErrorBoundary>
    </QueryProvider>
  );
};

export default App;
