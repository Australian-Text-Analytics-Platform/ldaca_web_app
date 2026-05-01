import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import App from './App';

declare global {
  interface Window {
    __BASE_PATH__?: string;
  }
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: App,
});

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