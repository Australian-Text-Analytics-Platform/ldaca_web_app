import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Tab } from '@/api';

const mocks = vi.hoisted(() => {
  const setCurrentView = vi.fn();
  const rememberActiveTab = vi.fn();
  return {
    setCurrentView,
    rememberActiveTab,
    uiState: { currentView: 'data-loader' as const, setCurrentView },
    authState: { session: { user: { id: 'user-1' } } },
    presentationState: { activeTabIds: {}, rememberActiveTab },
    refetch: vi.fn(),
  };
});

const frequencyTab: Tab = {
  id: 'frequency-1',
  kind: 'token_frequency',
  name: 'Analysis 1',
  created_at: '2026-08-28T00:00:00Z',
  modified_at: '2026-08-28T00:00:00Z',
  revision: 1,
};

vi.mock('@/lib/isMacOSDesktop', () => ({ isMacOSDesktop: () => true }));
vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({
    currentWorkspace: { id: 'workspace-1', name: 'Election analysis' },
    currentWorkspaceId: 'workspace-1',
  }),
}));
vi.mock('@/features/views/common/tabs/workspaceTabsQuery', () => ({
  useWorkspaceTabResources: () => ({
    data: [frequencyTab],
    isLoading: false,
    isSuccess: true,
    isError: false,
    refetch: mocks.refetch,
  }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: typeof mocks.authState) => unknown) => selector(mocks.authState),
}));
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: typeof mocks.uiState) => unknown) => selector(mocks.uiState),
}));
vi.mock('@/features/views/common/tabs/analysisTabsPresentationStore', () => ({
  analysisTabsPresentationKey: () => 'presentation-key',
  useAnalysisTabsPresentationStore: (
    selector: (state: typeof mocks.presentationState) => unknown,
  ) => selector(mocks.presentationState),
}));

import { DesktopNavigationHeader } from '../DesktopNavigationHeader';

describe('DesktopNavigationHeader controller', () => {
  it('activates a selected Tab and its owning view', async () => {
    const user = userEvent.setup();
    render(<DesktopNavigationHeader />);

    await user.click(screen.getByRole('button', { name: 'Open quick access' }));
    await user.click(screen.getByRole('option', { name: 'Token Frequency: Analysis 1' }));

    expect(mocks.rememberActiveTab).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'token_frequency',
      'frequency-1',
    );
    expect(mocks.setCurrentView).toHaveBeenCalledWith('token-frequency');
  });
});
