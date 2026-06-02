/**
 * Concordance view's tabbed shell. Thin per-view wrapper that binds the shared
 * AnalysisTabsHost to the concordance tab group + panel, so the concordance view
 * gets the exact same tab UI/behaviour as every other analysis view.
 *
 * Rendered by: ViewRouter via the ``concordance`` entry in VIEW_COMPONENTS.
 */
import { AnalysisTabsHost } from '../common/tabs/AnalysisTabsHost';
import { ConcordanceFeature } from './ConcordanceFeature';

/** Tab-group namespace for concordance tabs (matches the backend analysis type). */
const CONCORDANCE_TAB_GROUP = 'concordance_analysis';

function ConcordanceTabbedFeature() {
  return <AnalysisTabsHost tabGroup={CONCORDANCE_TAB_GROUP} Feature={ConcordanceFeature} />;
}

export default ConcordanceTabbedFeature;
