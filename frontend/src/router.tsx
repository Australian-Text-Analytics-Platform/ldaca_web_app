import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import App from './App';
import { ALL_VIEWS, type ViewType } from './stores/uiStore';

declare global {
  interface Window {
    __BASE_PATH__?: string;
  }
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

export interface AppSearch {
  view?: ViewType;
}

export const isViewSearchValue = (value: unknown): value is ViewType =>
  typeof value === 'string' && ALL_VIEWS.includes(value as ViewType);

export const validateAppSearch = (search: Record<string, unknown>): AppSearch => {
  const view = isViewSearchValue(search.view) ? search.view : undefined;
  return view ? { view } : {};
};

export const viewSearchFor = (view: ViewType): AppSearch => (
  view === 'data-loader' ? {} : { view }
);

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: validateAppSearch,
  component: App,
});

export const appRoute = indexRoute;

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({
  routeTree,
  basepath: (typeof window !== 'undefined' && window.__BASE_PATH__) || '/',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}