import { useEffect, useRef } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useShallow } from 'zustand/react/shallow';

import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { DEFAULT_VIEW } from '@/features/views/viewIds';
import { isWorkspaceRequired } from '@/features/views/viewRegistry';
import { isViewSearchValue, viewSearchFor } from '@/features/views/viewSearch';
import { useVisibleViews } from '@/features/views/useVisibleViews';
import { useUIStore, type ViewType } from '@/stores';

/**
 * Chooses the URL-safe view after visibility and workspace gates are applied.
 * Called by: `ViewRouteSync` before store-driven navigation updates search.
 */
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
 * Rendered by: `WorkspaceShell` inside `WorkspaceProvider`, where workspace
 * hydration and visible-view preferences are both available.
 * Flow: preserve workspace-gated deep links during hydration, apply browser
 * navigation to the store, repair unavailable views, then push store-driven
 * view changes back to canonical search state.
 */
export const ViewRouteSync = () => {
  const routeSearch = useSearch({ from: '/' });
  // TanStack keeps unknown raw search keys in match.search even when the route
  // validator's strict search is empty, so narrow again before registry access.
  const rawRouteView: unknown = routeSearch.view;
  const routeView = isViewSearchValue(rawRouteView) ? rawRouteView : undefined;
  const routeSearchInvalid = rawRouteView !== undefined && routeView === undefined;
  const navigate = useNavigate({ from: '/' });
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
  const routeSearchNeedsRepair =
    routeSearchInvalid ||
    routeView === DEFAULT_VIEW ||
    Boolean(routeView && !visibleViews.includes(routeView));

  // A separate observed flag distinguishes a cold base URL from a later browser
  // navigation that clears `view`; both expose `undefined` through the router.
  const hasObservedRouteRef = useRef(false);
  const prevRouteViewRef = useRef<typeof routeView>(undefined);

  // Remembers a URL view that is a valid target but is temporarily blocked only
  // because the workspace has not finished loading yet (the common case on a
  // page refresh of e.g. ``?view=token-frequency``). Keeping it here lets us
  // preserve the URL param while loading and adopt it once the workspace is
  // ready, instead of wiping the param back to the base URL mid-load.
  const pendingRouteViewRef = useRef<ViewType | null>(null);

  useEffect(() => {
    const isInitialRoute = !hasObservedRouteRef.current;
    const prevRouteView = prevRouteViewRef.current;
    hasObservedRouteRef.current = true;
    prevRouteViewRef.current = routeView;
    const routeViewJustChanged = !isInitialRoute && routeView !== prevRouteView;

    // Browser navigation supersedes a workspace-gated deep link that was
    // waiting for hydration, including navigation back to the base URL.
    if (routeViewJustChanged && pendingRouteViewRef.current !== routeView) {
      pendingRouteViewRef.current = null;
    }

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
    if (
      routeViewAllowed &&
      (isInitialRoute || routeViewJustChanged) &&
      routeView &&
      routeView !== currentView
    ) {
      setCurrentView(routeView);
      return;
    }

    // The canonical base URL represents Data Loader when reached through
    // back/forward. On a cold base URL, persisted store state still wins.
    if (routeViewJustChanged && routeView === undefined && currentView !== DEFAULT_VIEW) {
      setCurrentView(DEFAULT_VIEW);
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
    if (!routeSearchNeedsRepair && routeView === nextSearch.view) return;
    void navigate({
      search: nextSearch,
      ...(routeSearchNeedsRepair ? { replace: true } : {}),
    });
  }, [
    currentView,
    isWorkspaceLoaded,
    navigate,
    rawRouteView,
    routeView,
    routeViewAllowed,
    routeSearchNeedsRepair,
    setCurrentView,
    visibleViews,
  ]);

  return null;
};
