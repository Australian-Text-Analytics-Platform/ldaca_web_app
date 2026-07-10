import { describe, expect, it } from 'vitest';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

import { isViewSearchValue, validateAppSearch, viewSearchFor } from '@/features/views/viewSearch';

describe('router search helpers', () => {
  it('accepts only known app views', () => {
    expect(isViewSearchValue('concordance')).toBe(true);
    expect(isViewSearchValue('unknown')).toBe(false);
    expect(isViewSearchValue(42)).toBe(false);
  });

  it('validates the view search param without preserving invalid values', () => {
    expect(validateAppSearch({ view: 'topic-modeling' })).toEqual({ view: 'topic-modeling' });
    expect(validateAppSearch({ view: 'settings' })).toEqual({});
    expect(validateAppSearch({})).toEqual({});
  });

  it('keeps raw unknown search values visible at runtime so the sync owner can repair them', async () => {
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      validateSearch: validateAppSearch,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute]),
      history: createMemoryHistory({ initialEntries: ['/?view=not-a-view'] }),
    });

    await router.load();

    expect(router.state.matches.at(-1)?.search).toEqual({ view: 'not-a-view' });
  });

  it('omits the default data loader view from generated search state', () => {
    expect(viewSearchFor('data-loader')).toEqual({});
    expect(viewSearchFor('quotation')).toEqual({ view: 'quotation' });
  });
});
