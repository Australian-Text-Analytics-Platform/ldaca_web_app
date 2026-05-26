import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { appRoute, viewSearchFor } from '@/router';
import { useUIStore, type ViewType } from '@/stores';

const getRoutableView = ({
  currentView,
  isWorkspaceLoaded,
  visibleViews,
}: {
  currentView: ViewType;
  isWorkspaceLoaded: boolean;
  visibleViews: ViewType[];
}): ViewType => {
  if (!visibleViews.includes(currentView)) return 'data-loader';
  if (!isWorkspaceLoaded && currentView !== 'data-loader') return 'data-loader';
  return currentView;
};

export const ViewRouteSync = () => {
  const { view: routeView } = appRoute.useSearch();
  const navigate = appRoute.useNavigate();
  const { currentWorkspaceId } = useWorkspaceData();
  const { currentView, setCurrentView, visibleViews } = useUIStore(
    useShallow((state) => ({
      currentView: state.currentView,
      setCurrentView: state.setCurrentView,
      visibleViews: state.visibleViews,
    })),
  );

  const isWorkspaceLoaded = Boolean(currentWorkspaceId);
  const routeViewAllowed = Boolean(
    routeView &&
    visibleViews.includes(routeView) &&
    (routeView === 'data-loader' || isWorkspaceLoaded),
  );

  useEffect(() => {
    if (routeViewAllowed && routeView && routeView !== currentView) {
      setCurrentView(routeView);
    }
  }, [currentView, routeView, routeViewAllowed, setCurrentView]);

  useEffect(() => {
    if (routeViewAllowed && routeView !== currentView) return;

    const nextView = getRoutableView({ currentView, isWorkspaceLoaded, visibleViews });
    const nextSearch = viewSearchFor(nextView);
    if (routeView === nextSearch.view) return;

    void navigate({ search: nextSearch });
  }, [currentView, isWorkspaceLoaded, navigate, routeView, routeViewAllowed, visibleViews]);

  return null;
};