/**
 * Sequential-analysis (Trends) view's tabbed shell. Thin per-view wrapper that
 * binds the shared AnalysisTabsHost to the sequential-analysis tab group +
 * panel, so this view gets the exact same tab UI/behaviour as every other
 * analysis view.
 *
 * Rendered by: ViewRouter via the ``analysis`` entry in VIEW_COMPONENTS.
 */
import { AnalysisTabsHost } from '../common/tabs/AnalysisTabsHost';
import SequentialAnalysisFeature from './SequentialAnalysisFeature';

/** Tab-group namespace for sequential-analysis tabs (matches the backend analysis type). */
const SEQUENTIAL_ANALYSIS_TAB_GROUP = 'sequential_analysis';

function SequentialAnalysisTabbedFeature() {
  return (
    <AnalysisTabsHost
      tabGroup={SEQUENTIAL_ANALYSIS_TAB_GROUP}
      Feature={SequentialAnalysisFeature}
    />
  );
}

export default SequentialAnalysisTabbedFeature;
