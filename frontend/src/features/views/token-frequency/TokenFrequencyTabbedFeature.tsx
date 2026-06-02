/**
 * Token-frequency view's tabbed shell. Thin per-view wrapper that binds the
 * shared AnalysisTabsHost to the token-frequency tab group + panel, so this view
 * gets the exact same tab UI/behaviour as every other analysis view.
 *
 * Rendered by: ViewRouter via the ``token-frequency`` entry in VIEW_COMPONENTS.
 */
import { AnalysisTabsHost } from '../common/tabs/AnalysisTabsHost';
import TokenFrequencyFeature from './TokenFrequencyFeature';

/** Tab-group namespace for token-frequency tabs (matches the backend analysis type). */
const TOKEN_FREQUENCY_TAB_GROUP = 'token_frequencies';

function TokenFrequencyTabbedFeature() {
  return <AnalysisTabsHost tabGroup={TOKEN_FREQUENCY_TAB_GROUP} Feature={TokenFrequencyFeature} />;
}

export default TokenFrequencyTabbedFeature;
