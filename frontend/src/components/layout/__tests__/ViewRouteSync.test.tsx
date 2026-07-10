import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUIStore } from '@/stores/uiStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { ViewRouteSync } from '../ViewRouteSync';

const routeFixture = vi.hoisted(() => ({
  routeView: undefined as string | undefined,
  workspaceId: null as string | null,
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({ view: routeFixture.routeView }),
  useNavigate: () => routeFixture.navigate,
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
  }));
  usePreferencesStore.setState({ hiddenViews: [] });
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

  it('pushes store-driven view changes into URL search state', async () => {
    const { rerender } = render(<ViewRouteSync />);

    act(() => {
      useUIStore.getState().setCurrentView('quotation');
    });
    rerender(<ViewRouteSync />);

    await waitFor(() => {
      expect(routeFixture.navigate).toHaveBeenCalledWith({ search: { view: 'quotation' } });
    });
  });

  it('replaces an invalid raw URL view before registry lookup', async () => {
    routeFixture.routeView = 'not-a-view';

    render(<ViewRouteSync />);

    await waitFor(() => {
      expect(routeFixture.navigate).toHaveBeenCalledWith({ search: {}, replace: true });
    });
    expect(useUIStore.getState().currentView).toBe('data-loader');
  });

  it('replaces an explicit default view with the canonical base URL', async () => {
    routeFixture.routeView = 'data-loader';

    render(<ViewRouteSync />);

    await waitFor(() => {
      expect(routeFixture.navigate).toHaveBeenCalledWith({ search: {}, replace: true });
    });
  });

  it('pushes a store-driven switch back to Data Loader', async () => {
    routeFixture.routeView = 'quotation';
    const { rerender } = render(<ViewRouteSync />);
    await waitFor(() => {
      expect(useUIStore.getState().currentView).toBe('quotation');
    });
    routeFixture.navigate.mockClear();

    act(() => {
      useUIStore.getState().setCurrentView('data-loader');
    });
    rerender(<ViewRouteSync />);

    await waitFor(() => {
      expect(routeFixture.navigate).toHaveBeenCalledWith({ search: {} });
    });
  });

  it('applies back navigation that clears the view search param', async () => {
    routeFixture.routeView = 'quotation';
    const { rerender } = render(<ViewRouteSync />);

    await waitFor(() => {
      expect(useUIStore.getState().currentView).toBe('quotation');
    });
    routeFixture.navigate.mockClear();

    routeFixture.routeView = undefined;
    rerender(<ViewRouteSync />);

    await waitFor(() => {
      expect(useUIStore.getState().currentView).toBe('data-loader');
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

  it('drops a pending workspace view when browser navigation clears it', async () => {
    routeFixture.routeView = 'filter';
    routeFixture.workspaceId = null;

    const { rerender } = render(<ViewRouteSync />);

    routeFixture.routeView = undefined;
    rerender(<ViewRouteSync />);
    routeFixture.workspaceId = 'workspace-1';
    rerender(<ViewRouteSync />);

    await waitFor(() => {
      expect(useUIStore.getState().currentView).toBe('data-loader');
    });
    expect(routeFixture.navigate).not.toHaveBeenCalled();
  });

  it('repairs an active view hidden by restored preferences', async () => {
    useUIStore.setState({ currentView: 'quotation' });
    usePreferencesStore.setState({ hiddenViews: ['quotation'] });

    render(<ViewRouteSync />);

    await waitFor(() => {
      expect(useUIStore.getState().currentView).toBe('data-loader');
    });
  });

  it('repairs a hidden URL view without adopting it into the store', async () => {
    routeFixture.routeView = 'quotation';
    usePreferencesStore.setState({ hiddenViews: ['quotation'] });

    render(<ViewRouteSync />);

    await waitFor(() => {
      expect(routeFixture.navigate).toHaveBeenCalledWith({ search: {}, replace: true });
    });
    expect(useUIStore.getState().currentView).toBe('data-loader');
  });

  it('re-applies the URL view after the sync owner remounts across auth transitions', async () => {
    routeFixture.routeView = 'concordance';
    const view = render(<ViewRouteSync />);

    await waitFor(() => {
      expect(useUIStore.getState().currentView).toBe('concordance');
    });
    view.unmount();
    act(() => {
      useUIStore.getState().setCurrentView('data-loader');
    });

    render(<ViewRouteSync />);

    await waitFor(() => {
      expect(useUIStore.getState().currentView).toBe('concordance');
    });
    expect(routeFixture.navigate).not.toHaveBeenCalled();
  });
});
