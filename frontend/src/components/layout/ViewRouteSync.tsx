import { useEffect, useRef } from 'react';
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

  // Tracks the routeView from the previous effect run to distinguish URL-driven
  // navigation (routeView changed) from store-driven navigation (sidebar click,
  // where only currentView changes). Initialized to null so the very first run
  // always treats the initial URL as a potential "just changed" value.
  const prevRouteViewRef = useRef<typeof routeView | null>(null);

  useEffect(() => {
    const prevRouteView = prevRouteViewRef.current;
    prevRouteViewRef.current = routeView;
    const routeViewJustChanged = routeView !== prevRouteView;

    // URL → store: the URL's view param changed to a valid, different view.
    // Apply it to the store and skip the URL update (handles back/forward and
    // direct URL entry). Without this guard the two directions would race.
    if (routeViewAllowed && routeViewJustChanged && routeView && routeView !== currentView) {
      setCurrentView(routeView);
      return;
    }

    // Store → URL: keep the URL in sync with the current store view.
    const nextView = getRoutableView({ currentView, isWorkspaceLoaded, visibleViews });
    const nextSearch = viewSearchFor(nextView);
    if (routeView === nextSearch.view) return;
    void navigate({ search: nextSearch });
  }, [currentView, isWorkspaceLoaded, navigate, routeView, routeViewAllowed, setCurrentView, visibleViews]);

  return null;
};