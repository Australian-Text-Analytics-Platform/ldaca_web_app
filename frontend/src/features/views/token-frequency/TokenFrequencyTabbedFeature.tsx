/**
 * Token-frequency view's tabbed shell. Thin per-view wrapper that binds the
 * shared AnalysisTabsHost to the token-frequency tab group + panel, so this view
 * gets the exact same tab UI/behaviour as every other analysis view.
 *
 * Rendered by: ViewRouter via the ``token-frequency`` entry in VIEW_COMPONENTS.
 */
import { AnalysisTabsHost } from '../common/tabs/AnalysisTabsHost';
import { ANALYSIS_TAB_GROUPS } from '../common/analysisIds';
import TokenFrequencyFeature from './TokenFrequencyFeature';

function TokenFrequencyTabbedFeature() {
  return (
    <AnalysisTabsHost
      tabGroup={ANALYSIS_TAB_GROUPS.tokenFrequencies}
      Feature={TokenFrequencyFeature}
    />
  );
}

export default TokenFrequencyTabbedFeature;
