import type { ViewType } from '@/stores';

/**
 * Views that render their own tabbed card (AnalysisTabbedPanel via
 * AnalysisTabsHost) instead of sitting inside the shared main card. For these,
 * the main InsetCard frame is made transparent so the tab strip can protrude
 * above the view's own card with no double-card nesting. Every analysis view
 * that has migrated to the shared tab shell must be listed here.
 */
const TABBED_MAIN_VIEWS = new Set<ViewType>([
  'concordance',
  'token-frequency',
  'analysis',
  'topic-modeling',
  'quotation',
  'annotation',
]);

/**
 * Returns whether a view owns the middle-column card through AnalysisTabbedPanel.
 * Used by: WorkspaceShell and its regression test because tabbed views must
 * remove the generic InsetCard frame so their tab strip sits directly on the
 * background like the other function tabs.
 */
export function isTabbedMainView(view: ViewType): boolean {
  return TABBED_MAIN_VIEWS.has(view);
}
