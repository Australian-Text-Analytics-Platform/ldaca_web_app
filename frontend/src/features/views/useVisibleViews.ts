import { ALL_VIEWS, type ViewType } from './viewIds';
import { useUserPreferences } from '@/features/preferences/useUserPreferences';

/** Derives navigation order from the canonical registry ids and hidden preference. */
export const visibleViewsFromHidden = (hiddenViews: readonly string[]): ViewType[] =>
  ALL_VIEWS.filter((view) => view === 'data-loader' || !hiddenViews.includes(view));

/**
 * Subscribes to the durable visibility preference and derives the live view list.
 * Used by: sidebar/settings navigation rendering and `ViewRouteSync`, which is
 * the sole owner that repairs a hidden or workspace-gated active view.
 */
export const useVisibleViews = (): ViewType[] => {
  const { preferences } = useUserPreferences();
  return visibleViewsFromHidden(preferences.hidden_views ?? []);
};
