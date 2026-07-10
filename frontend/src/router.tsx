import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import App from './App';
import { validateAppSearch } from '@/features/views/viewSearch';
import { getRuntimeBasePath } from '@/lib/backend/env';

const rootRoute = createRootRoute({
  /** Keeps TanStack Router happy while all real view switching stays Zustand-driven. */
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: validateAppSearch,
  component: App,
});

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
