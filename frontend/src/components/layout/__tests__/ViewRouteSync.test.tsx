import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_VISIBLE_VIEWS } from '@/features/views/viewIds';
import { useUIStore } from '@/stores/uiStore';
import { ViewRouteSync } from '../ViewRouteSync';

const routeFixture = vi.hoisted(() => ({
  routeView: undefined as string | undefined,
  workspaceId: null as string | null,
  navigate: vi.fn(),
}));

vi.mock('@/router', () => ({
  appRoute: {
    /**
     * Used by: ViewRouteSync tests to expose the mutable URL search fixture
     * because the tests need reusable fixtures before exercising sync behavior.
     */
    useSearch: () => ({ view: routeFixture.routeView }),
    useNavigate: () => routeFixture.navigate,
  },
  viewSearchFor: (view: string) => (view === 'data-loader' ? {} : { view }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  /**
   * Used by: ViewRouteSync tests to simulate workspace boot and load phases
   * because route adoption depends on workspace availability.
   */
  useWorkspaceData: () => ({
    currentWorkspaceId: routeFixture.workspaceId,
  }),
}));

/**
 * Resets the shared UI store and route fixtures before route-sync assertions.
 * Used by: ViewRouteSync tests because the global store persists across tests.
 */
const resetFixtures = () => {
  routeFixture.routeView = undefined;
  routeFixture.workspaceId = 'workspace-1';
  routeFixture.navigate.mockReset();
  useUIStore.setState((state) => ({
    ...state,
    currentView: 'data-loader',
    visibleViews: [...DEFAULT_VISIBLE_VIEWS],
  }));
};

describe('ViewRouteSync', () => {
  beforeEach(() => {
    resetFixtures();
  });

  it('adopts a valid URL view when the workspace is loaded', async () => {
    routeFixture.routeView = 'filter';

    render(<ViewRouteSync />);

    await waitFor(() => {
      expect(useUIStore.getState().currentView).toBe('filter');
    });
    expect(routeFixture.navigate).not.toHaveBeenCalled();
  });

  it('keeps a workspace URL view pending until the workspace finishes loading', async () => {
    routeFixture.routeView = 'filter';
    routeFixture.workspaceId = null;

    const { rerender } = render(<ViewRouteSync />);

    expect(useUIStore.getState().currentView).toBe('data-loader');
    expect(routeFixture.navigate).not.toHaveBeenCalled();

    routeFixture.workspaceId = 'workspace-1';
    rerender(<ViewRouteSync />);

    await waitFor(() => {
      expect(useUIStore.getState().currentView).toBe('filter');
    });
    expect(routeFixture.navigate).not.toHaveBeenCalled();
  });
});
