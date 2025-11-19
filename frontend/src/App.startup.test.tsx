import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import App from './App';

const mockUseAuth = vi.fn();
vi.mock('./hooks/useAuth', () => ({
  useAuth: (options?: any) => mockUseAuth(options),
}));

const mockUseBackendHealth = vi.fn();
vi.mock('./hooks/useBackendHealth', () => ({
  useBackendHealth: () => mockUseBackendHealth(),
}));

vi.mock('./providers/QueryProvider', () => ({
  QueryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./providers/WorkspaceProvider', () => ({
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./components/layout', () => ({
  WorkspaceView: () => <div>WorkspaceView</div>,
  Sidebar: () => <div>Sidebar</div>,
}));

vi.mock('./components/startup/BlockingScreen', () => ({
  default: ({ title, description, status, hint, error, actions }: any) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      {status && <span>{status}</span>}
      {hint && <span>{hint}</span>}
      {error && <span>{error}</span>}
      {actions}
    </div>
  ),
}));

vi.mock('./components/panels/FeedbackPanel', () => ({
  default: () => <div>FeedbackPanel</div>,
}));

vi.mock('./components/GoogleLogin', () => ({
  default: () => <div>GoogleLogin</div>,
}));

vi.mock('./components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => <button>SidebarTrigger</button>,
}));

vi.mock('./stores', () => ({
  useUIStore: (selector: (state: any) => any) => selector({
    currentView: 'data-loader',
    closeFeedbackModal: vi.fn(),
    modals: { feedbackModal: false },
  }),
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: any) => selector,
}));

function lazyComponentMock() {
  return { default: () => <div>LazyComponent</div> };
}
vi.mock('./components/TutorialView', lazyComponentMock);
vi.mock('./components/tabs/DataLoaderTab', lazyComponentMock);
vi.mock('./components/tabs/DataPreprocessingTab', lazyComponentMock);
vi.mock('./components/tabs/ConcordanceTab', lazyComponentMock);
vi.mock('./components/tabs/QuotationTab', lazyComponentMock);
vi.mock('./components/tabs/TopicModelingTab', lazyComponentMock);
vi.mock('./components/tabs/SequentialAnalysisTab', lazyComponentMock);
vi.mock('./components/tabs/ExportTab', lazyComponentMock);
vi.mock('./components/tabs/TokenFrequencyTab', lazyComponentMock);

const createAuthState = (overrides: Record<string, any> = {}) => ({
  loginWithGoogle: vi.fn(),
  logout: vi.fn(),
  isAuthenticated: false,
  isMultiUserMode: false,
  isLoading: true,
  error: null,
  refreshAuth: vi.fn(),
  ...overrides,
});

const baseBackendState = { ready: false, error: null };

describe('App startup gating', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseBackendHealth.mockReset();
    mockUseAuth.mockReturnValue(createAuthState());
    mockUseBackendHealth.mockReturnValue(baseBackendState);
  });

  it('defers auth bootstrap until the backend passes health checks', () => {
    mockUseBackendHealth.mockReturnValue({ ready: true, error: null });
    mockUseAuth.mockReturnValue(createAuthState({ isLoading: false, isAuthenticated: true }));
    const { unmount } = render(<App />);

    expect(mockUseAuth).toHaveBeenCalledWith(expect.objectContaining({ autoStart: false }));
    unmount();
  });

  it('shows backend waiting screen when health check is not ready', () => {
    const refreshAuth = vi.fn();
    mockUseBackendHealth.mockReturnValue({ ready: false, error: 'dial tcp ECONNREFUSED' });
    mockUseAuth.mockReturnValue(createAuthState({ refreshAuth }));

    render(<App />);

    expect(screen.getAllByText('Starting backend services')[0]).toBeInTheDocument();
    expect(screen.getByText(/ECONNREFUSED/)).toBeInTheDocument();
    expect(refreshAuth).not.toHaveBeenCalled();
  });

  it('shows auth blocking screen when backend is healthy but auth still loading', async () => {
    mockUseBackendHealth.mockReturnValue({ ready: true, error: null });
    const refreshAuth = vi.fn();
    mockUseAuth.mockReturnValue(createAuthState({
      isLoading: true,
      error: 'Auth timed out',
      refreshAuth,
    }));

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(refreshAuth).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Signing you in')).toBeInTheDocument();
    expect(screen.getByText('Auth timed out')).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: /retry connection/i });
    await user.click(retryButton);
    expect(refreshAuth).toHaveBeenCalledTimes(2);
  });

  it('renders main layout once backend and auth are ready', async () => {
    mockUseBackendHealth.mockReturnValue({ ready: true, error: null });
    const refreshAuth = vi.fn();
    mockUseAuth.mockReturnValue(createAuthState({
      isLoading: false,
      isAuthenticated: true,
      refreshAuth,
    }));

    render(<App />);

    await waitFor(() => expect(refreshAuth).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Sidebar')).toBeInTheDocument();
    expect(screen.getByText('WorkspaceView')).toBeInTheDocument();
  });
});
