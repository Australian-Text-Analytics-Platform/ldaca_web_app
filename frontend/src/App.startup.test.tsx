import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import App from './App';
import type { AuthPhase } from './hooks/useAuth';
import type { AuthInfoResponse } from './types';

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
vi.mock('./features/analysis/data-loader/DataLoaderFeature', lazyComponentMock);
vi.mock('./features/analysis/data-preprocessing/DataPreprocessingFeature', lazyComponentMock);
vi.mock('./features/analysis/concordance/ConcordanceFeature', lazyComponentMock);
vi.mock('./features/analysis/quotation/QuotationFeature', lazyComponentMock);
vi.mock('./features/analysis/topic-modeling/TopicModelingFeature', lazyComponentMock);
vi.mock('./features/analysis/sequential-analysis/SequentialAnalysisFeature', lazyComponentMock);
vi.mock('./features/analysis/export/ExportFeature', lazyComponentMock);
vi.mock('./features/analysis/token-frequency/TokenFrequencyFeature', lazyComponentMock);

const baseAuthInfo: AuthInfoResponse = {
  authenticated: true,
  user: null,
  multi_user_mode: false,
  available_auth_methods: [],
  requires_authentication: false,
};

const createAuthState = (overrides: Record<string, any> = {}) => ({
  phase: { status: 'ready', info: baseAuthInfo } as AuthPhase,
  authInfo: baseAuthInfo,
  loginWithGoogle: vi.fn(),
  logout: vi.fn(),
  isAuthenticated: true,
  isMultiUserMode: false,
  isLoading: false,
  error: null,
  refreshAuth: vi.fn(),
  getAuthHeaders: vi.fn(() => ({})),
  requiresAuthentication: false,
  availableAuthMethods: [],
  dataFolder: null,
  user: null,
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
    mockUseAuth.mockReturnValue(createAuthState());
    const { unmount } = render(<App />);

    expect(mockUseAuth).toHaveBeenCalledWith(expect.objectContaining({ autoStart: true, debugLabel: 'WorkspaceShell' }));
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
      phase: { status: 'bootstrapping', attempts: 1, error: 'Auth timed out' },
      isLoading: true,
      error: 'Auth timed out',
      isAuthenticated: false,
      refreshAuth,
    }));

    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText('Signing you in')).toBeInTheDocument();
    expect(screen.getByText('Auth timed out')).toBeInTheDocument();
    expect(refreshAuth).not.toHaveBeenCalled();
    const retryButton = screen.getByRole('button', { name: /retry connection/i });
    await user.click(retryButton);
    expect(refreshAuth).toHaveBeenCalledTimes(1);
  });

  it('renders main layout once backend and auth are ready', async () => {
    mockUseBackendHealth.mockReturnValue({ ready: true, error: null });
    mockUseAuth.mockReturnValue(createAuthState());

    render(<App />);

    expect(screen.getByText('Sidebar')).toBeInTheDocument();
    expect(screen.getByText('WorkspaceView')).toBeInTheDocument();
  });
});
