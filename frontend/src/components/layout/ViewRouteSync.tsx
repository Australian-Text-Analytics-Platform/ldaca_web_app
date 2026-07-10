import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { DEFAULT_VIEW } from '@/features/views/viewIds';
import { isWorkspaceRequired } from '@/features/views/viewRegistry';
import { useVisibleViews } from '@/features/views/useVisibleViews';
import { appRoute, viewSearchFor } from '@/router';
import { useUIStore, type ViewType } from '@/stores';

/** Called by: ViewRouteSync before writing store-driven view state back to the URL. */
const getRoutableView = ({
  currentView,
  isWorkspaceLoaded,
  visibleViews,
}: {
  currentView: ViewType;
  isWorkspaceLoaded: boolean;
  visibleViews: ViewType[];
}): ViewType => {
  if (!visibleViews.includes(currentView)) return DEFAULT_VIEW;
  if (!isWorkspaceLoaded && isWorkspaceRequired(currentView)) return DEFAULT_VIEW;
  return currentView;
};

/**
 * Synchronizes the single-route URL search state with the Zustand `currentView`.
 * It lets browser back/forward and shared links select views while keeping the
 * sidebar/store as the app's primary navigation source.
 * Rendered by: App once near the shell so URL/search state can follow the global view without file-based routes.
 * Flow: detect valid URL-driven view changes, apply them to the store, then navigate search params back to the current routable view.
 */
export const ViewRouteSync = () => {
  const { view: routeView } = appRoute.useSearch();
  const navigate = appRoute.useNavigate();
  const { currentWorkspaceId } = useWorkspaceData();
  const { currentView, setCurrentView } = useUIStore(
    useShallow((state) => ({
      currentView: state.currentView,
      setCurrentView: state.setCurrentView,
    })),
  );
  const visibleViews = useVisibleViews();

  const isWorkspaceLoaded = Boolean(currentWorkspaceId);
  const routeViewAllowed = Boolean(
    routeView &&
      visibleViews.includes(routeView) &&
      (!isWorkspaceRequired(routeView) || isWorkspaceLoaded),
  );

  // Tracks the routeView from the previous effect run to distinguish URL-driven
  // navigation (routeView changed) from store-driven navigation (sidebar click,
  // where only currentView changes). Initialized to null so the very first run
  // always treats the initial URL as a potential "just changed" value.
  const prevRouteViewRef = useRef<typeof routeView | null>(null);

  // Remembers a URL view that is a valid target but is temporarily blocked only
  // because the workspace has not finished loading yet (the common case on a
  // page refresh of e.g. ``?view=token-frequency``). Keeping it here lets us
  // preserve the URL param while loading and adopt it once the workspace is
  // ready, instead of wiping the param back to the base URL mid-load.
  const pendingRouteViewRef = useRef<ViewType | null>(null);

  useEffect(() => {
    const prevRouteView = prevRouteViewRef.current;
    prevRouteViewRef.current = routeView;
    const routeViewJustChanged = routeView !== prevRouteView;

    // Refresh case: the URL names a valid view that is only blocked because the
    // workspace is still loading. Stash it and leave the URL untouched so the
    // intent survives until the workspace becomes available.
    if (
      routeView &&
      isWorkspaceRequired(routeView) &&
      visibleViews.includes(routeView) &&
      !isWorkspaceLoaded
    ) {
      pendingRouteViewRef.current = routeView;
      if (currentView !== DEFAULT_VIEW) {
        setCurrentView(DEFAULT_VIEW);
      }
      return;
    }

    // The workspace finished loading with a pending URL view → adopt it now.
    // This handles the refresh flow where ``routeView`` itself never changes
    // (so the URL → store guard below would not fire), only ``isWorkspaceLoaded``.
    const pendingRouteView = pendingRouteViewRef.current;
    if (pendingRouteView && isWorkspaceLoaded) {
      pendingRouteViewRef.current = null;
      if (visibleViews.includes(pendingRouteView) && pendingRouteView !== currentView) {
        setCurrentView(pendingRouteView);
        return;
      }
    }

    // URL → store: the URL's view param changed to a valid, different view.
    // Apply it to the store and skip the URL update (handles back/forward and
    // direct URL entry). Without this guard the two directions would race.
    if (routeViewAllowed && routeViewJustChanged && routeView && routeView !== currentView) {
      setCurrentView(routeView);
      return;
    }

    // Centralize view fallback here instead of letting the sidebar reset
    // currentView during workspace boot. That keeps direct URLs like
    // ``?view=filter`` pending until the workspace is available, then adopts
    // them without a sidebar/store race back to Data Loader.
    if (!visibleViews.includes(currentView)) {
      setCurrentView(visibleViews[0] ?? DEFAULT_VIEW);
      return;
    }
    if (!isWorkspaceLoaded && isWorkspaceRequired(currentView)) {
      setCurrentView(DEFAULT_VIEW);
      return;
    }

    // Store → URL: keep the URL in sync with the current store view.
    const nextView = getRoutableView({ currentView, isWorkspaceLoaded, visibleViews });
    const nextSearch = viewSearchFor(nextView);
    if (routeView === nextSearch.view) return;
    void navigate({ search: nextSearch });
  }, [
    currentView,
    isWorkspaceLoaded,
    navigate,
    routeView,
    routeViewAllowed,
    setCurrentView,
    visibleViews,
  ]);

  return null;
};
