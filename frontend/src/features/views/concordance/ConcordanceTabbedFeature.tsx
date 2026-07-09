/**
 * Concordance view's tabbed shell. Thin per-view wrapper that binds the shared
 * AnalysisTabsHost to the concordance tab group + panel, so the concordance view
 * gets the exact same tab UI/behaviour as every other analysis view.
 *
 * Rendered by: ViewRouter via the ``concordance`` entry in VIEW_COMPONENTS.
 */
import { AnalysisTabsHost } from '../common/tabs/AnalysisTabsHost';
import { ANALYSIS_TAB_GROUPS } from '../common/analysisIds';
import { ConcordanceFeature } from './ConcordanceFeature';

function ConcordanceTabbedFeature() {
  return (
    <AnalysisTabsHost tabGroup={ANALYSIS_TAB_GROUPS.concordance} Feature={ConcordanceFeature} />
  );
}

export default ConcordanceTabbedFeature;
