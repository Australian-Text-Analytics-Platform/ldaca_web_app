import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import App from './App';
import { ALL_VIEWS, type ViewType } from './stores/uiStore';
import { getRuntimeBasePath } from '@/lib/backend/env';

const rootRoute = createRootRoute({
  /** Keeps TanStack Router happy while all real view switching stays Zustand-driven. */
  /** Rendered by: TanStack Router when the root route matches because the caller needs a focused rendering boundary for layout, accessibility, and state handoff steps. */
  component: () => <Outlet />,
});

export interface AppSearch {
  view?: ViewType;
}

/** Validates `?view=` values before syncing them into UI-store navigation state. */
/** Used by: App route construction and URL search helpers because the caller needs one documented boundary for the lookup, event, or state handoff step. */
export const isViewSearchValue = (value: unknown): value is ViewType =>
  typeof value === 'string' && ALL_VIEWS.includes(value as ViewType);

/** Drops unknown search params so shared links never navigate to unsupported views. */
/** Used by: App route construction and URL search helpers because the caller needs one documented boundary for the lookup, event, or state handoff step. */
export const validateAppSearch = (search: Record<string, unknown>): AppSearch => {
  const view = isViewSearchValue(search.view) ? search.view : undefined;
  return view ? { view } : {};
};

/** Omits the default data-loader view to keep canonical app URLs short. */
/** Used by: App route construction and URL search helpers because the caller needs one documented boundary for the lookup, event, or state handoff step. */
export const viewSearchFor = (view: ViewType): AppSearch =>
  view === 'data-loader' ? {} : { view };

const indexRoute = createRoute({
  /** Connects the single SPA route to the shared root route. */
  /** Called by: TanStack Router while building the route tree because the caller needs one documented boundary for the lookup, event, or state handoff step. */
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: validateAppSearch,
  component: App,
});

export const appRoute = indexRoute;

const routeTree = rootRoute.addChildren([indexRoute]);

const runtimeBasePath = typeof window !== 'undefined' ? getRuntimeBasePath() : undefined;
const normalizedBasePath = runtimeBasePath === '' ? '/' : runtimeBasePath ?? '/';

export const router = createRouter({
  routeTree,
  basepath: normalizedBasePath,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
