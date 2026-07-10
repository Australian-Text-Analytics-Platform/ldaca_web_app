import { ALL_VIEWS, type ViewType } from './viewIds';
import { usePreferencesStore } from '@/stores/preferencesStore';

/** Derives navigation order from the canonical registry ids and hidden preference. */
export const visibleViewsFromHidden = (hiddenViews: readonly string[]): ViewType[] =>
  ALL_VIEWS.filter((view) => view === 'data-loader' || !hiddenViews.includes(view));

/**
 * Subscribes to the durable visibility preference and derives the live view list.
 * Used by: sidebar/settings navigation rendering and `ViewRouteSync`, which is
 * the sole owner that repairs a hidden or workspace-gated active view.
 */
export const useVisibleViews = (): ViewType[] => {
  const hiddenViews = usePreferencesStore((state) => state.hiddenViews);
  return visibleViewsFromHidden(hiddenViews);
};
