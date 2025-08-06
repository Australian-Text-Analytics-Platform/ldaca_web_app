import React, { useState } from 'react';
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

  return (
    <QueryProvider>
      <ErrorBoundary>
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
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

          <div className="flex h-[calc(100vh-73px)]">
            {/* Left Sidebar */}
            <ErrorBoundary>
              <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
            </ErrorBoundary>

            {/* Middle Panel - Operation UI */}
            <main className="flex-1 p-6 overflow-y-auto relative">
              <div className="max-w-4xl mx-auto">
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

            {/* Right Panel - Workspace View */}
            <aside className="flex-1 bg-white border-l border-gray-200 min-w-0 relative">
              <ErrorBoundary>
                <WorkspaceView />
              </ErrorBoundary>
            </aside>
          </div>
        </div>
      </ErrorBoundary>
    </QueryProvider>
  );
};

export default App;
