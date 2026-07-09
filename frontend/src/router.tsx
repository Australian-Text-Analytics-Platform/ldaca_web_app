import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import App from './App';
import { DEFAULT_VIEW, isViewType, type ViewType } from '@/features/views/viewIds';
import { getRuntimeBasePath } from '@/lib/backend/env';

const rootRoute = createRootRoute({
  /** Keeps TanStack Router happy while all real view switching stays Zustand-driven. */
  component: () => <Outlet />,
});

export interface AppSearch {
  view?: ViewType;
}

/** Validates `?view=` values before syncing them into UI-store navigation state. */
export const isViewSearchValue = (value: unknown): value is ViewType => isViewType(value);

/** Drops unknown search params so shared links never navigate to unsupported views. */
export const validateAppSearch = (search: Record<string, unknown>): AppSearch => {
  const view = isViewSearchValue(search.view) ? search.view : undefined;
  return view ? { view } : {};
};

/** Omits the default data-loader view to keep canonical app URLs short. */
export const viewSearchFor = (view: ViewType): AppSearch => (view === DEFAULT_VIEW ? {} : { view });

const indexRoute = createRoute({
  /** Connects the single SPA route to the shared root route. */
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: validateAppSearch,
  component: App,
});

export const appRoute = indexRoute;

const routeTree = rootRoute.addChildren([indexRoute]);

const runtimeBasePath = typeof window !== 'undefined' ? getRuntimeBasePath() : undefined;
const normalizedBasePath = runtimeBasePath === '' ? '/' : (runtimeBasePath ?? '/');

export const router = createRouter({
  routeTree,
  basepath: normalizedBasePath,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
