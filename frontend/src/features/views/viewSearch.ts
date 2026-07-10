import { DEFAULT_VIEW, isViewType, type ViewType } from './viewIds';

/** Search contract shared by the single root route and its synchronization owner. */
export interface AppSearch {
  view?: ViewType;
}

/**
 * Narrows untyped URL search at both safety boundaries: the root route's strict
 * projection and ViewRouteSync's runtime guard for raw match search values.
 */
export const isViewSearchValue = (value: unknown): value is ViewType => isViewType(value);

/**
 * Builds the route's typed/strict search projection. TanStack can still retain
 * unknown raw keys in match.search, so ViewRouteSync revalidates before registry
 * access and replaces any noncanonical URL.
 */
export const validateAppSearch = (search: Record<string, unknown>): AppSearch => {
  const view = isViewSearchValue(search.view) ? search.view : undefined;
  return view ? { view } : {};
};

/**
 * Converts store-owned view state back to canonical URL search state. The
 * default Data Loader view is represented by an absent `view` parameter.
 * Used by: `ViewRouteSync` for store-driven navigation and route repair.
 */
export const viewSearchFor = (view: ViewType): AppSearch => (view === DEFAULT_VIEW ? {} : { view });
